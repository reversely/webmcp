"use client";
import { Edges, useGLTF } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { BoxGeometry, Color, EdgesGeometry, Material, Mesh, type Object3D } from "three";

import { METRES_PER_MM } from "../../domain/three/coordinates";
import { proxyForKind, SOFT_FLOOR_THICKNESS_MM } from "../../domain/three/proxy";
import type { Box } from "../../domain/types";
import { itemRenderMode, itemTransform } from "./transform";
import type { RoomItem } from "./types";
import { useProductColour } from "./useProductColour";

/** The light-enterprise-ui signature colour (src/app/tokens.css --signature). */
export const SIGNATURE = "#35576B";
const PROXY_ROUGHNESS = 0.85;
/** The rug's border band: its width, capped by the rug's smaller side, and how much darker it sits. */
const RUG_BAND_M = 0.08;
const RUG_BAND_MAX_FRACTION = 0.1;
const RUG_BAND_DARKEN = 0.72;
const RUG_FIELD_LIFT_M = 0.0005;

/**
 * One placed product: the normalized GLB when generation is ready, else the dimensional proxy in
 * the product's sampled colour. Both sit in the same group, so placement and selection are shared.
 */
export function Item({ item, selected, onSelect }: { item: RoomItem; selected: boolean; onSelect?: (id: string | null) => void }) {
  const colour = useProductColour(item.imageUrl, item.kind);
  const { position, rotationY } = itemTransform(item);
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect?.(item.id);
  };
  const proxy = <Proxy item={item} colour={colour} selected={selected} />;
  return (
    <group position={position} rotation-y={rotationY} onClick={handleClick} name={item.id}>
      {itemRenderMode(item) === "glb" ? (
        <ModelBoundary key={item.glbUrl} fallback={proxy}>
          <Suspense fallback={proxy}>
            <GeneratedModel url={item.glbUrl!} />
            {selected && <BoxOutline box={item.box} />}
          </Suspense>
        </ModelBoundary>
      ) : (
        proxy
      )}
    </group>
  );
}

function Proxy({ item, colour, selected }: { item: RoomItem; colour: string; selected: boolean }) {
  const { width_mm, depth_mm, height_mm } = item.box;
  const geometry = useMemo(() => proxyForKind(item.kind, { width_mm, depth_mm, height_mm }), [item.kind, width_mm, depth_mm, height_mm]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  if (item.kind === "soft_floor") return <SoftFloorProxy box={item.box} colour={colour} selected={selected} />;
  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={colour} roughness={PROXY_ROUGHNESS} metalness={0} />
      {selected && <Edges color={SIGNATURE} threshold={20} lineWidth={1.5} />}
    </mesh>
  );
}

/** A soft-floor slab in a darker band colour with an inset field on top in the product colour, so a flat plane still reads as a rug. */
function SoftFloorProxy({ box, colour, selected }: { box: Box; colour: string; selected: boolean }) {
  const w = box.width_mm * METRES_PER_MM;
  const d = box.depth_mm * METRES_PER_MM;
  const thickness = (box.height_mm > 0 ? box.height_mm : SOFT_FLOOR_THICKNESS_MM) * METRES_PER_MM;
  const band = Math.min(RUG_BAND_M, Math.min(w, d) * RUG_BAND_MAX_FRACTION);
  // Color.set converts the sRGB hex to linear; the band darkens in linear space and is passed as a Color so it is not converted again.
  const { field, edge } = useMemo(() => {
    const field = new Color(colour);
    return { field, edge: field.clone().multiplyScalar(RUG_BAND_DARKEN) };
  }, [colour]);
  return (
    <group>
      <mesh position={[0, thickness / 2, 0]} receiveShadow>
        <boxGeometry args={[w, thickness, d]} />
        <meshStandardMaterial color={edge} roughness={PROXY_ROUGHNESS} metalness={0} />
        {selected && <Edges color={SIGNATURE} threshold={20} lineWidth={1.5} />}
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, thickness + RUG_FIELD_LIFT_M, 0]} receiveShadow>
        <planeGeometry args={[w - 2 * band, d - 2 * band]} />
        <meshStandardMaterial color={field} roughness={PROXY_ROUGHNESS} metalness={0} />
      </mesh>
    </group>
  );
}

/** Mounted GLB instances per URL, so shared geometry is disposed only when the last one unmounts. */
const mounted = new Map<string, number>();

/**
 * The normalized GLB: bottom on Y=0, centred, front facing -Z, bounds equal to the box, so it
 * drops in at the group's origin. Shadows are enabled on every mesh; the cached scene is cloned so
 * two placements of one product can share it.
 */
function GeneratedModel({ url }: { url: string }) {
  const gltf = useGLTF(url, false);
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse((o) => {
      if (o instanceof Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    return clone;
  }, [gltf.scene]);
  useEffect(() => {
    mounted.set(url, (mounted.get(url) ?? 0) + 1);
    return () => {
      const left = (mounted.get(url) ?? 1) - 1;
      if (left > 0) {
        mounted.set(url, left);
        return;
      }
      mounted.delete(url);
      disposeObject(gltf.scene);
      useGLTF.clear(url);
    };
  }, [url, gltf.scene]);
  return <primitive object={scene} />;
}

function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    o.geometry.dispose();
    const materials: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of materials) {
      for (const value of Object.values(m)) {
        if (value && typeof value === "object" && "isTexture" in value) (value as { dispose(): void }).dispose();
      }
      m.dispose();
    }
  });
}

/** Selection outline for a generated model: the edges of its box (the proxy uses its own edges). */
function BoxOutline({ box }: { box: Box }) {
  const h = box.height_mm * METRES_PER_MM;
  const geometry = useMemo(
    () => new EdgesGeometry(new BoxGeometry(box.width_mm * METRES_PER_MM, h, box.depth_mm * METRES_PER_MM).translate(0, h / 2, 0)),
    [box.width_mm, box.depth_mm, h]
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={SIGNATURE} />
    </lineSegments>
  );
}

type BoundaryProps = { fallback: ReactNode; children: ReactNode };

/** A GLB that fails to load or parse renders the proxy instead (PRD 17: 3D failure degrades to proxy geometry). */
class ModelBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn(`3D model failed to load; showing the proxy: ${error instanceof Error ? error.message : String(error)}`);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
