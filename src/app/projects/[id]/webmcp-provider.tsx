"use client";
import { useEffect, useState } from "react";
import { registerPlannerTools } from "../../../webmcp/register";

type Status = "pending" | "ready" | "unavailable";

const LABEL: Record<Status, string> = {
  pending: "Agent tools loading",
  ready: "Agent tools ready",
  unavailable: "Agent tools unavailable in this browser"
};

/**
 * The polyfill is opt-in: `?webmcp=polyfill` on the URL, or NEXT_PUBLIC_WEBMCP_POLYFILL=1 at build
 * time. Playwright's Chromium has no native `document.modelContext`, so the suite opens pages with
 * the query flag.
 */
function wantsPolyfill(): boolean {
  if (process.env.NEXT_PUBLIC_WEBMCP_POLYFILL === "1") return true;
  return new URLSearchParams(window.location.search).get("webmcp") === "polyfill";
}

/** A write through a tool changes the project; the rail and stage listen for this event. */
function notifyingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then((response) => {
    if (response.ok && init?.method && init.method !== "GET") window.dispatchEvent(new Event("project:changed"));
    return response;
  });
}

/**
 * Registers the seven planner tools on `document.modelContext` for the project page (PRD 18) and
 * unregisters them when the page leaves. Renders the availability tag next to the stage nav.
 */
export function WebMcpProvider({ projectId }: { projectId: string }) {
  const [status, setStatus] = useState<Status>("pending");

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!document.modelContext && wantsPolyfill()) {
        // @ts-expect-error polyfill.js is Chrome's script, kept verbatim and untyped.
        await import("../../../webmcp/polyfill.js");
      }
      if (controller.signal.aborted) return;
      const result = await registerPlannerTools({ projectId, fetchImpl: notifyingFetch, signal: controller.signal });
      if (!controller.signal.aborted) setStatus(result.supported ? "ready" : "unavailable");
    })();
    return () => controller.abort();
  }, [projectId]);

  return (
    <span className={`tag${status === "ready" ? " green" : ""}`} data-testid="webmcp-status" data-status={status} aria-live="polite">
      {LABEL[status]}
    </span>
  );
}
