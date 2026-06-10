import { describe, expect, it } from "vitest";
import type { DrumEvent, DrumRole, HumanizerChange } from "../types/groove";
import {
  applyRoleSelection,
  createAllRolesSelection,
  createNoRolesSelection,
  type RoleSelection,
} from "./roleSelection";

describe("applyRoleSelection", () => {
  it("preserves deselected kicks while selected hats change", () => {
    const before = [
      makeEvent("kick", "kick", 0, 0.7),
      makeEvent("hat", "closed_hat", 480, 0.5),
    ];
    const after = [
      makeEvent("kick", "kick", 120, 0.9),
      makeEvent("hat", "closed_hat", 600, 0.8),
    ];
    const result = applyRoleSelection({
      beforeEvents: before,
      afterEvents: after,
      changes: makeChanges(before, after),
      selectedRoles: selectionWith({ kick: false }),
    });

    expect(eventFor(result.events, "kick")).toMatchObject({ time: 0, velocity: 0.7 });
    expect(eventFor(result.events, "hat")).toMatchObject({ time: 600, velocity: 0.8 });
  });

  it("distinguishes exact roles such as snare from clap and closed hat from open hat", () => {
    const before = [
      makeEvent("snare", "snare", 960, 0.6),
      makeEvent("clap", "clap", 960, 0.6),
      makeEvent("closed", "closed_hat", 480, 0.5),
      makeEvent("open", "open_hat", 1440, 0.5),
    ];
    const after = before.map((event) => ({
      ...event,
      time: event.time + 120,
      velocity: event.velocity + 0.1,
    }));
    const result = applyRoleSelection({
      beforeEvents: before,
      afterEvents: after,
      changes: makeChanges(before, after),
      selectedRoles: selectionWith({ snare: false, open_hat: false }),
    });

    expect(eventFor(result.events, "snare").time).toBe(960);
    expect(eventFor(result.events, "clap").time).toBe(1080);
    expect(eventFor(result.events, "closed").time).toBe(600);
    expect(eventFor(result.events, "open").time).toBe(1440);
  });

  it("returns unchanged events and no selected count when every role is deselected", () => {
    const before = [
      makeEvent("kick", "kick", 0, 0.7),
      makeEvent("hat", "closed_hat", 480, 0.5),
    ];
    const after = before.map((event) => ({
      ...event,
      time: event.time + 120,
      velocity: event.velocity + 0.1,
    }));
    const result = applyRoleSelection({
      beforeEvents: before,
      afterEvents: after,
      changes: makeChanges(before, after),
      selectedRoles: createNoRolesSelection(),
    });

    expect(result.events).toEqual(before);
    expect(result.selectedCount).toBe(0);
  });

  it("supports selective reset by preserving deselected roles", () => {
    const before = [
      makeEvent("kick", "kick", 101, 0.7),
      makeEvent("snare", "snare", 955, 0.6),
    ];
    const reset = [
      makeEvent("kick", "kick", 0, 0.71),
      makeEvent("snare", "snare", 960, 0.71),
    ];
    const result = applyRoleSelection({
      beforeEvents: before,
      afterEvents: reset,
      changes: [],
      selectedRoles: selectionWith({ kick: false }),
    });

    expect(eventFor(result.events, "kick")).toEqual(before[0]);
    expect(eventFor(result.events, "snare")).toEqual(reset[1]);
  });

  it("creates zero-move changes for deselected roles", () => {
    const before = [makeEvent("kick", "kick", 0, 0.7)];
    const after = [makeEvent("kick", "kick", 120, 0.9)];
    const result = applyRoleSelection({
      beforeEvents: before,
      afterEvents: after,
      changes: makeChanges(before, after),
      selectedRoles: selectionWith({ kick: false }),
    });

    expect(result.changes[0]).toMatchObject({
      id: "kick",
      shiftTicks: 0,
      shiftMs: 0,
      velocityDelta: 0,
      originalVelocity: 0.7,
      newVelocity: 0.7,
    });
  });
});

function selectionWith(overrides: Partial<RoleSelection>) {
  return {
    ...createAllRolesSelection(),
    ...overrides,
  };
}

function makeEvent(id: string, role: DrumRole, time: number, velocity: number): DrumEvent {
  return {
    id,
    role,
    time,
    velocity,
    confidence: 1,
    source: {
      kind: "audiotool-note",
      entityId: id,
    },
  };
}

function makeChanges(before: DrumEvent[], after: DrumEvent[]): HumanizerChange[] {
  const beforeById = new Map(before.map((event) => [event.id, event]));
  return after.map((event) => {
    const original = beforeById.get(event.id) ?? event;
    return {
      id: event.id,
      role: event.role,
      originalTime: original.time,
      newTime: event.time,
      shiftTicks: event.time - original.time,
      shiftMs: event.time - original.time,
      originalVelocity: original.velocity,
      newVelocity: event.velocity,
      velocityDelta: event.velocity - original.velocity,
      added: !beforeById.has(event.id),
    };
  });
}

function eventFor(events: DrumEvent[], id: string) {
  const event = events.find((candidate) => candidate.id === id);
  if (!event) {
    throw new Error(`No event with id ${id}`);
  }
  return event;
}
