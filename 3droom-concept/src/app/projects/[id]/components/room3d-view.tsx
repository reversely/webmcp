"use client";
import dynamic from "next/dynamic";
import type { Room3DProps } from "../../../../components/room3d/types";
import css from "./stages.module.css";

export type { RoomItem, Room3DProps } from "../../../../components/room3d/types";

function Missing() {
  return <div className="empty">The 3D view is not available in this build. The 2D plan carries the same placements.</div>;
}

/**
 * Lazy client-only wrapper for `Room3D` from src/components/room3d. The import resolves the
 * module at runtime, so a build where the export is missing renders the empty state instead.
 */
const Room3D = dynamic<Room3DProps>(
  () =>
    import("../../../../components/room3d")
      .then((m) => (m as { Room3D?: React.ComponentType<Room3DProps> }).Room3D ?? Missing)
      .catch(() => Missing),
  { ssr: false, loading: () => <div className="empty">Loading the 3D view.</div> }
);

export function Room3DView(props: Room3DProps) {
  return (
    <div className={css.plan3d}>
      <Room3D {...props} className={css.plan3d} />
    </div>
  );
}
