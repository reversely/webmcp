"use client";
import { useEffect, useState } from "react";
import { registerGatherTools } from "../webmcp/register";

type Status = "pending" | "ready" | "unavailable";
const LABEL: Record<Status, string> = { pending: "Agent tools loading", ready: "Agent tools ready", unavailable: "Agent tools unavailable in this browser" };

/** The polyfill is opt-in: `?webmcp=polyfill` on the URL, or NEXT_PUBLIC_WEBMCP_POLYFILL=1 at build time. */
function wantsPolyfill(): boolean {
  if (process.env.NEXT_PUBLIC_WEBMCP_POLYFILL === "1") return true;
  return new URLSearchParams(window.location.search).get("webmcp") === "polyfill";
}

/** A write through a tool changes the event; the dashboard listens for this event and re-reads the snapshot. */
function notifyingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then((response) => {
    if (response.ok && init?.method && init.method !== "GET") window.dispatchEvent(new Event("event:changed"));
    return response;
  });
}

/** Registers the organizer-scoped tools while the dashboard is mounted (PRD Section 7) and shows whether an agent can see them. */
export function WebMcpProvider({ eventId }: { eventId: string }) {
  const [status, setStatus] = useState<Status>("pending");
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!document.modelContext && wantsPolyfill()) {
        // @ts-expect-error polyfill.js is Chrome's script, kept verbatim and untyped.
        await import("../webmcp/polyfill.js");
      }
      if (controller.signal.aborted) return;
      const result = await registerGatherTools({ eventId, fetchImpl: notifyingFetch, signal: controller.signal });
      if (!controller.signal.aborted) setStatus(result.supported ? "ready" : "unavailable");
    })();
    return () => controller.abort();
  }, [eventId]);
  return (
    <span className={`pill${status === "ready" ? " live" : ""}`} data-testid="webmcp-status" data-status={status} aria-live="polite">
      {LABEL[status]}
    </span>
  );
}
