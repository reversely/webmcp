"use client";
import { useState } from "react";
import type { snapshot } from "../../../server/api";

type Snapshot = ReturnType<typeof snapshot>;

/** The published event's page: the band with the status and the invite link, and the sheet the tabs fill (#89, #94). */
export function Dashboard({ initial }: { initial: Snapshot }) {
  const [copied, setCopied] = useState(false);
  const event = initial.event;
  const invite = event.invite_code ? `${typeof window !== "undefined" ? window.location.origin : ""}/i/${event.invite_code}` : null;
  return (
    <>
      <header className="band">
        <a className="brand" href="/">Gather</a>
        <div className="right">
          <span className={`pill${event.status === "published" ? " live" : ""}`} data-testid="status">{event.status === "published" ? "Published" : "Draft"}</span>
          {invite && (
            <button className="btn ghost" type="button" onClick={() => { navigator.clipboard?.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1500); }} data-testid="copy-invite">
              {copied ? "Copied" : "Copy invite link"}
            </button>
          )}
        </div>
      </header>
      <main className="sheet">
        <div className="wrap">
          <div>
            <h1 className="title">{event.title}</h1>
            {invite && (
              <div className="linkbox" data-testid="invite-link">
                <span>{invite}</span>
                <span className="tag">Invite</span>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
