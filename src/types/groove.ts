export const TICKS_PER_BEAT = 3840;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = TICKS_PER_BEAT * BEATS_PER_BAR;

export type DrumRole =
  | "kick"
  | "snare"
  | "closed_hat"
  | "open_hat"
  | "clap"
  | "perc"
  | "unknown";

export type DrumEventSourceKind = "demo" | "audiotool-note" | "audiotool-pattern-step";

export type DrumEventSource = {
  kind: DrumEventSourceKind;
  entityId?: string;
  collectionLocation?: unknown;
  raw?: unknown;
};

export type DrumEvent = {
  id: string;
  time: number;
  velocity: number;
  duration?: number;
  pitch?: number;
  sampleName?: string;
  padName?: string;
  stripName?: string;
  regionName?: string;
  trackName?: string;
  deviceName?: string;
  deviceType?: string;
  role: DrumRole;
  confidence: number;
  source?: DrumEventSource;
};

export type HatSubdivision = "quarter" | "eighth" | "sixteenth" | "mixed" | "none";

export type HumanizerFrameworkId = "push-pull";

export type HumanizerFrameworkParameters = {
  hatDragMs: number;
  hatOffbeatDragMs: number;
  hatTimingJitterMs: number;
  hatVelocityJitterMidi: number;
  hatEighthDownbeatLiftMidi: number;
  hatEighthOffbeatDipMidi: number;
  hatSixteenthAccentsMidi: readonly [number, number, number, number];
  hatSnareLiftMidi: number;
  snarePushMs: number;
  snareTimingJitterMs: number;
  snareVelocityJitterMidi: number;
  snareBeatFourLiftMidi: number;
  kickVelocityJitterMidi: number;
  kickDoubleDownbeatLiftMidi: number;
  kickDoubleOffbeatFirstLiftMidi: number;
  kickDoubleFollowDipMidi: number;
};

export type HumanizerFramework = {
  id: HumanizerFrameworkId;
  name: string;
  shortName: string;
  description: string;
  parameters: HumanizerFrameworkParameters;
};

export type HumanizerChange = {
  id: string;
  originalId?: string;
  role: DrumRole;
  originalTime: number;
  newTime: number;
  shiftTicks: number;
  shiftMs: number;
  originalVelocity: number;
  newVelocity: number;
  velocityDelta: number;
  added: boolean;
};

export type HumanizerResult = {
  events: DrumEvent[];
  changes: HumanizerChange[];
  explanation: string;
  roleSummary: RoleSummary;
  hatSubdivision: HatSubdivision;
};

export type HumanizerEngineOptions = {
  strength: number;
  tempoBpm: number;
  ticksPerBeat?: number;
  seed?: string;
};

export type RoleDetectionOptions = {
  ticksPerBeat?: number;
};

export type RoleSummary = Record<DrumRole, number>;
