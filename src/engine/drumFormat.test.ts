import { describe, expect, it } from "vitest";
import type { DrumRole, HatSubdivision } from "../types/groove";
import { hatSubdivisionLabel, midiToVelocity, roleLabel, velocityToMidi } from "./drumFormat";

describe("velocityToMidi", () => {
  it("scales and rounds a unit velocity to 0..127", () => {
    expect(velocityToMidi(0)).toBe(0);
    expect(velocityToMidi(1)).toBe(127);
    expect(velocityToMidi(0.5)).toBe(64);
  });

  it("clamps out-of-range velocities", () => {
    expect(velocityToMidi(-0.5)).toBe(0);
    expect(velocityToMidi(2)).toBe(127);
  });
});

describe("midiToVelocity", () => {
  it("scales and rounds a MIDI velocity to a 4-digit unit value", () => {
    expect(midiToVelocity(127)).toBe(1);
    expect(midiToVelocity(0)).toBe(0);
    expect(midiToVelocity(64)).toBe(0.5039);
  });

  it("clamps out-of-range MIDI velocities", () => {
    expect(midiToVelocity(-10)).toBe(0);
    expect(midiToVelocity(200)).toBe(1);
  });

  it("round-trips a MIDI value back to itself", () => {
    expect(velocityToMidi(midiToVelocity(100))).toBe(100);
  });
});

describe("roleLabel", () => {
  it("uses friendly labels for hat roles", () => {
    expect(roleLabel("closed_hat")).toBe("Closed Hat");
    expect(roleLabel("open_hat")).toBe("Open Hat");
  });

  it("capitalizes the default-branch roles", () => {
    const cases: Array<[DrumRole, string]> = [
      ["kick", "Kick"],
      ["snare", "Snare"],
      ["clap", "Clap"],
      ["perc", "Perc"],
      ["unknown", "Unknown"],
    ];
    for (const [role, expected] of cases) {
      expect(roleLabel(role)).toBe(expected);
    }
  });
});

describe("hatSubdivisionLabel", () => {
  it("labels every subdivision", () => {
    const cases: Array<[HatSubdivision, string]> = [
      ["quarter", "4ths"],
      ["eighth", "8ths"],
      ["sixteenth", "16ths"],
      ["mixed", "Mixed"],
      ["none", "None"],
    ];
    for (const [subdivision, expected] of cases) {
      expect(hatSubdivisionLabel(subdivision)).toBe(expected);
    }
  });
});
