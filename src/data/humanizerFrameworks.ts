import type { HumanizerFramework } from "../types/groove";

export const humanizerFrameworks: HumanizerFramework[] = [
  {
    id: "push-pull",
    name: "Push-Pull",
    shortName: "Push-Pull",
    description: "Heavy hat drag, pushed backbeats, and exaggerated velocity shape.",
    parameters: {
      // Eighth-note hat timing: every main hat gets the base drag, then offbeat
      // eighths get the extra offbeat drag.
      hatEighthDragMs: 15,
      hatEighthOffbeatDragMs: 10,
      // Dense sixteenth patterns use smaller timing moves so they do not smear.
      hatSixteenthDragMs: 7,
      hatSixteenthOffbeatDragMs: 4,
      hatTimingJitterMs: 4,
      hatVelocityJitterMidi: 7,
      // Four-bar phrase contour for main eighth-note hats.
      hatEighthAccentsMidi: [24, -26, 22, -24],
      // Per-beat eighth-note contour: downbeat eighth, then offbeat eighth.
      hatEighthStepAccentsMidi: [10, -10],
      // Four sixteenth positions inside a beat.
      hatSixteenthAccentsMidi: [14, -8, 12, -6],
      hatSnareLiftMidi: 3,
      // Snare push is negative in the engine: this value moves backbeats earlier.
      snarePushMs: 10,
      snareTimingJitterMs: 8,
      snareVelocityJitterMidi: 8,
      snareBeatFourLiftMidi: 4,
      kickTimingJitterMs: 8,
      kickVelocityJitterMidi: 10,
      kickDoubleDownbeatLiftMidi: 2,
      kickDoubleOffbeatFirstLiftMidi: 2,
      kickDoubleFollowDipMidi: 2,
    },
  },
];

export const defaultFramework = humanizerFrameworks[0];
