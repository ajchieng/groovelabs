import type { HumanizerFramework } from "../types/groove";

export const humanizerFrameworks: HumanizerFramework[] = [
  {
    id: "push-pull",
    name: "Push-Pull",
    shortName: "Push-Pull",
    description: "Heavy hat drag, pushed backbeats, and exaggerated velocity shape.",
    parameters: {
      hatDragMs: 45,
      hatOffbeatDragMs: 12,
      hatTimingJitterMs: 12,
      hatVelocityJitterMidi: 10,
      hatEighthDownbeatLiftMidi: 36,
      hatEighthOffbeatDipMidi: 76,
      hatSixteenthAccentsMidi: [62, -82, 50, -76],
      hatSnareLiftMidi: 22,
      snarePushMs: 24,
      snareTimingJitterMs: 8,
      snareVelocityJitterMidi: 8,
      snareBeatFourLiftMidi: 16,
      kickVelocityJitterMidi: 10,
      kickDoubleDownbeatLiftMidi: 16,
      kickDoubleOffbeatFirstLiftMidi: 13,
      kickDoubleFollowDipMidi: 11,
    },
  },
];

export const defaultFramework = humanizerFrameworks[0];
