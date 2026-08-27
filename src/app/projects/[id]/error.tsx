"use client";

/** A server fault on a stage renders as a plain message with a retry, never as a blank page. */
export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="centre">
      <h1 className="page-title">This stage failed to load</h1>
      <p className="page-summary">{error.message}</p>
      <button className="btn primary" type="button" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
