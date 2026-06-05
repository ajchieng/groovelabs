export const TICKS_PER_BEAT = 960;
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

export type DrumEventSourceKind = "demo" | "audiotool-note";

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
  deviceName?: string;
  role: DrumRole;
  confidence: number;
  source?: DrumEventSource;
};

export type GrooveParameters = {
  snareDelayMs: number;
  kickLoosenessMs: number;
  kickTightness: number;
  hatSwingMs: number;
  hatVelocityAccent: number;
  percussionPushPullMs: number;
  velocityJitter: number;
  ghostNoteProbability: number;
  ghostNoteVelocity: number;
  overallLoosenessMs: number;
};

export type GroovePreset = {
  id: string;
  name: string;
  shortName: string;
  description: string;
  parameters: GrooveParameters;
};

export type GrooveChange = {
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

export type GrooveResult = {
  events: DrumEvent[];
  changes: GrooveChange[];
  explanation: string;
};

export type GrooveEngineOptions = {
  intensity: number;
  tempoBpm: number;
  ticksPerBeat?: number;
  seed?: string;
};

export type RoleDetectionOptions = {
  ticksPerBeat?: number;
};

export type RoleSummary = Record<DrumRole, number>;
