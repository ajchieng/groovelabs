import {
  BEATS_PER_BAR,
  TICKS_PER_BEAT,
  type DrumEvent,
  type DrumRole,
  type RoleDetectionOptions,
} from "../types/groove";
import { clamp, nearestGridDistance } from "./math";

type RoleScore = Partial<Record<DrumRole, number>>;
type KeywordRolePattern = [RegExp, DrumRole, number];
type TokenRolePattern = [readonly string[], DrumRole, number];

type PitchProfile = {
  count: number;
  backbeatHits: number;
  backbeatRatio: number;
  strongKickHits: number;
  strongKickRatio: number;
  sixteenthGridRatio: number;
  medianSixteenthStep: number;
};

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

const TOKEN_KEYWORD_ROLES: TokenRolePattern[] = [
  [["bd", "kik"], "kick", 0.92],
  [["sd", "snr"], "snare", 0.9],
  [["ch", "chh"], "closed_hat", 0.9],
  [["oh", "ohh"], "open_hat", 0.9],
  [["hh"], "closed_hat", 0.74],
];

const WORD_KEYWORD_ROLES: KeywordRolePattern[] = [
  [/\b(bass\s*drum|bassdrum|kick|kik)\b/, "kick", 0.9],
  [/\b(808|909)\s*(kick|bd)\b|\b(kick|bd)\s*(808|909)\b/, "kick", 0.9],
  [/\b(snare\s*drum|snaredrum|snare|snr|rimshot|rim|sidestick|side\s*stick)\b/, "snare", 0.88],
  [/\b(hand\s*clap|handclap|clap)\b/, "clap", 0.84],
  [
    /\b(closed|close|clsd|cl)\s*(hi\s*)?hat\b|\b(hi\s*)?hat\s*(closed|close|clsd|cl)\b/,
    "closed_hat",
    0.92,
  ],
  [
    /\b(open|op)\s*(hi\s*)?hat\b|\b(hi\s*)?hat\s*(open|op)\b/,
    "open_hat",
    0.92,
  ],
  [/\b(hi\s*hat|hihat|hat)\b/, "closed_hat", 0.7],
  [/\b(perc|percussion|conga|bongo|shaker|clave|cowbell|tom|cymbal|crash|ride)\b/, "perc", 0.62],
];

const COMPACT_KEYWORD_ROLES: KeywordRolePattern[] = [
  [/(bassdrum|kick|kik)/, "kick", 0.9],
  [/(snaredrum|snare|snr|rimshot|sidestick)/, "snare", 0.88],
  [/(closedhihat|closedhat|closehihat|closehat|clsdhat|clhat|chh)/, "closed_hat", 0.92],
  [/(openhihat|openhat|ophat|ohh)/, "open_hat", 0.92],
  [/(handclap|clap)/, "clap", 0.84],
  [/(hihat|hh)/, "closed_hat", 0.7],
  [/(percussion|perc|conga|bongo|shaker|clave|cowbell|tom|cymbal|crash|ride)/, "perc", 0.62],
];

export function detectDrumRoles(
  events: DrumEvent[],
  options: RoleDetectionOptions = {},
): DrumEvent[] {
  const ticksPerBeat = options.ticksPerBeat ?? TICKS_PER_BEAT;
  const pitchCounts = countByPitch(events);
  const pitchProfiles = profilePitches(events, ticksPerBeat);
  const pitchRoleScores = inferPitchRoleScores(pitchProfiles);

  return events.map((event) => {
    const scores: RoleScore = {};
    addPitchScore(scores, event.pitch);
    addNameScore(scores, [event.sampleName, event.padName, event.stripName], 1);
    addNameScore(scores, [event.regionName, event.trackName], 0.72);
    addNameScore(scores, [event.deviceName, event.deviceType], 0.38);
    addPitchRoleScore(scores, event.pitch, pitchRoleScores);
    addRhythmScore(scores, event, pitchCounts, pitchProfiles, ticksPerBeat);

    const [role, score] = pickBestRole(scores);

    // Rhythm and pitch can't tell an open hat from a closed one, so when the lane name
    // says which it is, that wins. Without this, a named "open hat" playing straight
    // 16ths is outscored by the closed-hat rhythm/pitch inference.
    const explicitHat = explicitHatRole([event.sampleName, event.padName, event.stripName]);
    if (explicitHat) {
      return {
        ...event,
        role: explicitHat,
        confidence: Math.max(score, 0.92),
      };
    }

    return {
      ...event,
      role,
      confidence: score,
    };
  });
}

// An unambiguous open/closed hat signal from the per-lane name fields. Returns undefined
// for a bare "hat" (which doesn't say which kind) or when both signals are present.
function explicitHatRole(values: Array<string | undefined>): DrumRole | undefined {
  const { compact, text, tokens } = normalizeNameValues(values);
  if (!text) {
    return undefined;
  }

  const isOpen =
    /\b(open|op)\s*(hi\s*)?hat\b|\b(hi\s*)?hat\s*(open|op)\b/.test(text) ||
    /(openhihat|openhat|ophat|ohh)/.test(compact) ||
    tokens.has("oh") ||
    tokens.has("ohh");
  const isClosed =
    /\b(closed|close|clsd|cl)\s*(hi\s*)?hat\b|\b(hi\s*)?hat\s*(closed|close|clsd|cl)\b/.test(text) ||
    /(closedhihat|closedhat|closehihat|closehat|clsdhat|clhat|chh)/.test(compact) ||
    tokens.has("ch") ||
    tokens.has("chh");

  if (isOpen && !isClosed) {
    return "open_hat";
  }
  if (isClosed && !isOpen) {
    return "closed_hat";
  }
  return undefined;
}

function countByPitch(events: DrumEvent[]) {
  const counts = new Map<number, number>();
  for (const event of events) {
    if (typeof event.pitch === "number") {
      const pitch = Math.round(event.pitch);
      counts.set(pitch, (counts.get(pitch) ?? 0) + 1);
    }
  }
  return counts;
}

function profilePitches(events: DrumEvent[], ticksPerBeat: number) {
  const byPitch = new Map<number, DrumEvent[]>();
  for (const event of events) {
    if (typeof event.pitch !== "number") {
      continue;
    }
    const pitch = Math.round(event.pitch);
    byPitch.set(pitch, [...(byPitch.get(pitch) ?? []), event]);
  }

  const profiles = new Map<number, PitchProfile>();
  const sixteenth = ticksPerBeat / 4;

  for (const [pitch, pitchEvents] of byPitch) {
    const sortedEvents = [...pitchEvents].sort((a, b) => a.time - b.time);
    const backbeatHits = sortedEvents.filter((event) => isBackbeat(event.time, ticksPerBeat)).length;
    const strongKickHits = sortedEvents.filter((event) =>
      isStrongKickBeat(event.time, ticksPerBeat),
    ).length;
    const sixteenthSteps = sortedEvents
      .slice(1)
      .map((event, index) =>
        Math.round((event.time - sortedEvents[index].time) / sixteenth),
      )
      .filter((step) => step > 0 && step <= 8)
      .sort((a, b) => a - b);

    profiles.set(pitch, {
      count: sortedEvents.length,
      backbeatHits,
      backbeatRatio: backbeatHits / sortedEvents.length,
      strongKickHits,
      strongKickRatio: strongKickHits / sortedEvents.length,
      sixteenthGridRatio: ratio(
        sortedEvents,
        (event) => Math.abs(nearestGridDistance(event.time, sixteenth)) < sixteenth * 0.2,
      ),
      medianSixteenthStep:
        sixteenthSteps.length > 0 ? sixteenthSteps[Math.floor(sixteenthSteps.length / 2)] : 99,
    });
  }

  return profiles;
}

function inferPitchRoleScores(pitchProfiles: Map<number, PitchProfile>) {
  const profiles = [...pitchProfiles.entries()]
    .map(([pitch, profile]) => ({ pitch, profile }))
    .sort((a, b) => a.pitch - b.pitch);
  const roleScores = new Map<number, RoleScore>();
  const maxCount = Math.max(0, ...profiles.map(({ profile }) => profile.count));

  if (profiles.length === 0 || maxCount === 0) {
    return roleScores;
  }

  const hatPitch = pickHatPitch(profiles, maxCount);
  const snarePitch = pickSnarePitch(profiles, hatPitch);
  const kickPitch = pickKickPitch(profiles, new Set([hatPitch, snarePitch]));

  if (hatPitch !== undefined) {
    addInferredPitchRole(roleScores, hatPitch, "closed_hat", 1.5);
  }
  if (snarePitch !== undefined) {
    addInferredPitchRole(roleScores, snarePitch, "snare", 1.5);
  }
  if (kickPitch !== undefined) {
    addInferredPitchRole(roleScores, kickPitch, "kick", 1.42);
  }

  for (const { pitch, profile } of profiles) {
    const pitchHeight = pitchHeightRatio(profiles, pitch);
    if (
      pitch !== hatPitch &&
      profile.count >= 4 &&
      profile.sixteenthGridRatio >= 0.6 &&
      profile.medianSixteenthStep <= 4 &&
      pitchHeight >= 0.35
    ) {
      addInferredPitchRole(roleScores, pitch, "closed_hat", 0.95);
    }

    if (
      pitch !== snarePitch &&
      profile.backbeatRatio >= 0.45 &&
      profile.count <= Math.max(12, maxCount * 0.75)
    ) {
      addInferredPitchRole(roleScores, pitch, "snare", 0.95);
    }

    if (
      pitch !== kickPitch &&
      profile.strongKickRatio >= 0.35 &&
      profile.count <= Math.max(12, maxCount * 0.8) &&
      pitchHeight <= 0.6
    ) {
      addInferredPitchRole(roleScores, pitch, "kick", 0.88);
    }
  }

  return roleScores;
}

function pickHatPitch(
  profiles: Array<{ pitch: number; profile: PitchProfile }>,
  maxCount: number,
) {
  const candidates = profiles
    .map(({ pitch, profile }) => {
      const height = pitchHeightRatio(profiles, pitch);
      const isRegular =
        profile.count >= 4 &&
        profile.sixteenthGridRatio >= 0.5 &&
        profile.medianSixteenthStep <= 4;
      if (!isRegular) {
        return undefined;
      }

      const densityRatio = profile.count / maxCount;
      const lowPitchPenalty = profiles.length > 1 && height < 0.35 ? 28 : 0;
      const score =
        densityRatio * 70 +
        profile.sixteenthGridRatio * 18 +
        height * 14 +
        (profile.medianSixteenthStep <= 2 ? 10 : 0) -
        lowPitchPenalty;
      return { pitch, score };
    })
    .filter(Boolean) as Array<{ pitch: number; score: number }>;

  return candidates.sort((a, b) => b.score - a.score)[0]?.pitch;
}

function pickSnarePitch(
  profiles: Array<{ pitch: number; profile: PitchProfile }>,
  excludedPitch?: number,
) {
  const candidates = profiles
    .filter(({ pitch }) => pitch !== excludedPitch)
    .map(({ pitch, profile }) => {
      if (profile.backbeatHits === 0 || profile.backbeatRatio < 0.35) {
        return undefined;
      }

      const height = pitchHeightRatio(profiles, pitch);
      const score = profile.backbeatRatio * 80 + profile.backbeatHits * 8 + (1 - Math.abs(0.55 - height)) * 12;
      return { pitch, score };
    })
    .filter(Boolean) as Array<{ pitch: number; score: number }>;

  return candidates.sort((a, b) => b.score - a.score)[0]?.pitch;
}

function pickKickPitch(
  profiles: Array<{ pitch: number; profile: PitchProfile }>,
  excludedPitches: Set<number | undefined>,
) {
  const candidates = profiles
    .filter(({ pitch }) => !excludedPitches.has(pitch))
    .map(({ pitch, profile }) => {
      if (profile.strongKickHits === 0 || profile.strongKickRatio < 0.25) {
        return undefined;
      }

      const height = pitchHeightRatio(profiles, pitch);
      const score = profile.strongKickRatio * 74 + profile.strongKickHits * 7 + (1 - height) * 18;
      return { pitch, score };
    })
    .filter(Boolean) as Array<{ pitch: number; score: number }>;

  return candidates.sort((a, b) => b.score - a.score)[0]?.pitch;
}

function addInferredPitchRole(
  roleScores: Map<number, RoleScore>,
  pitch: number,
  role: DrumRole,
  score: number,
) {
  const scores = roleScores.get(pitch) ?? {};
  bump(scores, role, score);
  roleScores.set(pitch, scores);
}

function pitchHeightRatio(
  profiles: Array<{ pitch: number; profile: PitchProfile }>,
  pitch: number,
) {
  if (profiles.length <= 1) {
    return 0.5;
  }
  const index = profiles.findIndex((candidate) => candidate.pitch === pitch);
  return index <= 0 ? 0 : index / (profiles.length - 1);
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

function addPitchRoleScore(
  scores: RoleScore,
  pitch: number | undefined,
  pitchRoleScores: Map<number, RoleScore>,
) {
  if (pitch === undefined) {
    return;
  }

  const roundedPitch = Math.round(pitch);
  if (GM_ROLE_BY_PITCH[roundedPitch]) {
    return;
  }

  const inferredScores = pitchRoleScores.get(roundedPitch);
  if (!inferredScores) {
    return;
  }

  for (const [role, score] of Object.entries(inferredScores) as Array<[DrumRole, number]>) {
    bump(scores, role, score);
  }
}

function addNameScore(scores: RoleScore, values: Array<string | undefined>, weight: number) {
  const { compact, text, tokens } = normalizeNameValues(values);
  if (!text) {
    return;
  }

  for (const [tokenValues, role, score] of TOKEN_KEYWORD_ROLES) {
    if (tokenValues.some((token) => tokens.has(token))) {
      bump(scores, role, score * weight);
    }
  }

  for (const [pattern, role, score] of WORD_KEYWORD_ROLES) {
    if (pattern.test(text)) {
      bump(scores, role, score * weight);
    }
  }

  for (const [pattern, role, score] of COMPACT_KEYWORD_ROLES) {
    if (pattern.test(compact)) {
      bump(scores, role, score * weight);
    }
  }
}

function normalizeNameValues(values: Array<string | undefined>) {
  const rawText = values.filter(Boolean).join(" ");
  const text = rawText
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_./\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokenList = text.length > 0 ? text.split(" ") : [];

  return {
    compact: tokenList.join(""),
    text,
    tokens: new Set(tokenList),
  };
}

function addRhythmScore(
  scores: RoleScore,
  event: DrumEvent,
  pitchCounts: Map<number, number>,
  pitchProfiles: Map<number, PitchProfile>,
  ticksPerBeat: number,
) {
  const beatIndex = Math.round(event.time / ticksPerBeat) % BEATS_PER_BAR;
  const sixteenth = ticksPerBeat / 4;
  const onBeatDistance = Math.abs(nearestGridDistance(event.time, ticksPerBeat));
  const onSixteenthDistance = Math.abs(nearestGridDistance(event.time, sixteenth));
  const pitchKey = typeof event.pitch === "number" ? Math.round(event.pitch) : undefined;
  const repeatedPitchCount = pitchKey === undefined ? 0 : pitchCounts.get(pitchKey) ?? 0;
  const pitchProfile = pitchKey === undefined ? undefined : pitchProfiles.get(pitchKey);

  if ((beatIndex === 1 || beatIndex === 3) && onBeatDistance < ticksPerBeat * 0.08) {
    bump(scores, "snare", 0.28);
  }

  if ((beatIndex === 0 || beatIndex === 2) && onBeatDistance < ticksPerBeat * 0.08) {
    bump(scores, "kick", 0.18);
  }

  if (repeatedPitchCount >= 6 && onSixteenthDistance < sixteenth * 0.18) {
    bump(scores, "closed_hat", 0.24);
  }

  if (
    pitchProfile &&
    pitchProfile.count >= 4 &&
    pitchProfile.sixteenthGridRatio >= 0.65 &&
    pitchProfile.medianSixteenthStep <= 2
  ) {
    bump(scores, "closed_hat", 0.3);
  }

  if (
    pitchProfile &&
    pitchProfile.count <= 6 &&
    pitchProfile.backbeatRatio >= 0.5
  ) {
    bump(scores, "snare", isBackbeat(event.time, ticksPerBeat) ? 0.34 : 0.22);
  }

  if (
    pitchProfile &&
    pitchProfile.count <= 8 &&
    pitchProfile.strongKickRatio >= 0.35
  ) {
    bump(scores, "kick", isStrongKickBeat(event.time, ticksPerBeat) ? 0.28 : 0.2);
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

function isBackbeat(time: number, ticksPerBeat: number) {
  const beatIndex = Math.round(time / ticksPerBeat) % BEATS_PER_BAR;
  return (
    (beatIndex === 1 || beatIndex === 3) &&
    Math.abs(nearestGridDistance(time, ticksPerBeat)) < ticksPerBeat * 0.08
  );
}

function isStrongKickBeat(time: number, ticksPerBeat: number) {
  const beatIndex = Math.round(time / ticksPerBeat) % BEATS_PER_BAR;
  return (
    (beatIndex === 0 || beatIndex === 2) &&
    Math.abs(nearestGridDistance(time, ticksPerBeat)) < ticksPerBeat * 0.08
  );
}

function ratio(events: DrumEvent[], predicate: (event: DrumEvent) => boolean) {
  if (events.length === 0) {
    return 0;
  }
  return events.filter(predicate).length / events.length;
}
