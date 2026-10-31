import { describe, expect, it } from "vitest";
import { fail, ok } from "../src/index.js";

describe("Result helpers", () => {
  it("ok wraps a value", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("fail accepts one error or a list", () => {
    const e = { code: "x.y", message: "bad" };
    expect(fail(e)).toEqual({ ok: false, errors: [e] });
    expect(fail([e, e])).toEqual({ ok: false, errors: [e, e] });
  });

  it("fail with no errors is a programmer error", () => {
    expect(() => fail([])).toThrow();
  });
});
