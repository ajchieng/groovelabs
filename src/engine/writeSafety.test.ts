import { describe, expect, it } from "vitest";
import type { DrumEvent, HumanizerChange } from "../types/groove";
import {
  reduceLastWriteSnapshot,
  summarizeWriteReview,
  undoTargetEvents,
  type LastWriteSnapshot,
} from "./writeSafety";

describe("summarizeWriteReview", () => {
  it("counts timing and velocity changes", () => {
    const before = [
      makeEvent("kick", "kick", 0, 0.7),
      makeEvent("snare", "snare", 960, 0.6),
    ];
    const after = [
      makeEvent("kick", "kick", 120, 0.7),
      makeEvent("snare", "snare", 960, 0.8),
    ];
    const changes: HumanizerChange[] = [
      makeChange("kick", "kick", 0, 120, 0.7, 0.7, 3),
      makeChange("snare", "snare", 960, 960, 0.6, 0.8, 0),
    ];

    expect(summarizeWriteReview(before, after, changes)).toMatchObject({
      totalEvents: 2,
      changedEvents: 2,
      unchangedEvents: 0,
      maxShiftMs: 3,
      maxVelocityDeltaMidi: 26,
    });
  });

  it("reports unknown unchanged events as expected skips", () => {
    const before = [makeEvent("mystery", "unknown", 0, 0.5)];
    const after = [makeEvent("mystery", "unknown", 0, 0.5)];

    expect(summarizeWriteReview(before, after)).toMatchObject({
      changedEvents: 0,
      unchangedEvents: 1,
      unknownEvents: 1,
      expectedSkippedEvents: 1,
    });
  });

  it("detects pattern-step write targets", () => {
    const before = [makeEvent("hat", "closed_hat", 0, 0.7, "audiotool-pattern-step")];
    const after = [makeEvent("hat", "closed_hat", 240, 0.72, "audiotool-pattern-step")];

    expect(summarizeWriteReview(before, after)).toMatchObject({
      changedEvents: 1,
      includesPatternSteps: true,
    });
  });

  it("handles empty selections", () => {
    expect(summarizeWriteReview([], [])).toEqual({
      totalEvents: 0,
      changedEvents: 0,
      unchangedEvents: 0,
      addedEvents: 0,
      unknownEvents: 0,
      expectedSkippedEvents: 0,
      unsupportedSourceEvents: 0,
      includesPatternSteps: false,
      maxShiftMs: 0,
      maxVelocityDeltaMidi: 0,
    });
  });
});

describe("undo helpers", () => {
  it("stores the latest successful write snapshot", () => {
    const snapshot = makeSnapshot("groove");

    expect(reduceLastWriteSnapshot(null, { type: "write-succeeded", snapshot })).toBe(snapshot);
  });

  it("clears undo state when the workspace changes", () => {
    expect(
      reduceLastWriteSnapshot(makeSnapshot("reset"), { type: "workspace-changed" }),
    ).toBeNull();
  });

  it("uses beforeEvents as the undo write target", () => {
    const snapshot = makeSnapshot("groove");

    expect(undoTargetEvents(snapshot)).toBe(snapshot.beforeEvents);
  });
});

function makeEvent(
  id: string,
  role: DrumEvent["role"],
  time: number,
  velocity: number,
  sourceKind: NonNullable<DrumEvent["source"]>["kind"] = "audiotool-note",
): DrumEvent {
  return {
    id,
    role,
    time,
    velocity,
    confidence: 1,
    source: {
      kind: sourceKind,
      entityId: id,
    },
  };
}

function makeChange(
  id: string,
  role: DrumEvent["role"],
  originalTime: number,
  newTime: number,
  originalVelocity: number,
  newVelocity: number,
  shiftMs: number,
): HumanizerChange {
  return {
    id,
    role,
    originalTime,
    newTime,
    shiftTicks: newTime - originalTime,
    shiftMs,
    originalVelocity,
    newVelocity,
    velocityDelta: newVelocity - originalVelocity,
    added: false,
  };
}

function makeSnapshot(action: "groove" | "reset"): LastWriteSnapshot<{ updated: number }> {
  return {
    action,
    regionId: "__all__",
    beforeEvents: [makeEvent("kick", "kick", 0, 0.7)],
    afterEvents: [makeEvent("kick", "kick", 120, 0.8)],
    summary: { updated: 1 },
    createdAt: 1,
  };
}
