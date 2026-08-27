"use client";
import { useState } from "react";
import type { ModelJob, ModelStageName } from "../../../../server/state";
import css from "./stages.module.css";

/** The stages a running job passes through, in order, as the dots draw them (#49). */
const PIPELINE: ModelStageName[] = ["queued", "image_fetched", "mesh_generated", "normalized", "verified", "ready"];

const stageLabel = (name: ModelStageName) => name.replace("_", " ");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Wall time so far for a job still running, from its `queued` stamp to now. */
function elapsedNow(job: ModelJob): number {
  return Math.max(0, Date.now() - Date.parse(job.stages[0]?.at ?? job.created_at));
}

export function isRunning(job: ModelJob): boolean {
  return job.status === "queued" || job.status === "generating";
}

/** Rail tag text for a job: "3D mesh generated" while running, "3D proxy" after a fall-back, nothing when ready. */
export function modelTagFor(job: ModelJob | undefined, status: ModelJob["status"]): string | null {
  if (job && isRunning(job)) return `3D ${stageLabel(job.stages[job.stages.length - 1]?.name ?? "queued")}`;
  if (status === "queued" || status === "generating") return "3D generating";
  if (status === "proxy") return "3D proxy";
  return null;
}

/**
 * One line under a product: quiet dots for the pipeline, the current stage named, elapsed time in
 * mono. Re-renders on the snapshot poll, so the numbers move every few seconds. Ready collapses to
 * the total; proxy names the error and offers to try again.
 */
export function ModelStageStrip({ job, productId, projectId, status }: { job: ModelJob | undefined; productId: string; projectId: string; status: ModelJob["status"] }) {
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    try {
      await fetch("/api/3d/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, projectId }) });
      window.dispatchEvent(new Event("project:changed"));
    } finally {
      setBusy(false);
    }
  }

  const retryButton = (
    <button className="btn" type="button" onClick={retry} disabled={busy} data-testid="generate-3d">
      {busy ? "Starting" : "Generate 3D"}
    </button>
  );

  if (!job) {
    return status === "proxy" ? <div className={css.stages} data-testid="model-stages" data-stage="proxy">{retryButton}</div> : null;
  }
  const current = job.stages[job.stages.length - 1];

  if (job.status === "ready") {
    return (
      <div className={css.stages} data-testid="model-stages" data-stage="ready">
        {current?.detail === "cached" ? "3D from cache" : <>3D generated in <span className={css.mm}>{seconds(job.elapsed_ms)}</span></>}
      </div>
    );
  }
  if (job.status === "proxy" || job.status === "failed") {
    return (
      <div className={css.stages} data-testid="model-stages" data-stage="proxy" title={job.error ?? undefined}>
        <span>
          3D proxy after <span className={css.mm}>{seconds(job.elapsed_ms)}</span>
          {job.error ? ` · ${job.error}` : ""}
        </span>
        {retryButton}
      </div>
    );
  }

  const reached = new Set(job.stages.map((s) => s.name));
  const currentName = current?.name ?? "queued";
  return (
    <div className={css.stages} data-testid="model-stages" data-stage={currentName} title={current?.detail}>
      <span className={css.dots} aria-hidden="true">
        {PIPELINE.map((name) => (
          <span key={name} className={`${css.dot} ${name === currentName ? css.dotCurrent : reached.has(name) ? css.dotDone : ""}`} />
        ))}
      </span>
      <span className={css.stageName}>{stageLabel(currentName)}</span>
      <span className={css.mm}>{seconds(elapsedNow(job))}</span>
    </div>
  );
}
