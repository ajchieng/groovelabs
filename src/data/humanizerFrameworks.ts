import type { HumanizerFramework } from "../types/groove";

export const humanizerFrameworks: HumanizerFramework[] = [
  {
    id: "push-pull",
    name: "Push-Pull",
    shortName: "Push-Pull",
    description: "Heavy hat drag, pushed backbeats, and exaggerated velocity shape.",
    parameters: {
      hatEighthDragMs: 15,
      hatEighthOffbeatDragMs: 10,
      hatSixteenthDragMs: 7,
      hatSixteenthOffbeatDragMs: 4,
      hatTimingJitterMs: 4,
      hatVelocityJitterMidi: 7,
      hatEighthAccentsMidi: [24, -26, 22, -24],
      hatEighthStepAccentsMidi: [10, -10],
      hatSixteenthAccentsMidi: [14, -8, 12, -6],
      hatSnareLiftMidi: 3,
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
