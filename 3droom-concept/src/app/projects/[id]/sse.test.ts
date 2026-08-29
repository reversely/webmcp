import { describe, expect, it } from "vitest";
import { parseSse, readSse, type SseEvent } from "./sse";

describe("parseSse", () => {
  it("splits events at blank lines, joins data lines, and keeps an unfinished tail", () => {
    const { events, rest } = parseSse('event: tool\ndata: {"a":1}\n\n: ping\n\ndata: first\ndata: second\n\nevent: done\ndata: {"x"');
    expect(events).toEqual([
      { event: "tool", data: '{"a":1}' },
      { event: "message", data: "first\nsecond" }
    ]);
    expect(rest).toBe('event: done\ndata: {"x"');
  });

  it("accepts CRLF line ends and a data field without the space after the colon", () => {
    const { events } = parseSse("event:text\r\ndata:hello\r\n\r\n");
    expect(events).toEqual([{ event: "text", data: "hello" }]);
  });
});

describe("readSse", () => {
  it("delivers events as chunks arrive, across chunk boundaries that split a line", async () => {
    const chunks = ['event: text\ndata: {"t":', '"one"}\n\nevent: to', 'ol\ndata: {"n":"x"}\n\n', "event: done\ndata: {}"];
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      }
    });
    const seen: SseEvent[] = [];
    await readSse(body, (e) => seen.push(e));
    expect(seen).toEqual([
      { event: "text", data: '{"t":"one"}' },
      { event: "tool", data: '{"n":"x"}' },
      { event: "done", data: "{}" }
    ]);
  });
});
