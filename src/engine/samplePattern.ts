import type { DrumEvent } from "../types/groove";
import { TICKS_PER_BEAT } from "../types/groove";
import { detectDrumRoles } from "./roleDetection";

export function createDemoPattern(): DrumEvent[] {
  const sixteenth = TICKS_PER_BEAT / 4;
  const events: DrumEvent[] = [];

  for (let step = 0; step < 16; step += 1) {
    events.push({
      id: `demo-hat-${step}`,
      time: step * sixteenth,
      pitch: 42,
      velocity: step % 2 === 0 ? 0.66 : 0.54,
      duration: Math.round(sixteenth * 0.8),
      sampleName: "Closed Hat",
      role: "unknown",
      confidence: 0,
      source: { kind: "demo" },
    });
  }

  for (const [index, time] of [
    [0, 0],
    [1, TICKS_PER_BEAT * 2],
    [2, TICKS_PER_BEAT * 2 + sixteenth * 2],
  ] as const) {
    events.push({
      id: `demo-kick-${index}`,
      time,
      pitch: 36,
      velocity: index === 0 ? 0.94 : 0.86,
      duration: Math.round(sixteenth * 0.9),
      sampleName: "Kick",
      role: "unknown",
      confidence: 0,
      source: { kind: "demo" },
    });
  }

  for (const [index, time] of [
    [0, TICKS_PER_BEAT],
    [1, TICKS_PER_BEAT * 3],
  ] as const) {
    events.push({
      id: `demo-snare-${index}`,
      time,
      pitch: 38,
      velocity: 0.82,
      duration: Math.round(sixteenth * 0.9),
      sampleName: "Snare",
      role: "unknown",
      confidence: 0,
      source: { kind: "demo" },
    });
  }

  events.push({
    id: "demo-clap-late",
    time: TICKS_PER_BEAT * 3,
    pitch: 39,
    velocity: 0.48,
    duration: Math.round(sixteenth * 0.8),
    sampleName: "Clap",
    role: "unknown",
    confidence: 0,
    source: { kind: "demo" },
  });

  return detectDrumRoles(events);
}
