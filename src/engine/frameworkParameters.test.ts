import { describe, expect, it, vi } from "vitest";
import { defaultFramework } from "../data/humanizerFrameworks";
import type { HumanizerFrameworkParameters } from "../types/groove";
import { sanitizeFrameworkParameters } from "./frameworkParameters";

const DEFAULTS = defaultFramework.parameters;

describe("sanitizeFrameworkParameters", () => {
  it("returns valid parameters unchanged and silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = sanitizeFrameworkParameters(DEFAULTS);
    expect(result).toEqual(DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("replaces non-finite scalars with the default and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = sanitizeFrameworkParameters({
      ...DEFAULTS,
      hatTimingJitterMs: Number.NaN,
      snarePushMs: Number.POSITIVE_INFINITY,
    });
    expect(result.hatTimingJitterMs).toBe(DEFAULTS.hatTimingJitterMs);
    expect(result.snarePushMs).toBe(DEFAULTS.snarePushMs);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("pads a too-short accent array to the required length", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = sanitizeFrameworkParameters({
      ...DEFAULTS,
      hatEighthAccentsMidi: [1, 2] as unknown as HumanizerFrameworkParameters["hatEighthAccentsMidi"],
    });
    expect(result.hatEighthAccentsMidi).toHaveLength(4);
    expect(result.hatEighthAccentsMidi[0]).toBe(1);
    expect(result.hatEighthAccentsMidi[1]).toBe(2);
    // Missing entries fall back to the canonical defaults.
    expect(result.hatEighthAccentsMidi[2]).toBe(DEFAULTS.hatEighthAccentsMidi[2]);
    expect(result.hatEighthAccentsMidi[3]).toBe(DEFAULTS.hatEighthAccentsMidi[3]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never yields an empty accent array (guards modulo-by-zero)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = sanitizeFrameworkParameters({
      ...DEFAULTS,
      hatEighthAccentsMidi: [] as unknown as HumanizerFrameworkParameters["hatEighthAccentsMidi"],
    });
    expect(result.hatEighthAccentsMidi.length).toBeGreaterThan(0);
    warn.mockRestore();
  });
});
