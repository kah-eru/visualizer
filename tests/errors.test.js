import { describe, it, expect, beforeAll } from "vitest";

// errors.js installs window "error"/"unhandledrejection" listeners and tees console.error/warn at
// IMPORT time. Provide a minimal window shim so the module imports under the Node test environment
// (no jsdom dependency needed); we exercise the pure ring-buffer API, not the DOM banner.
let getErrorLog, pushError, guard;
beforeAll(async () => {
  globalThis.window = { addEventListener() {} };
  ({ getErrorLog, pushError, guard } = await import("../src/errors.js"));
});

describe("errors.js ring buffer", () => {
  it("records entries and returns a snapshot copy (most recent last)", () => {
    pushError("test", "first message");
    const log = getErrorLog();
    expect(Array.isArray(log)).toBe(true);
    expect(log.at(-1)).toMatchObject({ type: "test", message: "first message" });
    // getErrorLog returns a copy — mutating it must not affect the internal buffer
    const len = log.length;
    log.push({ bogus: true });
    expect(getErrorLog().length).toBe(len);
  });

  it("caps the buffer at 50 entries, dropping the oldest", () => {
    for (let i = 0; i < 80; i++) pushError("flood", `msg ${i}`);
    const log = getErrorLog();
    expect(log.length).toBe(50);
    expect(log.at(-1).message).toBe("msg 79");           // newest kept
    expect(log.some(e => e.message === "msg 0")).toBe(false); // oldest evicted
  });

  it("truncates over-long messages (1000 chars) and stacks (4000 chars)", () => {
    pushError("big", "x".repeat(5000), "y".repeat(9000));
    const last = getErrorLog().at(-1);
    expect(last.message.length).toBe(1000);
    expect(last.stack.length).toBe(4000);
  });

  it("tees console.error/warn into the buffer without swallowing them", () => {
    console.error("teed error", { a: 1 });
    console.warn("teed warn");
    const log = getErrorLog();
    expect(log.some(e => e.type === "console.error" && e.message.includes("teed error"))).toBe(true);
    expect(log.some(e => e.type === "console.warn" && e.message.includes("teed warn"))).toBe(true);
  });
});

describe("guard", () => {
  it("returns the function result on success", () => {
    expect(guard(() => 42, "ctx")).toBe(42);
  });
});
