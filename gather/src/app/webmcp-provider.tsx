"use client";
import { useEffect, useState } from "react";
import { registerTools } from "../webmcp/register";

type Status = "pending" | "ready" | "unavailable";
const LABEL: Record<Status, string> = { pending: "Agent tools loading", ready: "Agent tools ready", unavailable: "Agent tools unavailable in this browser" };

/** The polyfill is opt-in: `?webmcp=polyfill` on the URL, or NEXT_PUBLIC_WEBMCP_POLYFILL=1 at build time. */
function wantsPolyfill(): boolean {
  if (process.env.NEXT_PUBLIC_WEBMCP_POLYFILL === "1") return true;
  return new URLSearchParams(window.location.search).get("webmcp") === "polyfill";
}

/** Registers the tools while the page is mounted and shows whether an agent can see them. */
export function WebMcpProvider() {
  const [status, setStatus] = useState<Status>("pending");
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      if (!document.modelContext && wantsPolyfill()) {
        // @ts-expect-error polyfill.js is Chrome's script, kept verbatim and untyped.
        await import("../webmcp/polyfill.js");
      }
      if (controller.signal.aborted) return;
      const result = await registerTools(controller.signal);
      if (!controller.signal.aborted) setStatus(result.supported ? "ready" : "unavailable");
    })();
    return () => controller.abort();
  }, []);
  return (
    <span className={`tag${status === "ready" ? " green" : ""}`} data-testid="webmcp-status" data-status={status} aria-live="polite">
      {LABEL[status]}
    </span>
  );
}
