import type { DrumEvent, DrumRole, HumanizerChange } from "../types/groove";
import { velocityToMidi } from "./drumFormat";

export type WriteSnapshotAction = "groove" | "reset" | "undo";

export type WriteReviewSummary = {
  totalEvents: number;
  changedEvents: number;
  unchangedEvents: number;
  addedEvents: number;
  unknownEvents: number;
  expectedSkippedEvents: number;
  unsupportedSourceEvents: number;
  includesPatternSteps: boolean;
  maxShiftMs: number;
  maxVelocityDeltaMidi: number;
};

export type LastWriteSnapshot<TSummary> = {
  action: WriteSnapshotAction;
  regionId: string;
  beforeEvents: DrumEvent[];
  afterEvents: DrumEvent[];
  summary: TSummary;
  createdAt: number;
};

export type UndoStateEvent<TSummary> =
  | { type: "write-succeeded"; snapshot: LastWriteSnapshot<TSummary> }
  | { type: "workspace-changed" };

export function summarizeWriteReview(
  beforeEvents: readonly DrumEvent[],
  afterEvents: readonly DrumEvent[],
  changes: readonly HumanizerChange[] = [],
): WriteReviewSummary {
  const beforeById = new Map(beforeEvents.map((event) => [event.id, event]));
  const changesById = new Map(changes.map((change) => [change.id, change]));
  let changedEvents = 0;
  let unchangedEvents = 0;
  let unchangedWritableEvents = 0;
  let addedEvents = 0;
  let unknownEvents = 0;
  let unsupportedSourceEvents = 0;
  let maxShiftMs = 0;
  let maxVelocityDeltaMidi = 0;

  for (const event of afterEvents) {
    const before = beforeById.get(event.id);
    const change = changesById.get(event.id);

    if (event.role === "unknown") {
      unknownEvents += 1;
    }

    const isWritable = isWritableSource(event);
    if (!isWritable) {
      unsupportedSourceEvents += 1;
    }

    if (!before) {
      addedEvents += 1;
      changedEvents += 1;
      maxShiftMs = Math.max(maxShiftMs, Math.abs(change?.shiftMs ?? 0));
      maxVelocityDeltaMidi = Math.max(maxVelocityDeltaMidi, velocityToMidi(event.velocity));
      continue;
    }

    const shiftMs = Math.abs(change?.shiftMs ?? 0);
    const velocityDeltaMidi = Math.abs(
      change
        ? velocityDeltaMidiFromChange(change)
        : velocityToMidi(event.velocity) - velocityToMidi(before.velocity),
    );
    const changed =
      Math.round(before.time) !== Math.round(event.time) ||
      velocityToMidi(before.velocity) !== velocityToMidi(event.velocity);

    if (changed) {
      changedEvents += 1;
      maxShiftMs = Math.max(maxShiftMs, shiftMs);
      maxVelocityDeltaMidi = Math.max(maxVelocityDeltaMidi, velocityDeltaMidi);
    } else {
      unchangedEvents += 1;
      if (isWritable) {
        unchangedWritableEvents += 1;
      }
    }
  }

  const missingTargetEvents = beforeEvents.filter(
    (event) => !afterEvents.some((after) => after.id === event.id),
  );
  unsupportedSourceEvents += missingTargetEvents.filter((event) => !isWritableSource(event)).length;

  return {
    totalEvents: afterEvents.length,
    changedEvents,
    unchangedEvents,
    addedEvents,
    unknownEvents,
    expectedSkippedEvents: unchangedWritableEvents + unsupportedSourceEvents,
    unsupportedSourceEvents,
    includesPatternSteps: afterEvents.some(
      (event) => event.source?.kind === "audiotool-pattern-step",
    ),
    maxShiftMs: Math.round(maxShiftMs),
    maxVelocityDeltaMidi,
  };
}

export function reduceLastWriteSnapshot<TSummary>(
  current: LastWriteSnapshot<TSummary> | null,
  event: UndoStateEvent<TSummary>,
) {
  if (event.type === "write-succeeded") {
    return event.snapshot;
  }

  return current ? null : current;
}

export function undoTargetEvents<TSummary>(snapshot: LastWriteSnapshot<TSummary>) {
  return snapshot.beforeEvents;
}

function isWritableSource(event: DrumEvent) {
  return (
    event.source?.kind === "audiotool-note" ||
    event.source?.kind === "audiotool-pattern-step"
  );
}

function velocityDeltaMidiFromChange(change: HumanizerChange) {
  return velocityToMidi(change.newVelocity) - velocityToMidi(change.originalVelocity);
}
