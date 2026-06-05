import { describe, expect, it } from "vitest";
import { humanizeVelocities } from "./velocityHumanizer";
import { createDemoPattern } from "./samplePattern";

describe("humanizeVelocities", () => {
  it("keeps the original pattern immutable", () => {
    const original = createDemoPattern();
    const snapshot = structuredClone(original);

    humanizeVelocities(original, {
      rangeMidi: 10,
      seed: "test",
    });

    expect(original).toEqual(snapshot);
  });

  it("keeps note timing and duration unchanged", () => {
    const original = createDemoPattern();
    const result = humanizeVelocities(original, {
      rangeMidi: 10,
      seed: "test",
    });

    for (const [index, event] of result.events.entries()) {
      expect(event.time).toBe(original[index].time);
      expect(event.duration).toBe(original[index].duration);
    }
  });

  it("keeps every velocity delta inside the configured MIDI range", () => {
    const result = humanizeVelocities(createDemoPattern(), {
      rangeMidi: 10,
      seed: "test",
    });

    expect(result.changes.every((change) => Math.abs(change.deltaMidi) <= 10)).toBe(true);
  });

  it("does not change velocities when the range is zero", () => {
    const original = createDemoPattern();
    const result = humanizeVelocities(original, {
      rangeMidi: 0,
      seed: "test",
    });

    expect(result.events.map((event) => event.velocity)).toEqual(
      original.map((event) => event.velocity),
    );
  });
});
