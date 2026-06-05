import type { DrumEvent, DrumRole } from "../types/groove";
import { clamp, seededUnit } from "./math";

export type VelocityHumanizerOptions = {
  rangeMidi: number;
  seed?: string;
  minMidi?: number;
  maxMidi?: number;
};

export type VelocityHumanizeChange = {
  id: string;
  role: DrumRole;
  time: number;
  originalVelocity: number;
  newVelocity: number;
  originalVelocityMidi: number;
  newVelocityMidi: number;
  deltaMidi: number;
};

export type VelocityHumanizerResult = {
  events: DrumEvent[];
  changes: VelocityHumanizeChange[];
  explanation: string;
  averageAbsoluteDeltaMidi: number;
  maxAbsoluteDeltaMidi: number;
};

export function humanizeVelocities(
  inputEvents: DrumEvent[],
  options: VelocityHumanizerOptions,
): VelocityHumanizerResult {
  const rangeMidi = Math.round(clamp(options.rangeMidi, 0, 127));
  const minMidi = Math.round(clamp(options.minMidi ?? 1, 0, 127));
  const maxMidi = Math.round(clamp(options.maxMidi ?? 127, minMidi, 127));
  const seed = options.seed ?? "velocity-humanizer";

  const changes: VelocityHumanizeChange[] = [];
  const events = inputEvents.map((event) => {
    const originalVelocityMidi = velocityToMidi(event.velocity);
    const randomDeltaMidi = randomIntInRange(`${seed}:${event.id}:velocity`, rangeMidi);
    const newVelocityMidi = Math.round(
      clamp(originalVelocityMidi + randomDeltaMidi, minMidi, maxMidi),
    );
    const newVelocity = rangeMidi === 0 ? event.velocity : midiToVelocity(newVelocityMidi);
    const nextEvent = {
      ...event,
      velocity: newVelocity,
    };

    changes.push({
      id: event.id,
      role: event.role,
      time: event.time,
      originalVelocity: event.velocity,
      newVelocity: nextEvent.velocity,
      originalVelocityMidi,
      newVelocityMidi: rangeMidi === 0 ? originalVelocityMidi : newVelocityMidi,
      deltaMidi: rangeMidi === 0 ? 0 : newVelocityMidi - originalVelocityMidi,
    });

    return nextEvent;
  });

  const absoluteDeltas = changes.map((change) => Math.abs(change.deltaMidi));
  const averageAbsoluteDeltaMidi = average(absoluteDeltas);
  const maxAbsoluteDeltaMidi = Math.max(0, ...absoluteDeltas);

  return {
    events,
    changes,
    averageAbsoluteDeltaMidi,
    maxAbsoluteDeltaMidi,
    explanation: explainVelocityHumanizer(inputEvents.length, rangeMidi, averageAbsoluteDeltaMidi),
  };
}

export function velocityToMidi(velocity: number) {
  return Math.round(clamp(velocity, 0, 1) * 127);
}

export function midiToVelocity(midiVelocity: number) {
  return round(clamp(Math.round(midiVelocity), 0, 127) / 127, 4);
}

export function roleLabel(role: DrumRole) {
  switch (role) {
    case "closed_hat":
      return "Closed Hat";
    case "open_hat":
      return "Open Hat";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

function randomIntInRange(seed: string, range: number) {
  if (range === 0) {
    return 0;
  }

  return Math.floor(seededUnit(seed) * (range * 2 + 1)) - range;
}

function explainVelocityHumanizer(noteCount: number, rangeMidi: number, averageDelta: number) {
  if (rangeMidi === 0) {
    return `Loaded ${noteCount} notes. Velocity range is 0, so no notes are changed.`;
  }

  return `Loaded ${noteCount} notes. Each note velocity is randomized within +/-${rangeMidi} MIDI velocity units, with an average absolute change of ${round(
    averageDelta,
    1,
  )}. Timing and duration are unchanged.`;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
