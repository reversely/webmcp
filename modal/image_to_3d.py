"""
Modal app `webmcp-image-to-3d`: one product image in, one GLB out (PRD section 15.1).

Model choice: TripoSR (stabilityai/TripoSR, code from github.com/VAST-AI-Research/TripoSR).
It is a single feed-forward pass (no diffusion sampling), so an A10G produces a mesh in a few
seconds, and its only compiled dependency is torchmcubes, which builds against the CUDA 12.4
devel image below. Hunyuan3D-2 and TRELLIS give better meshes but need several compiled CUDA
extensions and 10 to 20 times the inference time, which is the wrong trade for a planner that
scales every mesh to merchant dimensions anyway and falls back to a proxy on failure.

Weights (TripoSR checkpoint via Hugging Face, rembg's u2net) live in a Modal Volume so only the
first container ever downloads them.

Deploy:  modal deploy modal/image_to_3d.py
Call:    POST <endpoint> {"image_url": "https://..."}  ->  {"glb_base64": "...", "timings": {...}}
"""

import base64
import io
import time

import modal

APP_NAME = "webmcp-image-to-3d"
GPU = "A10G"
CACHE_DIR = "/cache"
TRIPOSR_DIR = "/opt/TripoSR"
FOREGROUND_RATIO = 0.85
MARCHING_CUBES_RESOLUTION = 256

volume = modal.Volume.from_name(f"{APP_NAME}-weights", create_if_missing=True)

image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-devel-ubuntu22.04", add_python="3.10")
    .apt_install("git", "build-essential", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        "numpy<2",
        "omegaconf==2.3.0",
        "Pillow==10.1.0",
        "einops==0.7.0",
        "transformers==4.35.0",
        "trimesh==4.0.5",
        "rembg[cpu]==2.0.59",
        "huggingface-hub<0.26",
        "imageio",
        "fastapi[standard]",
        # torchmcubes builds with scikit-build-core; --no-build-isolation below needs it preinstalled.
        "scikit-build-core",
        "cmake",
        "ninja",
        "pybind11[global]",
    )
    # torchmcubes ships no wheel; build it here with nvcc from the devel image. A10G is sm_86.
    .run_commands(
        "CC=gcc CXX=g++ TORCH_CUDA_ARCH_LIST='8.6' "
        "CMAKE_ARGS=\"-Dpybind11_DIR=$(python3 -c 'import pybind11; print(pybind11.get_cmake_dir())')\" "
        "pip install --no-build-isolation git+https://github.com/tatsy/torchmcubes.git",
        gpu=GPU,
    )
    .run_commands(
        f"git clone --depth 1 https://github.com/VAST-AI-Research/TripoSR.git {TRIPOSR_DIR}"
    )
    .env(
        {
            "HF_HOME": f"{CACHE_DIR}/hf",
            "U2NET_HOME": f"{CACHE_DIR}/u2net",
            "PYTHONPATH": TRIPOSR_DIR,
        }
    )
)

app = modal.App(APP_NAME, image=image)


@app.cls(gpu=GPU, timeout=180, scaledown_window=60, volumes={CACHE_DIR: volume})
class ImageTo3D:
    @modal.enter()
    def load(self):
        import rembg
        import torch
        from tsr.system import TSR

        started = time.time()
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = TSR.from_pretrained(
            "stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt"
        )
        self.model.renderer.set_chunk_size(8192)
        self.model.to(self.device)
        self.rembg_session = rembg.new_session()
        # First container downloads into the volume; commit so later containers find the files.
        volume.commit()
        self.load_seconds = time.time() - started

    @modal.fastapi_endpoint(method="POST")
    def generate(self, body: dict):
        import numpy as np
        import requests
        import torch
        from PIL import Image
        from tsr.utils import (
            remove_background,
            resize_foreground,
            to_gradio_3d_orientation,
        )

        image_url = body.get("image_url")
        if not image_url:
            return {"error": "image_url is required"}, 400

        timings = {"load_s": round(self.load_seconds, 2)}
        t = time.time()
        response = requests.get(
            image_url, timeout=30, headers={"User-Agent": "webmcp-image-to-3d/1.0"}
        )
        response.raise_for_status()
        source = Image.open(io.BytesIO(response.content))
        timings["fetch_s"] = round(time.time() - t, 2)

        t = time.time()
        cutout = remove_background(source, self.rembg_session)
        cutout = resize_foreground(cutout, FOREGROUND_RATIO)
        rgba = np.array(cutout).astype(np.float32) / 255.0
        rgb = rgba[:, :, :3] * rgba[:, :, 3:4] + (1 - rgba[:, :, 3:4]) * 0.5
        prepared = Image.fromarray((rgb * 255.0).astype(np.uint8))
        timings["preprocess_s"] = round(time.time() - t, 2)

        t = time.time()
        with torch.no_grad():
            scene_codes = self.model([prepared], device=self.device)
        mesh = self.model.extract_mesh(
            scene_codes, True, resolution=MARCHING_CUBES_RESOLUTION
        )[0]
        # TripoSR's raw frame is Z-up; this puts Y up so the caller only has to rotate about Y.
        mesh = to_gradio_3d_orientation(mesh)
        timings["infer_s"] = round(time.time() - t, 2)

        glb = mesh.export(file_type="glb")
        timings["peak_gpu_gib"] = (
            round(torch.cuda.max_memory_allocated() / 2**30, 2)
            if self.device == "cuda"
            else 0
        )
        return {
            "glb_base64": base64.b64encode(glb).decode("ascii"),
            "vertices": int(mesh.vertices.shape[0]),
            "faces": int(mesh.faces.shape[0]),
            "timings": timings,
        }
