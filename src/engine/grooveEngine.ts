import {
  TICKS_PER_BEAT,
  type DrumEvent,
  type DrumRole,
  type GrooveChange,
  type GrooveEngineOptions,
  type GroovePreset,
  type GrooveResult,
  type RoleSummary,
} from "../types/groove";
import { clamp, msToTicks, seededSigned, seededUnit, ticksToMs } from "./math";

export function applyGroove(
  inputEvents: DrumEvent[],
  preset: GroovePreset,
  options: GrooveEngineOptions,
): GrooveResult {
  const ticksPerBeat = options.ticksPerBeat ?? TICKS_PER_BEAT;
  const intensity = clamp(options.intensity, 0, 1);
  const seed = options.seed ?? preset.id;
  const events = [...inputEvents].sort((a, b) => a.time - b.time);

  const transformed: DrumEvent[] = [];
  const changes: GrooveChange[] = [];

  for (const event of events) {
    const transformedEvent = transformEvent(event, preset, {
      intensity,
      seed,
      tempoBpm: options.tempoBpm,
      ticksPerBeat,
    });
    transformed.push(transformedEvent);
    changes.push(makeChange(event, transformedEvent, options.tempoBpm, ticksPerBeat, false));

    const ghost = maybeCreateGhostNote(event, preset, {
      intensity,
      seed,
      tempoBpm: options.tempoBpm,
      ticksPerBeat,
    });
    if (ghost) {
      transformed.push(ghost);
      changes.push(makeChange(event, ghost, options.tempoBpm, ticksPerBeat, true));
    }
  }

  transformed.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));

  return {
    events: transformed,
    changes,
    explanation: explainChanges(changes, summarizeRoles(events), preset, intensity),
  };
}

type TransformContext = {
  intensity: number;
  seed: string;
  tempoBpm: number;
  ticksPerBeat: number;
};

function transformEvent(
  event: DrumEvent,
  preset: GroovePreset,
  context: TransformContext,
): DrumEvent {
  const params = preset.parameters;
  const idSeed = `${context.seed}:${event.id}`;
  const role = event.role;
  const isOffSixteenth =
    Math.round(event.time / (context.ticksPerBeat / 4)) % 2 === 1;

  let shiftMs = params.overallLoosenessMs * seededSigned(`${idSeed}:loose`);
  let velocityDelta = params.velocityJitter * seededSigned(`${idSeed}:velocity`);

  if (role === "snare" || role === "clap") {
    shiftMs += params.snareDelayMs;
    velocityDelta += 0.04;
  }

  if (role === "kick") {
    shiftMs +=
      params.kickLoosenessMs *
      (1 - params.kickTightness) *
      seededSigned(`${idSeed}:kick`);
    velocityDelta += 0.02 * seededUnit(`${idSeed}:kick-velocity`);
  }

  if (role === "closed_hat" || role === "open_hat") {
    if (isOffSixteenth) {
      shiftMs += params.hatSwingMs;
      velocityDelta -= params.hatVelocityAccent;
    } else {
      velocityDelta += params.hatVelocityAccent * 0.55;
    }
  }

  if (role === "perc" || role === "unknown") {
    shiftMs += params.percussionPushPullMs * seededSigned(`${idSeed}:perc`);
  }

  const shiftTicks = Math.round(
    msToTicks(shiftMs * context.intensity, context.tempoBpm, context.ticksPerBeat),
  );
  const nextVelocity = clamp(event.velocity + velocityDelta * context.intensity, 0.05, 1);

  return {
    ...event,
    time: Math.max(0, event.time + shiftTicks),
    velocity: round(nextVelocity, 3),
  };
}

function maybeCreateGhostNote(
  event: DrumEvent,
  preset: GroovePreset,
  context: TransformContext,
): DrumEvent | undefined {
  if (event.role !== "snare") {
    return undefined;
  }

  const chance = preset.parameters.ghostNoteProbability * context.intensity;
  if (seededUnit(`${context.seed}:${event.id}:ghost`) > chance) {
    return undefined;
  }

  const ghostOffsetTicks = Math.round(context.ticksPerBeat / 4);
  const ghostTime = event.time - ghostOffsetTicks;
  if (ghostTime < 0) {
    return undefined;
  }

  return {
    ...event,
    id: `${event.id}:ghost:${Math.round(ghostTime)}`,
    time: ghostTime,
    velocity: round(preset.parameters.ghostNoteVelocity * (0.65 + context.intensity * 0.35), 3),
    duration: Math.min(event.duration ?? ghostOffsetTicks, Math.round(context.ticksPerBeat / 8)),
    confidence: Math.max(event.confidence, 0.72),
    source: event.source,
  };
}

function makeChange(
  original: DrumEvent,
  transformed: DrumEvent,
  tempoBpm: number,
  ticksPerBeat: number,
  added: boolean,
): GrooveChange {
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
    added,
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
  changes: GrooveChange[],
  summary: RoleSummary,
  preset: GroovePreset,
  intensity: number,
) {
  const addedGhosts = changes.filter((change) => change.added && change.role === "snare").length;
  const snareDelays = changes.filter(
    (change) => !change.added && (change.role === "snare" || change.role === "clap"),
  );
  const hatChanges = changes.filter(
    (change) => change.role === "closed_hat" || change.role === "open_hat",
  );

  const avgSnareDelay = average(snareDelays.map((change) => change.shiftMs));
  const avgHatVelocity = average(hatChanges.map((change) => Math.abs(change.velocityDelta)));
  const roleText = [
    `${summary.kick} kicks`,
    `${summary.snare + summary.clap} backbeats`,
    `${summary.closed_hat + summary.open_hat} hats`,
  ].join(", ");

  const details = [
    `Applied ${preset.name} at ${Math.round(intensity * 100)}%.`,
    `Detected ${roleText}.`,
  ];

  if (snareDelays.length > 0) {
    details.push(`Backbeats sit about ${round(avgSnareDelay, 1)} ms later.`);
  }

  if (hatChanges.length > 0) {
    details.push(`Hat velocities move by ${round(avgHatVelocity, 2)} on average.`);
  }

  if (addedGhosts > 0) {
    details.push(`Added ${addedGhosts} low-velocity ghost snare${addedGhosts === 1 ? "" : "s"}.`);
  }

  return details.join(" ");
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
