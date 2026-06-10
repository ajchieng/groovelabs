import { describe, expect, it } from "vitest";
import {
  clamp,
  hashString,
  msToTicks,
  nearestGridDistance,
  seededSigned,
  seededUnit,
  ticksToMs,
} from "./math";

describe("clamp", () => {
  it("returns the value when inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to the bounds", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

describe("ticksToMs / msToTicks", () => {
  it("converts ticks to milliseconds at a known tempo", () => {
    // 120 BPM => 500ms per beat. One beat of ticks => 500ms.
    expect(ticksToMs(3840, 120, 3840)).toBeCloseTo(500, 6);
  });

  it("round-trips through ms and back", () => {
    const ticks = 1234;
    const ms = ticksToMs(ticks, 92, 3840);
    expect(msToTicks(ms, 92, 3840)).toBeCloseTo(ticks, 6);
  });

  it("returns 0 instead of NaN/Infinity for an invalid tempo", () => {
    for (const badTempo of [0, -120, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(ticksToMs(3840, badTempo, 3840)).toBe(0);
      expect(msToTicks(500, badTempo, 3840)).toBe(0);
    }
  });
});

describe("hashString", () => {
  it("is deterministic for equal inputs", () => {
    expect(hashString("kick:1")).toBe(hashString("kick:1"));
  });

  it("differs across inputs", () => {
    expect(hashString("kick:1")).not.toBe(hashString("kick:2"));
  });
});

describe("seededUnit", () => {
  it("returns a value in [0, 1)", () => {
    for (const seed of ["a", "b", "long-seed-string", "snare:42:time"]) {
      const value = seededUnit(seed);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is deterministic for equal seeds and varies across seeds", () => {
    expect(seededUnit("seed-x")).toBe(seededUnit("seed-x"));
    expect(seededUnit("seed-x")).not.toBe(seededUnit("seed-y"));
  });
});

describe("seededSigned", () => {
  it("returns a value in [-1, 1)", () => {
    for (const seed of ["a", "b", "c", "hat:7:vel"]) {
      const value = seededSigned(seed);
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("nearestGridDistance", () => {
  it("is zero on a grid line", () => {
    expect(nearestGridDistance(3840, 960)).toBe(0);
  });

  it("returns the signed distance to the nearest grid line", () => {
    expect(nearestGridDistance(100, 960)).toBe(100);
    expect(nearestGridDistance(900, 960)).toBe(-60);
  });
});
