/**
 * A small Server-Sent Events reader for the chat stream (#19): splits the byte stream into
 * events at blank lines, joins multi-line `data:` fields, and ignores comments and retry hints.
 */
export type SseEvent = { event: string; data: string };

/** Parses complete events out of `buffer`; `rest` is the tail that has not ended yet. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let start = 0;
  for (;;) {
    const end = normalized.indexOf("\n\n", start);
    if (end < 0) break;
    const block = normalized.slice(start, end);
    start = end + 2;
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }
  return { events, rest: normalized.slice(start) };
}

/** Reads `body` to the end, calling `onEvent` for each complete event as it arrives. */
export async function readSse(body: ReadableStream<Uint8Array>, onEvent: (event: SseEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const parsed = parseSse(done ? `${buffer}\n\n` : buffer);
    buffer = parsed.rest;
    for (const e of parsed.events) onEvent(e);
    if (done) return;
  }
}
