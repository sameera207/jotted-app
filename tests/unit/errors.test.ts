import { describe, expect, it } from "vitest";
import { handlingFor, JottedError } from "../../src/jotted/errors";

const e = (code: string, extra = {}) => new JottedError("x", { code, message: `m:${code}`, ...extra });

describe("error handling, by code", () => {
  it.each([
    ["not_set_up", { kind: "setup", step: "llm" }, { step: "llm" }],
    ["busy", { kind: "banner", message: "Your reMarkable is busy; try again in a moment", action: null }, {}],
    ["not_connected", { kind: "banner", message: "m:not_connected", action: "reconnect" }, {}],
    ["model_error", { kind: "banner", message: "m:model_error", action: "check-key" }, {}],
    ["invalid", { kind: "inline", message: "m:invalid" }, {}],
    ["not_found", { kind: "inline", message: "m:not_found" }, {}],
    ["conflict", { kind: "inline", message: "m:conflict" }, {}],
    ["config", { kind: "panel", message: "m:config" }, {}],
    ["internal", { kind: "panel", message: "m:internal" }, {}],
    ["something_new", { kind: "panel", message: "m:something_new" }, {}],
  ])("%s", (code, expected, extra) => {
    expect(handlingFor(e(code, extra))).toEqual(expected);
  });

  it("never branches on the message", () => {
    expect(handlingFor(e("internal", { message: "not_connected" })).kind).toBe("panel");
  });
});
