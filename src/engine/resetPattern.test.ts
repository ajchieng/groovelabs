import { describe, expect, it } from "vitest";
import { TICKS_PER_BEAT, type DrumEvent } from "../types/groove";
import { RESET_VELOCITY, resetPatternToGrooveGrid, resetPatternToSixteenths } from "./resetPattern";

describe("resetPatternToSixteenths", () => {
  it("quantizes note positions to the nearest sixteenth and makes velocity uniform", () => {
    const original = createLoosePattern();
    const reset = resetPatternToSixteenths(original);

    expect(reset.map((event) => event.time)).toEqual([
      0,
      TICKS_PER_BEAT / 4,
      (TICKS_PER_BEAT * 3) / 4,
    ]);
    expect(reset.map((event) => event.velocity)).toEqual([
      RESET_VELOCITY,
      RESET_VELOCITY,
      RESET_VELOCITY,
    ]);
  });

  it("keeps the original events immutable", () => {
    const original = createLoosePattern();
    const snapshot = structuredClone(original);

    resetPatternToSixteenths(original);

    expect(original).toEqual(snapshot);
  });
});

describe("resetPatternToGrooveGrid", () => {
  it("quantizes eighth-note hat grooves to eighth hats and kicks and snares to sixteenths", () => {
    const reset = resetPatternToGrooveGrid(createLoosePattern(), { hatSubdivision: "eighth" });

    expect(timeFor(reset, "hat")).toBe(TICKS_PER_BEAT / 2);
    expect(timeFor(reset, "kick")).toBe(0);
    expect(timeFor(reset, "snare")).toBe((TICKS_PER_BEAT * 3) / 4);
  });

  it("quantizes sixteenth-note hat grooves to sixteenth hats and kicks and snares to sixteenths", () => {
    const reset = resetPatternToGrooveGrid(createLoosePattern(), { hatSubdivision: "sixteenth" });

    expect(timeFor(reset, "hat")).toBe(TICKS_PER_BEAT / 4);
    expect(timeFor(reset, "kick")).toBe(0);
    expect(timeFor(reset, "snare")).toBe((TICKS_PER_BEAT * 3) / 4);
  });
});

function createLoosePattern(): DrumEvent[] {
  return [
    {
      id: "kick",
      time: 62,
      pitch: 36,
      velocity: 0.91,
      role: "kick",
      confidence: 1,
    },
    {
      id: "hat",
      time: TICKS_PER_BEAT / 4 + 118,
      pitch: 42,
      velocity: 0.47,
      role: "closed_hat",
      confidence: 1,
    },
    {
      id: "snare",
      time: (TICKS_PER_BEAT * 3) / 4 - 180,
      pitch: 38,
      velocity: 0.76,
      role: "snare",
      confidence: 1,
    },
  ];
}

function timeFor(events: DrumEvent[], id: string) {
  const event = events.find((candidate) => candidate.id === id);
  if (!event) {
    throw new Error(`No event with id ${id}`);
  }
  return event.time;
}
