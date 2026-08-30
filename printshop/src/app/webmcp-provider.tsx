"use client";
import { useEffect, useState } from "react";
import { registerShopTools } from "../webmcp/register";

type Status = "pending" | "ready" | "unavailable";
const LABEL: Record<Status, string> = { pending: "Agent tools loading", ready: "Agent tools ready", unavailable: "Agent tools unavailable in this browser" };

function wantsPolyfill(): boolean {
  if (process.env.NEXT_PUBLIC_WEBMCP_POLYFILL === "1") return true;
  return new URLSearchParams(window.location.search).get("webmcp") === "polyfill";
}

/** Registers the shop's tools while a page is mounted; a write through a tool re-reads the page. */
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
      const notifying: typeof fetch = (input, init) => fetch(input, init).then((r) => { if (r.ok && init?.method && init.method !== "GET") window.dispatchEvent(new Event("shop:changed")); return r; });
      const result = await registerShopTools(controller.signal, notifying);
      if (!controller.signal.aborted) setStatus(result.supported ? "ready" : "unavailable");
    })();
    return () => controller.abort();
  }, []);
  return <span className={`pill${status === "ready" ? " live" : ""}`} data-testid="webmcp-status" data-status={status} aria-live="polite">{LABEL[status]}</span>;
}
