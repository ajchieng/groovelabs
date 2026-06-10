import type { DrumEvent, DrumRole, HumanizerChange, RoleSummary } from "../types/groove";
import { uniqueById } from "./eventIndex";

export const DRUM_ROLE_ORDER: readonly DrumRole[] = [
  "kick",
  "snare",
  "clap",
  "closed_hat",
  "open_hat",
  "perc",
  "unknown",
];

export type RoleSelection = Record<DrumRole, boolean>;
export type GrooveAdjustmentMode = "position-velocity" | "position" | "velocity";

export type SelectiveRoleResult = {
  events: DrumEvent[];
  changes: HumanizerChange[];
  roleCounts: RoleSummary;
  selectedCount: number;
  selectedRoles: DrumRole[];
};

export function createAllRolesSelection(): RoleSelection {
  return Object.fromEntries(DRUM_ROLE_ORDER.map((role) => [role, true])) as RoleSelection;
}

export function createNoRolesSelection(): RoleSelection {
  return Object.fromEntries(DRUM_ROLE_ORDER.map((role) => [role, false])) as RoleSelection;
}

export function selectedRolesFromSelection(selection: RoleSelection) {
  return DRUM_ROLE_ORDER.filter((role) => selection[role]);
}

export function applyRoleSelection({
  beforeEvents,
  afterEvents,
  changes,
  selectedRoles,
  adjustmentMode = "position-velocity",
}: {
  beforeEvents: readonly DrumEvent[];
  afterEvents: readonly DrumEvent[];
  changes: readonly HumanizerChange[];
  selectedRoles: RoleSelection;
  adjustmentMode?: GrooveAdjustmentMode;
}): SelectiveRoleResult {
  const uniqueBefore = uniqueById(beforeEvents, "applyRoleSelection.before");
  const uniqueAfter = uniqueById(afterEvents, "applyRoleSelection.after");
  const beforeById = new Map(uniqueBefore.map((event) => [event.id, event]));
  const afterIds = new Set(uniqueAfter.map((event) => event.id));
  const changesById = new Map(
    uniqueById(changes, "applyRoleSelection.changes").map((change) => [change.id, change]),
  );
  const selectedRoleList = selectedRolesFromSelection(selectedRoles);
  const roleCounts = createEmptyRoleSummary();
  let selectedCount = 0;
  const selectiveEvents: DrumEvent[] = [];
  const selectiveChanges: HumanizerChange[] = [];

  for (const afterEvent of uniqueAfter) {
    const beforeEvent = beforeById.get(afterEvent.id);
    const role = beforeEvent?.role ?? afterEvent.role;
    roleCounts[role] += 1;

    if (!beforeEvent) {
      if (selectedRoles[role]) {
        selectedCount += 1;
        selectiveEvents.push(afterEvent);
        selectiveChanges.push(changesById.get(afterEvent.id) ?? makeAddedChange(afterEvent));
      }
      continue;
    }

    if (selectedRoles[role]) {
      const selectiveEvent = applyAdjustmentMode(beforeEvent, afterEvent, adjustmentMode);
      selectedCount += 1;
      selectiveEvents.push(selectiveEvent);
      selectiveChanges.push(
        makeSelectiveChange(beforeEvent, selectiveEvent, changesById.get(afterEvent.id)),
      );
    } else {
      selectiveEvents.push(beforeEvent);
      selectiveChanges.push(makeZeroChange(beforeEvent));
    }
  }

  for (const beforeEvent of uniqueBefore) {
    if (afterIds.has(beforeEvent.id)) {
      continue;
    }

    roleCounts[beforeEvent.role] += 1;
    if (selectedRoles[beforeEvent.role]) {
      selectedCount += 1;
    }
    selectiveEvents.push(beforeEvent);
    selectiveChanges.push(makeZeroChange(beforeEvent));
  }

  return {
    events: selectiveEvents,
    changes: selectiveChanges,
    roleCounts,
    selectedCount,
    selectedRoles: selectedRoleList,
  };
}

export function createEmptyRoleSummary(): RoleSummary {
  return Object.fromEntries(DRUM_ROLE_ORDER.map((role) => [role, 0])) as RoleSummary;
}

function applyAdjustmentMode(
  beforeEvent: DrumEvent,
  afterEvent: DrumEvent,
  adjustmentMode: GrooveAdjustmentMode,
): DrumEvent {
  switch (adjustmentMode) {
    case "position":
      return {
        ...afterEvent,
        velocity: beforeEvent.velocity,
      };
    case "velocity":
      return {
        ...afterEvent,
        time: beforeEvent.time,
        duration: beforeEvent.duration,
      };
    case "position-velocity":
      return afterEvent;
  }
}

function makeSelectiveChange(
  beforeEvent: DrumEvent,
  afterEvent: DrumEvent,
  sourceChange?: HumanizerChange,
): HumanizerChange {
  const shiftTicks = afterEvent.time - beforeEvent.time;
  let shiftMs = 0;
  if (sourceChange && shiftTicks === sourceChange.shiftTicks) {
    shiftMs = sourceChange.shiftMs;
  } else if (shiftTicks !== 0 && sourceChange?.shiftTicks) {
    shiftMs = sourceChange.shiftMs * (shiftTicks / sourceChange.shiftTicks);
  } else if (shiftTicks !== 0) {
    shiftMs = shiftTicks;
  }

  return {
    id: afterEvent.id,
    originalId: sourceChange?.originalId,
    role: beforeEvent.role,
    originalTime: beforeEvent.time,
    newTime: afterEvent.time,
    shiftTicks,
    shiftMs: Number.isFinite(shiftMs) ? shiftMs : 0,
    originalVelocity: beforeEvent.velocity,
    newVelocity: afterEvent.velocity,
    velocityDelta: afterEvent.velocity - beforeEvent.velocity,
    added: false,
  };
}

function makeZeroChange(event: DrumEvent): HumanizerChange {
  return {
    id: event.id,
    role: event.role,
    originalTime: event.time,
    newTime: event.time,
    shiftTicks: 0,
    shiftMs: 0,
    originalVelocity: event.velocity,
    newVelocity: event.velocity,
    velocityDelta: 0,
    added: false,
  };
}

function makeAddedChange(event: DrumEvent): HumanizerChange {
  return {
    id: event.id,
    role: event.role,
    originalTime: event.time,
    newTime: event.time,
    shiftTicks: 0,
    shiftMs: 0,
    originalVelocity: 0,
    newVelocity: event.velocity,
    velocityDelta: event.velocity,
    added: true,
  };
}
