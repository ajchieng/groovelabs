import { describe, expect, it } from "vitest";
import { defaultPreset } from "../data/groovePresets";
import { TICKS_PER_BEAT } from "../types/groove";
import { applyGroove } from "./grooveEngine";
import { createDemoPattern } from "./samplePattern";

describe("applyGroove", () => {
  it("keeps the original pattern immutable", () => {
    const original = createDemoPattern();
    const snapshot = structuredClone(original);

    applyGroove(original, defaultPreset, {
      intensity: 0.7,
      tempoBpm: 92,
      seed: "test",
    });

    expect(original).toEqual(snapshot);
  });

  it("delays detected snare notes when intensity is enabled", () => {
    const original = createDemoPattern();
    const result = applyGroove(original, defaultPreset, {
      intensity: 1,
      tempoBpm: 90,
      seed: "test",
    });

    const snareChange = result.changes.find(
      (change) => change.role === "snare" && change.originalTime === TICKS_PER_BEAT,
    );

    expect(snareChange?.shiftMs).toBeGreaterThan(10);
  });

  it("returns original timings at zero intensity except generated changes are suppressed", () => {
    const original = createDemoPattern();
    const result = applyGroove(original, defaultPreset, {
      intensity: 0,
      tempoBpm: 90,
      seed: "test",
    });

    expect(result.events).toHaveLength(original.length);
    expect(result.changes.every((change) => change.shiftTicks === 0)).toBe(true);
  });
});
