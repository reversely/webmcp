# Image to 3D on Modal

`image_to_3d.py` deploys the Modal app `webmcp-image-to-3d`: a TripoSR inference endpoint that
turns one product image URL into a GLB. `src/server/three-d.ts` calls it, scales the mesh to the
merchant box, and writes the result under `public/models/` (PRD section 15.1).

## Endpoint

```
POST https://reversely--webmcp-image-to-3d-imageto3d-generate.modal.run
Content-Type: application/json

{"image_url": "https://cdn.shopify.com/.../product.webp"}
```

Response: `{"glb_base64": "...", "vertices": N, "faces": N, "timings": {...}}`. The Next server
reads the URL from `MODAL_IMAGE_TO_3D_URL` in `.env`.

## Operating

- Deploy or redeploy: `uv run modal deploy modal/image_to_3d.py` under the `reversely` profile. The `modal` client is pinned in the repo's `pyproject.toml`; `uv sync` installs it.
- GPU: one A10G per container, `timeout=180`, `scaledown_window=60`, no keep-warm. A container
  costs nothing while none is running.
- Weights (TripoSR checkpoint, rembg u2net) live in the volume `webmcp-image-to-3d-weights`.
  The first container fills it; later containers load from it. `modal volume ls
  webmcp-image-to-3d-weights` shows what is cached.
- Logs: `modal app logs webmcp-image-to-3d`.
- Stop everything: `modal app stop webmcp-image-to-3d`, then confirm the container list is
  empty in the dashboard.

## Cost

A10G on Modal bills $1.10 per hour ($0.000306 per second) while a container is up. One call bills
the request wall time plus the 60 second scale-down window.

- Cold call, first ever (weights downloaded into the volume): 167 s + 60 s = about $0.07.
- Cold call with cached weights: container start plus model load (well under the 101 s measured
  with the download) plus about 10 s of work, so roughly $0.03 to $0.04.
- Warm call: about 10 s of work plus the scale-down window, about $0.02.

## Smoke call (2026-08-27)

Input: the M1 Sofa Three Seater image from `src/commerce/fixtures/global-search-three-seat-sofa.json`
(`Helium_Cloud_14b702c4-....webp`), box 2200 x 950 x 800 mm.

- HTTP 200 after 166.9 s wall from the laptop. Server timings: model load 100.7 s (first download
  into the volume), image fetch 0.2 s, background removal and crop 1.0 s, TripoSR plus marching
  cubes 7.3 s. Peak GPU memory 4.15 GiB.
- Output: 4.7 MB GLB, 118,011 vertices, 235,714 faces, vertex colours.
- Bounds before normalization (metres): min [-0.508, -0.406, -0.433], max [0.506, 0.405, 0.377].
- `normalizeGlb` chose rotation 0 and scale [2.171, 0.986, 1.173]; `verifyBounds` passed with
  min [-1.1, 0, -0.475], max [1.1, 0.8, 0.475].
