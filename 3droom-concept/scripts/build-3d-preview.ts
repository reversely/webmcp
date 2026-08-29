// Builds a standalone HTML viewer of the demo room with five kind proxies placed
// by the geometry engine, so the 3D pipeline can be reviewed without the app.
// Run: npx tsx scripts/build-3d-preview.ts  → docs/progress/<date>-3d-preview.html
import { mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { proxyToGlb, verifyBounds } from "../src/domain/three";
import { checkLayout } from "../src/domain/geometry";
import type { Box, Kind } from "../src/domain/types";

const ROOM = { width_mm: 3658, length_mm: 5486 };

const ITEMS: { id: string; kind: Kind; box: Box; x_mm: number; y_mm: number; rotation_deg: number }[] = [
  { id: "sofa", kind: "seating", box: { width_mm: 2134, depth_mm: 914, height_mm: 838 }, x_mm: 1829, y_mm: 700, rotation_deg: 0 },
  { id: "table", kind: "table", box: { width_mm: 1220, depth_mm: 610, height_mm: 450 }, x_mm: 1829, y_mm: 1900, rotation_deg: 0 },
  { id: "ottoman", kind: "decor", box: { width_mm: 610, depth_mm: 610, height_mm: 430 }, x_mm: 2900, y_mm: 1900, rotation_deg: 0 },
  { id: "rug", kind: "soft_floor", box: { width_mm: 2438, depth_mm: 3048, height_mm: 10 }, x_mm: 1829, y_mm: 1900, rotation_deg: 0 },
  { id: "side", kind: "table", box: { width_mm: 508, depth_mm: 508, height_mm: 610 }, x_mm: 3200, y_mm: 700, rotation_deg: 0 }
];

async function main() {
  const layout = checkLayout(
    ROOM,
    ITEMS.map((i) => ({ id: i.id, name: i.id, kind: i.kind, box: i.box, placement: { x_mm: i.x_mm, y_mm: i.y_mm, rotation_deg: i.rotation_deg } })),
    [{ relation: "under", subject: "rug", objects: ["table"] }]
  );

  const assets: Record<string, string> = {};
  for (const item of ITEMS) {
    const glb = await proxyToGlb(item.kind, item.box);
    await verifyBounds(glb, item.box);
    assets[item.id] = Buffer.from(glb).toString("base64");
  }

  const viewer = await build({
    stdin: {
      contents: `
        import * as THREE from "three";
        import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
        import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
        const data = window.__PREVIEW__;
        const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf4f6f8);
        const W = data.room.width_mm / 1000, L = data.room.length_mm / 1000;
        const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight); renderer.shadowMap.enabled = true; document.body.appendChild(renderer.domElement);
        const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 100); camera.position.set(W * 1.55, 3.4, -L * 1.25);
        const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(W / 2, 0.3, -L * 0.35);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(3, 6, 2); sun.castShadow = true; scene.add(sun);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), new THREE.MeshStandardMaterial({ color: 0xd9c8b0 }));
        floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, -L / 2); floor.receiveShadow = true; scene.add(floor);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xeef0f2, side: THREE.DoubleSide });
        const back = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.6), wallMat); back.position.set(W / 2, 1.3, 0); scene.add(back);
        const left = new THREE.Mesh(new THREE.PlaneGeometry(L, 2.6), wallMat); left.rotation.y = Math.PI / 2; left.position.set(0, 1.3, -L / 2); scene.add(left);
        scene.add(new THREE.GridHelper(Math.max(W, L), Math.round(Math.max(W, L) / 0.3048), 0x999999, 0xcccccc).translateX(W / 2).translateZ(-L / 2));
        const loader = new GLTFLoader();
        const colors = { seating: 0x7a5c3e, table: 0x9a7b55, decor: 0x2f3e5c, soft_floor: 0xc9b8a0, other: 0x9fa8b2 };
        for (const item of data.items) {
          const bytes = Uint8Array.from(atob(data.assets[item.id]), (c) => c.charCodeAt(0));
          loader.parse(bytes.buffer, "", (gltf) => {
            gltf.scene.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshStandardMaterial({ color: colors[item.kind], roughness: 0.8 }); o.castShadow = o.receiveShadow = true; } });
            // Project (x, y, z-up) → three (x, z-up, -y); rotation about +Y.
            gltf.scene.position.set(item.x_mm / 1000, 0, -item.y_mm / 1000);
            gltf.scene.rotation.y = (item.rotation_deg * Math.PI) / 180;
            scene.add(gltf.scene);
          });
        }
        const panel = document.getElementById("panel");
        panel.textContent = JSON.stringify(data.layout, null, 1);
        addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
        (function tick() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(tick); })();
      `,
      resolveDir: process.cwd(),
      loader: "js"
    },
    bundle: true,
    write: false,
    format: "iife",
    minify: true,
    target: "es2020"
  });
  const js = viewer.outputFiles[0].text;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>3D proxy preview</title>
<style>body{margin:0;font:13px ui-monospace,monospace}#panel{position:fixed;top:12px;left:12px;max-height:90vh;overflow:auto;background:rgba(255,255,255,.92);padding:10px 12px;border:1px solid #cbd5e1;white-space:pre;max-width:360px}#h{position:fixed;right:12px;top:12px;background:rgba(255,255,255,.92);padding:8px 12px;border:1px solid #cbd5e1}</style></head>
<body><div id="h">Demo room 12 ft × 18 ft. Proxies at merchant W×D×H, GLBs verified to 1 mm. Drag to orbit.</div><pre id="panel"></pre>
<script>window.__PREVIEW__=${JSON.stringify({ room: ROOM, items: ITEMS, assets, layout })};</script>
<script>${js}</script></body></html>`;

  mkdirSync("docs/progress", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const out = `docs/progress/${stamp}-3d-preview.html`;
  writeFileSync(out, html);
  console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
  console.log("layout:", JSON.stringify(layout));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
