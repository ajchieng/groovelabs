import type { HumanizerFramework } from "../types/groove";

export const humanizerFrameworks: HumanizerFramework[] = [
  {
    id: "push-pull",
    name: "Push-Pull",
    shortName: "Push-Pull",
    description: "Heavy hat drag, pushed backbeats, and exaggerated velocity shape.",
    parameters: {
      hatDragMs: 15,
      hatOffbeatDragMs: 10,
      hatSixteenthDragMs: 6,
      hatSixteenthOffbeatDragMs: 3,
      hatTimingJitterMs: 4,
      hatVelocityJitterMidi: 5,
      hatEighthDownbeatLiftMidi: 36,
      hatEighthOffbeatDipMidi: 14,
      hatSixteenthAccentsMidi: [18, -8, 12, -6],
      hatSnareLiftMidi: 3,
      snarePushMs: 15,
      snareTimingJitterMs: 8,
      snareVelocityJitterMidi: 8,
      snareBeatFourLiftMidi: 8,
      kickTimingJitterMs: 8,
      kickVelocityJitterMidi: 10,
      kickDoubleDownbeatLiftMidi: 3,
      kickDoubleOffbeatFirstLiftMidi: 3,
      kickDoubleFollowDipMidi: 3,
    },
  },
];

export const defaultFramework = humanizerFrameworks[0];
