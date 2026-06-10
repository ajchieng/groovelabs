import { describe, expect, it } from "vitest";
import { defaultFramework } from "../data/humanizerFrameworks";
import {
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  type DrumEvent,
  type HumanizerFramework,
} from "../types/groove";
import { velocityToMidi } from "./drumFormat";
import { applyHumanizerFramework } from "./humanizerEngine";
import { createDemoPattern } from "./samplePattern";

const testFramework: HumanizerFramework = {
  ...defaultFramework,
  parameters: {
    ...defaultFramework.parameters,
    hatTimingJitterMs: 0,
    hatVelocityJitterMidi: 0,
    snareTimingJitterMs: 0,
    snareVelocityJitterMidi: 0,
    kickTimingJitterMs: 0,
    kickVelocityJitterMidi: 0,
  },
};

describe("applyHumanizerFramework", () => {
  it("keeps the original pattern immutable", () => {
    const original = createDemoPattern();
    const snapshot = structuredClone(original);

    applyHumanizerFramework(original, defaultFramework, {
      strength: 0.7,
      tempoBpm: 92,
      seed: "test",
    });

    expect(original).toEqual(snapshot);
  });

  it("drags hats later and pulls backbeat snares earlier", () => {
    const original = createDemoPattern();
    const result = applyHumanizerFramework(original, testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    const hatChange = result.changes.find((change) => change.role === "closed_hat");
    const snareChange = result.changes.find(
      (change) => change.role === "snare" && change.originalTime === TICKS_PER_BEAT,
    );

    expect(hatChange?.shiftMs).toBeGreaterThan(0);
    expect(snareChange?.shiftMs).toBeLessThan(-4);
  });

  it("uses eighth-note step accents inside the bar and lifts hats that land with snares", () => {
    const result = applyHumanizerFramework(createEighthHatPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    expect(result.hatSubdivision).toBe("eighth");

    const beatOneHat = midiForOriginalTime(result.events, 0, "closed_hat");
    const offbeatHat = midiForOriginalTime(result.events, TICKS_PER_BEAT / 2, "closed_hat");
    const snareHat = midiForOriginalTime(result.events, TICKS_PER_BEAT, "closed_hat");

    expect(offbeatHat).toBeLessThan(beatOneHat);
    expect(snareHat).toBeGreaterThan(beatOneHat);
  });

  it("uses a four-bar phrase array for main eighth hats and ignores embellishment hats", () => {
    const result = applyHumanizerFramework(
      createFourBarEighthHatPatternWithEmbellishments(),
      {
        ...testFramework,
        parameters: {
          ...testFramework.parameters,
          hatEighthAccentsMidi: [20, -10, 12, -4],
          hatEighthStepAccentsMidi: [0, 0],
          hatSnareLiftMidi: 0,
        },
      },
      {
        strength: 1,
        tempoBpm: 90,
        seed: "test",
      },
    );

    expect(result.hatSubdivision).toBe("eighth");

    const phrase = [0, 1, 2, 3].map((bar) =>
      midiForOriginalTime(result.events, bar * TICKS_PER_BAR, "closed_hat"),
    );

    expect(phrase).toEqual([84, 54, 76, 60]);
    expect(midiForId(result.events, "hat-embellishment-1")).toBe(64);
  });

  it("applies an audible downbeat/offbeat layer to eighth-note hats", () => {
    const result = applyHumanizerFramework(
      createEighthHatPattern(),
      {
        ...testFramework,
        parameters: {
          ...testFramework.parameters,
          hatEighthAccentsMidi: [0, 0, 0, 0],
          hatEighthStepAccentsMidi: [14, -14],
          hatSnareLiftMidi: 0,
        },
      },
      {
        strength: 1,
        tempoBpm: 90,
        seed: "test",
      },
    );

    expect(result.hatSubdivision).toBe("eighth");
    expect(midiForOriginalTime(result.events, 0, "closed_hat")).toBe(93);
    expect(midiForOriginalTime(result.events, TICKS_PER_BEAT / 2, "closed_hat")).toBe(65);
  });

  it("preserves the hat accent shape when loud hats would otherwise clip", () => {
    const result = applyHumanizerFramework(
      createFourBarEighthHatPatternWithEmbellishments(0.95),
      {
        ...testFramework,
        parameters: {
          ...testFramework.parameters,
          hatEighthAccentsMidi: [20, -10, 12, -4],
          hatEighthStepAccentsMidi: [0, 0],
          hatSnareLiftMidi: 0,
        },
      },
      {
        strength: 1,
        tempoBpm: 90,
        seed: "test",
      },
    );

    const phrase = [0, 1, 2, 3].map((bar) =>
      midiForOriginalTime(result.events, bar * TICKS_PER_BAR, "closed_hat"),
    );

    expect(Math.max(...phrase)).toBe(127);
    expect(phrase).toEqual([127, 97, 119, 103]);
  });

  it("adds extra timing swing to eighth-note hat offbeats", () => {
    const result = applyHumanizerFramework(createEighthHatPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    const downbeatChange = changeForOriginalTime(result.changes, 0, "closed_hat");
    const offbeatChange = changeForOriginalTime(result.changes, TICKS_PER_BEAT / 2, "closed_hat");

    expect(offbeatChange.shiftMs).toBeGreaterThan(downbeatChange.shiftMs);
  });

  it("uses smaller drag values for sixteenth-note hat patterns", () => {
    const eighthResult = applyHumanizerFramework(createEighthHatPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });
    const sixteenthResult = applyHumanizerFramework(createDemoPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    const eighthDownbeat = changeForOriginalTime(eighthResult.changes, 0, "closed_hat");
    const eighthOffbeat = changeForOriginalTime(
      eighthResult.changes,
      TICKS_PER_BEAT / 2,
      "closed_hat",
    );
    const sixteenthDownbeat = changeForOriginalTime(sixteenthResult.changes, 0, "closed_hat");
    const sixteenthOffbeat = changeForOriginalTime(
      sixteenthResult.changes,
      TICKS_PER_BEAT / 4,
      "closed_hat",
    );

    expect(sixteenthDownbeat.shiftTicks).toBeLessThan(eighthDownbeat.shiftTicks);
    expect(sixteenthOffbeat.shiftTicks - sixteenthDownbeat.shiftTicks).toBeLessThan(
      eighthOffbeat.shiftTicks - eighthDownbeat.shiftTicks,
    );
  });

  it("keeps timing shifts beat-relative across project tempos", () => {
    const slowResult = applyHumanizerFramework(createEighthHatPattern(), testFramework, {
      strength: 1,
      tempoBpm: 70,
      seed: "test",
    });
    const fastResult = applyHumanizerFramework(createEighthHatPattern(), testFramework, {
      strength: 1,
      tempoBpm: 140,
      seed: "test",
    });

    const slowOffbeat = changeForOriginalTime(
      slowResult.changes,
      TICKS_PER_BEAT / 2,
      "closed_hat",
    );
    const fastOffbeat = changeForOriginalTime(
      fastResult.changes,
      TICKS_PER_BEAT / 2,
      "closed_hat",
    );

    expect(slowOffbeat.shiftTicks).toBe(fastOffbeat.shiftTicks);
    expect(slowOffbeat.shiftMs).toBeGreaterThan(fastOffbeat.shiftMs);
  });

  it("shapes sixteenth hats with softer offbeat steps", () => {
    const result = applyHumanizerFramework(createDemoPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    expect(result.hatSubdivision).toBe("sixteenth");

    const group = [0, 1, 2, 3].map((step) =>
      midiForOriginalTime(result.events, step * (TICKS_PER_BEAT / 4), "closed_hat"),
    );

    expect(group[0]).toBeGreaterThan(group[1]);
    expect(group[2]).toBeGreaterThan(group[3]);
  });

  it("makes the snare on beat four louder than beat two when both exist", () => {
    const result = applyHumanizerFramework(createDemoPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    const beatTwoSnare = midiForOriginalTime(result.events, TICKS_PER_BEAT, "snare");
    const beatFourSnare = midiForOriginalTime(result.events, TICKS_PER_BEAT * 3, "snare");

    expect(beatFourSnare).toBeGreaterThan(beatTwoSnare);
  });

  it("accents close kick pairs by downbeat or first-offbeat priority", () => {
    const result = applyHumanizerFramework(createKickPairPattern(), testFramework, {
      strength: 1,
      tempoBpm: 90,
      seed: "test",
    });

    const downbeatKick = midiForOriginalTime(result.events, 0, "kick");
    const followingKick = midiForOriginalTime(result.events, TICKS_PER_BEAT / 4, "kick");
    const firstOffbeatKick = midiForOriginalTime(result.events, TICKS_PER_BEAT * 2.5, "kick");
    const secondOffbeatKick = midiForOriginalTime(result.events, TICKS_PER_BEAT * 2.75, "kick");

    expect(downbeatKick).toBeGreaterThan(followingKick);
    expect(firstOffbeatKick).toBeGreaterThan(secondOffbeatKick);
  });

  it("adds small seeded kick jitter that leans slightly behind the beat", () => {
    const result = applyHumanizerFramework(
      createKickPairPattern(),
      {
        ...testFramework,
        parameters: {
          ...testFramework.parameters,
          kickTimingJitterMs: 2,
        },
      },
      {
        strength: 1,
        tempoBpm: 90,
        seed: "kick-position",
      },
    );
    const kickShifts = result.changes
      .filter((change) => change.role === "kick")
      .map((change) => change.shiftMs);
    const averageKickShift =
      kickShifts.reduce((sum, shiftMs) => sum + shiftMs, 0) / kickShifts.length;

    expect(Math.max(...kickShifts.map(Math.abs))).toBeLessThanOrEqual(2.1);
    expect(averageKickShift).toBeGreaterThan(0);
    expect(kickShifts.some((shiftMs) => shiftMs > 0)).toBe(true);
  });

  it("returns original notes at zero strength", () => {
    const original = createDemoPattern();
    const result = applyHumanizerFramework(original, testFramework, {
      strength: 0,
      tempoBpm: 90,
      seed: "test",
    });
    const byId = new Map(result.events.map((event) => [event.id, event]));

    for (const event of original) {
      expect(byId.get(event.id)?.time).toBe(event.time);
      expect(byId.get(event.id)?.velocity).toBe(event.velocity);
    }
  });
});

function midiForOriginalTime(events: DrumEvent[], originalTime: number, role: DrumEvent["role"]) {
  const timingTolerance = TICKS_PER_BEAT * 0.14;
  const event = events.find(
    (candidate) =>
      candidate.role === role && Math.abs(candidate.time - originalTime) <= timingTolerance,
  );
  if (!event) {
    throw new Error(`No event near original time ${originalTime}`);
  }
  return velocityToMidi(event.velocity);
}

function midiForId(events: DrumEvent[], id: string) {
  const event = events.find((candidate) => candidate.id === id);
  if (!event) {
    throw new Error(`No event with id ${id}`);
  }
  return velocityToMidi(event.velocity);
}

function changeForOriginalTime(
  changes: Array<{
    originalTime: number;
    role: DrumEvent["role"];
    shiftMs: number;
    shiftTicks: number;
  }>,
  originalTime: number,
  role: DrumEvent["role"],
) {
  const change = changes.find(
    (candidate) => candidate.role === role && candidate.originalTime === originalTime,
  );
  if (!change) {
    throw new Error(`No change at original time ${originalTime}`);
  }
  return change;
}

function createEighthHatPattern(): DrumEvent[] {
  const events: DrumEvent[] = [];

  for (let step = 0; step < 8; step += 1) {
    events.push({
      id: `hat-${step}`,
      time: step * (TICKS_PER_BEAT / 2),
      pitch: 42,
      velocity: 0.62,
      role: "unknown",
      confidence: 0,
    });
  }

  for (const [index, time] of [
    [0, TICKS_PER_BEAT],
    [1, TICKS_PER_BEAT * 3],
  ] as const) {
    events.push({
      id: `snare-${index}`,
      time,
      pitch: 38,
      velocity: 0.72,
      role: "unknown",
      confidence: 0,
    });
  }

  return events;
}

function createFourBarEighthHatPatternWithEmbellishments(velocity = 0.5): DrumEvent[] {
  const events: DrumEvent[] = [];

  for (let bar = 0; bar < 4; bar += 1) {
    for (let step = 0; step < 8; step += 1) {
      events.push({
        id: `hat-${bar}-${step}`,
        time: bar * TICKS_PER_BAR + step * (TICKS_PER_BEAT / 2),
        pitch: 42,
        velocity,
        role: "unknown",
        confidence: 0,
      });
    }

    events.push({
      id: `hat-embellishment-${bar}`,
      time: bar * TICKS_PER_BAR + TICKS_PER_BEAT / 4,
      pitch: 42,
      velocity,
      role: "unknown",
      confidence: 0,
    });
  }

  return events;
}

function createKickPairPattern(): DrumEvent[] {
  return [
    {
      id: "kick-downbeat",
      time: 0,
      pitch: 36,
      velocity: 0.7,
      role: "unknown",
      confidence: 0,
    },
    {
      id: "kick-follow",
      time: TICKS_PER_BEAT / 4,
      pitch: 36,
      velocity: 0.7,
      role: "unknown",
      confidence: 0,
    },
    {
      id: "kick-offbeat-a",
      time: TICKS_PER_BEAT * 2.5,
      pitch: 36,
      velocity: 0.7,
      role: "unknown",
      confidence: 0,
    },
    {
      id: "kick-offbeat-b",
      time: TICKS_PER_BEAT * 2.75,
      pitch: 36,
      velocity: 0.7,
      role: "unknown",
      confidence: 0,
    },
  ];
}
