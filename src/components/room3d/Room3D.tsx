"use client";
import { Edges, OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { BufferAttribute, BufferGeometry, Object3D, PCFShadowMap } from "three";

import { proxyForCategory } from "../../domain/three/proxy";
import { withFaceGroups } from "./faces";
import { cameraPose, gridSegments, itemTransform, roomMetres, type RoomMetres } from "./transform";
import type { CameraPreset, Room3DProps, RoomItem } from "./types";
import { useProductMaterial } from "./useProductMaterial";

/** The light-enterprise-ui signature colour (src/app/tokens.css --signature). */
const SIGNATURE = "#35576B";
const FLOOR = "#d6ccbf";
const WALL = "#eef0f2";
const GRID = "#a9b6bf";
const PAPER = "#f2f4f5";
const TEXTURE_ROUGHNESS = 0.75;
const PLAIN_ROUGHNESS = 0.85;

export function Room3D({ space, items, selectedId = null, onSelect, className }: Room3DProps) {
  const room = useMemo(() => roomMetres(space), [space]);
  const [preset, setPreset] = useState<CameraPreset>("corner");
  const initial = cameraPose("corner", room);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%", minHeight: 320 }}>
      <Canvas
        shadows={{ type: PCFShadowMap }}
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.05, far: 100, position: initial.position }}
        onPointerMissed={() => onSelect?.(null)}
        style={{ background: PAPER }}
      >
        <CameraRig preset={preset} room={room} />
        <Lights room={room} />
        <Shell room={room} />
        {items.map((item) => (
          <Item key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />
        ))}
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2 - 0.02} minDistance={1} maxDistance={30} />
      </Canvas>
      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
        {(["corner", "top"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPreset(p)}
            aria-pressed={preset === p}
            style={presetButtonStyle(preset === p)}
          >
            {p === "top" ? "Top" : "Corner"}
          </button>
        ))}
      </div>
    </div>
  );
}

function presetButtonStyle(active: boolean): React.CSSProperties {
  return {
    font: "500 12px/1 system-ui, sans-serif",
    padding: "7px 10px",
    borderRadius: 6,
    border: `1px solid ${active ? SIGNATURE : "#dfe5e9"}`,
    background: active ? SIGNATURE : "#ffffff",
    color: active ? "#ffffff" : "#1c2b36",
    cursor: "pointer"
  };
}

/** Moves the camera and orbit target to a preset whenever it changes; the user orbits from there. */
function CameraRig({ preset, room }: { preset: CameraPreset; room: RoomMetres }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: Object3D["position"]; update(): void } | null;
  useEffect(() => {
    const pose = cameraPose(preset, room);
    camera.position.set(...pose.position);
    if (controls) {
      controls.target.set(...pose.target);
      controls.update();
    } else {
      camera.lookAt(...pose.target);
    }
  }, [preset, room, camera, controls]);
  return null;
}

function Lights({ room }: { room: RoomMetres }) {
  const target = useMemo(() => new Object3D(), []);
  const reach = Math.max(room.width, room.length) * 0.8;
  return (
    <>
      <hemisphereLight args={["#ffffff", "#8899aa", 1.4]} />
      <primitive object={target} position={[room.width / 2, 0, -room.length / 2]} />
      <directionalLight
        position={[room.width * 0.85, 5, -room.length * 0.55]}
        target={target}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-radius={4}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={0.5}
        shadow-camera-far={25}
        shadow-camera-left={-reach}
        shadow-camera-right={reach}
        shadow-camera-top={reach}
        shadow-camera-bottom={-reach}
      />
    </>
  );
}

/** Floor, the two walls along the origin edges (x = 0 and z = 0), and a 1 ft grid. */
function Shell({ room }: { room: RoomMetres }) {
  const { width, length, height } = room;
  const grid = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(gridSegments(room), 3));
    return g;
  }, [room]);
  useEffect(() => () => grid.dispose(), [grid]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[width / 2, 0, -length / 2]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color={FLOOR} roughness={0.9} />
      </mesh>
      <mesh rotation-y={Math.PI} position={[width / 2, height / 2, 0]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <mesh rotation-y={Math.PI / 2} position={[0, height / 2, -length / 2]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <lineSegments geometry={grid}>
        <lineBasicMaterial color={GRID} />
      </lineSegments>
    </group>
  );
}

function Item({ item, selected, onSelect }: { item: RoomItem; selected: boolean; onSelect?: (id: string | null) => void }) {
  const { width_mm, depth_mm, height_mm } = item.box;
  const geometry = useMemo(
    () => withFaceGroups(item.category, { width_mm, depth_mm, height_mm }, proxyForCategory(item.category, { width_mm, depth_mm, height_mm })).geometry,
    [item.category, width_mm, depth_mm, height_mm]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { map, colour } = useProductMaterial(item.imageUrl, item.category);
  const { position, rotationY } = itemTransform(item);
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect?.(item.id);
  };
  return (
    <mesh geometry={geometry} position={position} rotation-y={rotationY} castShadow receiveShadow onClick={handleClick} name={item.id}>
      <meshStandardMaterial key={map ? map.uuid : "plain"} attach="material-0" map={map} color={map ? "#ffffff" : colour} roughness={TEXTURE_ROUGHNESS} metalness={0} />
      <meshStandardMaterial attach="material-1" color={colour} roughness={PLAIN_ROUGHNESS} metalness={0} />
      {selected && <Edges color={SIGNATURE} threshold={20} lineWidth={1.5} />}
    </mesh>
  );
}
