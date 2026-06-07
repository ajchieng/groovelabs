import {
  BEATS_PER_BAR,
  TICKS_PER_BEAT,
  type DrumEvent,
  type DrumRole,
  type HatSubdivision,
  type HumanizerChange,
  type HumanizerEngineOptions,
  type HumanizerFramework,
  type HumanizerResult,
  type RoleSummary,
} from "../types/groove";
import { midiToVelocity, velocityToMidi } from "./drumFormat";
import { clamp, msToTicks, nearestGridDistance, seededSigned, ticksToMs } from "./math";
import { detectDrumRoles } from "./roleDetection";

type TransformContext = {
  framework: HumanizerFramework;
  strength: number;
  seed: string;
  tempoBpm: number;
  ticksPerBeat: number;
  hatSubdivision: HatSubdivision;
  averageHatMidi: number;
  snareBackbeatsById: Map<string, SnareBackbeat>;
  snareTimes: number[];
  kickVelocityDeltasById: Map<string, number>;
};

type SnareBackbeat = {
  bar: number;
  beatNumber: 2 | 4;
  hasPairedBackbeat: boolean;
};

const HAT_ROLES = new Set<DrumRole>(["closed_hat", "open_hat"]);
const SNARE_ROLES = new Set<DrumRole>(["snare", "clap"]);
const TIMING_REFERENCE_BPM = 90;

export function applyHumanizerFramework(
  inputEvents: DrumEvent[],
  framework: HumanizerFramework,
  options: HumanizerEngineOptions,
): HumanizerResult {
  const ticksPerBeat = options.ticksPerBeat ?? TICKS_PER_BEAT;
  const strength = clamp(options.strength, 0, 4);
  const seed = options.seed ?? framework.id;
  const detectedEvents = detectDrumRoles(inputEvents, { ticksPerBeat });
  const events = [...detectedEvents].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const hats = events.filter((event) => HAT_ROLES.has(event.role));
  const snareEvents = events.filter((event) => SNARE_ROLES.has(event.role));
  const kickEvents = events.filter((event) => event.role === "kick");
  const roleSummary = summarizeRoles(events);
  const hatSubdivision = inferHatSubdivision(hats, ticksPerBeat);

  const context: TransformContext = {
    framework,
    strength,
    seed,
    tempoBpm: options.tempoBpm,
    ticksPerBeat,
    hatSubdivision,
    averageHatMidi: averageMidi(hats),
    snareBackbeatsById: mapSnareBackbeats(snareEvents, ticksPerBeat),
    snareTimes: snareEvents.map((event) => event.time),
    kickVelocityDeltasById: mapKickVelocityDeltas(kickEvents, ticksPerBeat, framework),
  };

  const transformed = events.map((event) => transformEvent(event, context));
  const changes = transformed.map((event, index) =>
    makeChange(events[index], event, options.tempoBpm, ticksPerBeat),
  );

  transformed.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  return {
    events: transformed,
    changes,
    explanation: explainChanges(changes, roleSummary, hatSubdivision, framework, strength),
    roleSummary,
    hatSubdivision,
  };
}

function transformEvent(event: DrumEvent, context: TransformContext): DrumEvent {
  if (HAT_ROLES.has(event.role)) {
    return transformHat(event, context);
  }

  if (SNARE_ROLES.has(event.role)) {
    return transformSnare(event, context);
  }

  if (event.role === "kick") {
    return transformKick(event, context);
  }

  return event;
}

function transformHat(event: DrumEvent, context: TransformContext): DrumEvent {
  const params = context.framework.parameters;
  const eventSeed = `${context.seed}:${event.id}`;
  const shiftMs =
    hatBaseDragMs(context) +
    hatSwingOffsetMs(event, context) +
    params.hatTimingJitterMs * seededSigned(`${eventSeed}:hat-time`);
  const subdivisionDelta = hatVelocityDelta(event, context);
  const snareLift = hasNearbySnare(event, context)
    ? params.hatSnareLiftMidi
    : 0;
  const targetMidi = context.averageHatMidi + subdivisionDelta + snareLift;
  const nextVelocity = shapeVelocity(event, targetMidi, params.hatVelocityJitterMidi, context);

  return {
    ...event,
    time: shiftTime(event.time, shiftMs, context),
    velocity: nextVelocity,
  };
}

function hatBaseDragMs(context: TransformContext) {
  const params = context.framework.parameters;
  return context.hatSubdivision === "sixteenth" ? params.hatSixteenthDragMs : params.hatDragMs;
}

function transformSnare(event: DrumEvent, context: TransformContext): DrumEvent {
  const params = context.framework.parameters;
  const eventSeed = `${context.seed}:${event.id}`;
  const backbeat = context.snareBackbeatsById.get(event.id);
  const backbeatStrength = backbeat ? 1 : 0.45;
  const shiftMs =
    -backbeatStrength *
    (params.snarePushMs + params.snareTimingJitterMs * seededSigned(`${eventSeed}:snare-time`));
  const beatFourLift =
    backbeat?.beatNumber === 4 && backbeat.hasPairedBackbeat
      ? params.snareBeatFourLiftMidi
      : 0;
  const beatTwoDip =
    backbeat?.beatNumber === 2 && backbeat.hasPairedBackbeat
      ? -Math.round(params.snareBeatFourLiftMidi * 0.25)
      : 0;
  const targetMidi = velocityToMidi(event.velocity) + beatFourLift + beatTwoDip;
  const nextVelocity = shapeVelocity(event, targetMidi, params.snareVelocityJitterMidi, context);

  return {
    ...event,
    time: shiftTime(event.time, shiftMs, context),
    velocity: nextVelocity,
  };
}

function transformKick(event: DrumEvent, context: TransformContext): DrumEvent {
  const params = context.framework.parameters;
  const eventSeed = `${context.seed}:${event.id}`;
  const shiftMs = params.kickTimingJitterMs * seededSigned(`${eventSeed}:kick-time`);
  const targetMidi =
    velocityToMidi(event.velocity) + (context.kickVelocityDeltasById.get(event.id) ?? 0);

  return {
    ...event,
    time: shiftTime(event.time, shiftMs, context),
    velocity: shapeVelocity(event, targetMidi, params.kickVelocityJitterMidi, context),
  };
}

function hatVelocityDelta(event: DrumEvent, context: TransformContext) {
  const params = context.framework.parameters;
  const sixteenthIndex = Math.round(event.time / (context.ticksPerBeat / 4));
  const sixteenthInBeat = positiveModulo(sixteenthIndex, 4);

  if (context.hatSubdivision === "eighth") {
    return sixteenthInBeat === 2
      ? params.hatEighthOffbeatDipMidi
      : params.hatEighthDownbeatLiftMidi;
  }

  if (context.hatSubdivision === "sixteenth") {
    return params.hatSixteenthAccentsMidi[sixteenthInBeat];
  }

  if (context.hatSubdivision === "quarter") {
    return params.hatEighthDownbeatLiftMidi * 0.5;
  }

  return params.hatSixteenthAccentsMidi[sixteenthInBeat] * 0.65;
}

function hatSwingOffsetMs(event: DrumEvent, context: TransformContext) {
  const params = context.framework.parameters;
  const sixteenthIndex = Math.round(event.time / (context.ticksPerBeat / 4));
  const sixteenthInBeat = positiveModulo(sixteenthIndex, 4);
  const isOffSixteenth = sixteenthInBeat === 1 || sixteenthInBeat === 3;

  if (context.hatSubdivision === "eighth") {
    return sixteenthInBeat === 2 ? params.hatOffbeatDragMs : 0;
  }

  if (context.hatSubdivision === "sixteenth") {
    return isOffSixteenth ? params.hatSixteenthOffbeatDragMs : 0;
  }

  if (context.hatSubdivision === "mixed") {
    return isOffSixteenth ? params.hatSixteenthOffbeatDragMs * 0.75 : 0;
  }

  return 0;
}

function shapeVelocity(
  event: DrumEvent,
  targetMidi: number,
  jitterMidi: number,
  context: TransformContext,
) {
  if (context.strength === 0) {
    return event.velocity;
  }

  const originalMidi = velocityToMidi(event.velocity);
  const eventSeed = `${context.seed}:${event.id}`;
  const jitter = jitterMidi * seededSigned(`${eventSeed}:velocity`) * context.strength;
  const shapedMidi = originalMidi + (targetMidi - originalMidi) * context.strength + jitter;
  return midiToVelocity(clamp(Math.round(shapedMidi), 1, 127));
}

function shiftTime(time: number, shiftMs: number, context: TransformContext) {
  const shiftTicks = Math.round(
    msToTicks(shiftMs * context.strength, TIMING_REFERENCE_BPM, context.ticksPerBeat),
  );
  return Math.max(0, time + shiftTicks);
}

function inferHatSubdivision(hats: DrumEvent[], ticksPerBeat: number): HatSubdivision {
  if (hats.length === 0) {
    return "none";
  }

  if (hats.length === 1) {
    return "quarter";
  }

  const sixteenth = ticksPerBeat / 4;
  const slots = hats
    .map((event) => Math.round(event.time / sixteenth))
    .sort((a, b) => a - b);
  const diffs = slots
    .slice(1)
    .map((slot, index) => slot - slots[index])
    .filter((diff) => diff > 0 && diff <= 8)
    .sort((a, b) => a - b);

  if (diffs.length === 0) {
    return "mixed";
  }

  const medianStep = diffs[Math.floor(diffs.length / 2)];
  if (medianStep <= 1) {
    return "sixteenth";
  }
  if (medianStep <= 2) {
    return "eighth";
  }
  if (medianStep <= 4) {
    return "quarter";
  }
  return "mixed";
}

function hasNearbySnare(event: DrumEvent, context: TransformContext) {
  const tolerance = context.ticksPerBeat * 0.08;
  return context.snareTimes.some((time) => Math.abs(time - event.time) <= tolerance);
}

function mapSnareBackbeats(snareEvents: DrumEvent[], ticksPerBeat: number) {
  const backbeats = snareEvents
    .map((event) => {
      const beatNumber = backbeatNumber(event.time, ticksPerBeat);
      if (!beatNumber) {
        return undefined;
      }
      return {
        event,
        beatNumber,
        bar: Math.floor(event.time / (ticksPerBeat * BEATS_PER_BAR)),
      };
    })
    .filter(Boolean) as Array<{ event: DrumEvent; beatNumber: 2 | 4; bar: number }>;

  const byBar = new Map<number, Set<2 | 4>>();
  for (const backbeat of backbeats) {
    const beats = byBar.get(backbeat.bar) ?? new Set<2 | 4>();
    beats.add(backbeat.beatNumber);
    byBar.set(backbeat.bar, beats);
  }

  const byId = new Map<string, SnareBackbeat>();
  for (const backbeat of backbeats) {
    const beats = byBar.get(backbeat.bar);
    byId.set(backbeat.event.id, {
      bar: backbeat.bar,
      beatNumber: backbeat.beatNumber,
      hasPairedBackbeat: Boolean(beats?.has(2) && beats.has(4)),
    });
  }
  return byId;
}

function backbeatNumber(time: number, ticksPerBeat: number): 2 | 4 | undefined {
  if (Math.abs(nearestGridDistance(time, ticksPerBeat)) > ticksPerBeat * 0.12) {
    return undefined;
  }

  const beatIndex = positiveModulo(Math.round(time / ticksPerBeat), BEATS_PER_BAR);
  if (beatIndex === 1) {
    return 2;
  }
  if (beatIndex === 3) {
    return 4;
  }
  return undefined;
}

function mapKickVelocityDeltas(
  kicks: DrumEvent[],
  ticksPerBeat: number,
  framework: HumanizerFramework,
) {
  const byId = new Map<string, number>();
  const sortedKicks = [...kicks].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const params = framework.parameters;

  for (let index = 0; index < sortedKicks.length - 1; index += 1) {
    const current = sortedKicks[index];
    const next = sortedKicks[index + 1];
    const distance = next.time - current.time;

    if (distance <= 0 || distance > ticksPerBeat) {
      continue;
    }

    const currentOnDownbeat = isOnQuarterGrid(current.time, ticksPerBeat);
    const nextOnDownbeat = isOnQuarterGrid(next.time, ticksPerBeat);

    if (currentOnDownbeat && !nextOnDownbeat) {
      bump(byId, current.id, params.kickDoubleDownbeatLiftMidi);
      bump(byId, next.id, -params.kickDoubleFollowDipMidi);
    } else if (!currentOnDownbeat && nextOnDownbeat) {
      bump(byId, next.id, params.kickDoubleDownbeatLiftMidi);
      bump(byId, current.id, -params.kickDoubleFollowDipMidi);
    } else {
      bump(byId, current.id, params.kickDoubleOffbeatFirstLiftMidi);
      bump(byId, next.id, -params.kickDoubleFollowDipMidi);
    }
  }

  return byId;
}

function isOnQuarterGrid(time: number, ticksPerBeat: number) {
  return Math.abs(nearestGridDistance(time, ticksPerBeat)) <= ticksPerBeat * 0.12;
}

function makeChange(
  original: DrumEvent,
  transformed: DrumEvent,
  tempoBpm: number,
  ticksPerBeat: number,
): HumanizerChange {
  const shiftTicks = transformed.time - original.time;
  return {
    id: transformed.id,
    originalId: original.id,
    role: transformed.role,
    originalTime: original.time,
    newTime: transformed.time,
    shiftTicks,
    shiftMs: round(ticksToMs(shiftTicks, tempoBpm, ticksPerBeat), 1),
    originalVelocity: original.velocity,
    newVelocity: transformed.velocity,
    velocityDelta: round(transformed.velocity - original.velocity, 3),
    added: false,
  };
}

function summarizeRoles(events: DrumEvent[]): RoleSummary {
  return events.reduce(
    (summary, event) => {
      summary[event.role] += 1;
      return summary;
    },
    {
      kick: 0,
      snare: 0,
      closed_hat: 0,
      open_hat: 0,
      clap: 0,
      perc: 0,
      unknown: 0,
    } satisfies RoleSummary,
  );
}

function explainChanges(
  changes: HumanizerChange[],
  summary: RoleSummary,
  hatSubdivision: HatSubdivision,
  framework: HumanizerFramework,
  strength: number,
) {
  const hats = changes.filter((change) => HAT_ROLES.has(change.role));
  const snares = changes.filter((change) => SNARE_ROLES.has(change.role));
  const kicks = changes.filter((change) => change.role === "kick");
  const avgHatDrag = average(hats.map((change) => change.shiftMs));
  const avgSnarePush = average(snares.map((change) => change.shiftMs));
  const maxVelocityMove = Math.max(
    0,
    ...changes.map((change) =>
      Math.abs(velocityToMidi(change.newVelocity) - velocityToMidi(change.originalVelocity)),
    ),
  );
  const roleText = [
    `${summary.kick} kicks`,
    `${summary.snare + summary.clap} snares`,
    `${summary.closed_hat + summary.open_hat} hats`,
  ].join(", ");

  return [
    `${framework.name} at ${Math.round(strength * 100)}%.`,
    `Detected ${roleText}.`,
    hats.length > 0 ? `Hats read as ${hatSubdivision} notes and drag about ${round(avgHatDrag, 1)} ms.` : "",
    snares.length > 0 ? `Snares push about ${round(Math.abs(avgSnarePush), 1)} ms forward.` : "",
    kicks.length > 0 ? `Kick velocities and positions get small close-hit accents and jitter.` : "",
    `Largest velocity move is ${maxVelocityMove} MIDI units.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function averageMidi(events: DrumEvent[]) {
  if (events.length === 0) {
    return 82;
  }
  return Math.round(average(events.map((event) => velocityToMidi(event.velocity))));
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bump(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
