import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "../../src/jotted/client";
import { JottedError } from "../../src/jotted/errors";
import { data, fakeTransport, fixture } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("client", () => {
  it("returns data from the envelope", async () => {
    fakeTransport(() => fixture("version"));
    expect((await client.version()).contract).toBe(1);
  });

  it("throws JottedError with the envelope's code", async () => {
    fakeTransport(() => fixture("error-not-found"));
    const error = await client.itemsDone(999).catch((e) => e);
    expect(error).toBeInstanceOf(JottedError);
    expect(error.code).toBe("not_found");
    expect(error.command).toBe("items done");
  });

  it("retries busy after 1, 2 and 4 s, then gives up", async () => {
    vi.useFakeTimers();
    const calls = fakeTransport(() => ({ v: 1, ok: false, error: { code: "busy", message: "busy", retry: true } }));
    const result = client.check().catch((e) => e);
    await vi.advanceTimersByTimeAsync(999);
    expect(calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1 + 2000 + 4000);
    const error = await result;
    expect(calls.length).toBe(4);
    expect(error.code).toBe("busy");
  });

  it("stops retrying once busy clears", async () => {
    vi.useFakeTimers();
    let n = 0;
    fakeTransport(() => (n++ < 1 ? { v: 1, ok: false, error: { code: "busy", message: "busy" } } : fixture("items-all")));
    const result = client.items({ status: "all" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual(data("items-all"));
  });
});
