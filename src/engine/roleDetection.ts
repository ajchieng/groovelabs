import {
  BEATS_PER_BAR,
  TICKS_PER_BEAT,
  type DrumEvent,
  type DrumRole,
  type RoleDetectionOptions,
} from "../types/groove";
import { clamp, nearestGridDistance } from "./math";

type RoleScore = Partial<Record<DrumRole, number>>;

const GM_ROLE_BY_PITCH: Record<number, DrumRole> = {
  35: "kick",
  36: "kick",
  37: "snare",
  38: "snare",
  39: "clap",
  40: "snare",
  42: "closed_hat",
  44: "closed_hat",
  46: "open_hat",
  49: "perc",
  51: "perc",
  54: "perc",
  56: "perc",
};

const KEYWORD_ROLES: Array<[RegExp, DrumRole, number]> = [
  [/\b(kick|bd|bass\s*drum|808)\b/, "kick", 0.8],
  [/\b(snare|sd|rim|sidestick|side\s*stick)\b/, "snare", 0.78],
  [/\b(clap)\b/, "clap", 0.82],
  [/\b(closed\s*hat|closed\s*hihat|ch|hat\s*closed)\b/, "closed_hat", 0.82],
  [/\b(open\s*hat|open\s*hihat|oh|hat\s*open)\b/, "open_hat", 0.82],
  [/\b(hat|hihat|hi-hat|hh)\b/, "closed_hat", 0.62],
  [/\b(perc|percussion|conga|bongo|shaker|clave|cowbell|tom)\b/, "perc", 0.62],
];

export function detectDrumRoles(
  events: DrumEvent[],
  options: RoleDetectionOptions = {},
): DrumEvent[] {
  const ticksPerBeat = options.ticksPerBeat ?? TICKS_PER_BEAT;
  const pitchCounts = countByPitch(events);

  return events.map((event) => {
    const scores: RoleScore = {};
    addPitchScore(scores, event.pitch);
    addNameScore(scores, [event.sampleName, event.padName, event.deviceName]);
    addRhythmScore(scores, event, pitchCounts, ticksPerBeat);

    const [role, score] = pickBestRole(scores);
    return {
      ...event,
      role,
      confidence: score,
    };
  });
}

function countByPitch(events: DrumEvent[]) {
  const counts = new Map<number, number>();
  for (const event of events) {
    if (typeof event.pitch === "number") {
      counts.set(event.pitch, (counts.get(event.pitch) ?? 0) + 1);
    }
  }
  return counts;
}

function addPitchScore(scores: RoleScore, pitch?: number) {
  if (pitch === undefined) {
    return;
  }

  const mapped = GM_ROLE_BY_PITCH[Math.round(pitch)];
  if (mapped) {
    bump(scores, mapped, 0.72);
  }
}

function addNameScore(scores: RoleScore, values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  if (!text) {
    return;
  }

  for (const [pattern, role, score] of KEYWORD_ROLES) {
    if (pattern.test(text)) {
      bump(scores, role, score);
    }
  }
}

function addRhythmScore(
  scores: RoleScore,
  event: DrumEvent,
  pitchCounts: Map<number, number>,
  ticksPerBeat: number,
) {
  const beatIndex = Math.round(event.time / ticksPerBeat) % BEATS_PER_BAR;
  const sixteenth = ticksPerBeat / 4;
  const onBeatDistance = Math.abs(nearestGridDistance(event.time, ticksPerBeat));
  const onSixteenthDistance = Math.abs(nearestGridDistance(event.time, sixteenth));
  const repeatedPitchCount =
    typeof event.pitch === "number" ? pitchCounts.get(event.pitch) ?? 0 : 0;

  if ((beatIndex === 1 || beatIndex === 3) && onBeatDistance < ticksPerBeat * 0.08) {
    bump(scores, "snare", 0.28);
  }

  if ((beatIndex === 0 || beatIndex === 2) && onBeatDistance < ticksPerBeat * 0.08) {
    bump(scores, "kick", 0.18);
  }

  if (repeatedPitchCount >= 6 && onSixteenthDistance < sixteenth * 0.18) {
    bump(scores, "closed_hat", 0.24);
  }

  if (event.velocity < 0.45 && repeatedPitchCount <= 3) {
    bump(scores, "perc", 0.1);
  }
}

function bump(scores: RoleScore, role: DrumRole, amount: number) {
  scores[role] = (scores[role] ?? 0) + amount;
}

function pickBestRole(scores: RoleScore): [DrumRole, number] {
  let bestRole: DrumRole = "unknown";
  let bestScore = 0;

  for (const [role, score] of Object.entries(scores) as Array<[DrumRole, number]>) {
    if (score > bestScore) {
      bestRole = role;
      bestScore = score;
    }
  }

  return bestScore <= 0 ? ["unknown", 0] : [bestRole, clamp(bestScore, 0, 1)];
}
