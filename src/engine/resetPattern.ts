import { TICKS_PER_BEAT, type DrumEvent, type DrumRole, type HatSubdivision } from "../types/groove";
import { midiToVelocity } from "./drumFormat";
import { clamp } from "./math";

export const RESET_VELOCITY_MIDI = 90;
export const RESET_VELOCITY = midiToVelocity(RESET_VELOCITY_MIDI);

export function resetPatternToGrooveGrid(
  events: DrumEvent[],
  options: { hatSubdivision?: HatSubdivision; ticksPerBeat?: number; velocity?: number } = {},
) {
  const ticksPerBeat = options.ticksPerBeat ?? TICKS_PER_BEAT;
  const hatGridTicks = hatResetGridTicks(options.hatSubdivision ?? "sixteenth", ticksPerBeat);
  const velocity = clamp(options.velocity ?? RESET_VELOCITY, 0, 1);

  return events.map((event) => ({
    ...event,
    time: quantizeTime(event.time, resetGridTicksForRole(event.role, hatGridTicks, ticksPerBeat)),
    velocity,
  }));
}

export function resetPatternToSixteenths(
  events: DrumEvent[],
  options: { ticksPerBeat?: number; velocity?: number } = {},
) {
  const velocity = clamp(options.velocity ?? RESET_VELOCITY, 0, 1);
  const gridTicks = (options.ticksPerBeat ?? TICKS_PER_BEAT) / 4;

  return events.map((event) => ({
    ...event,
    time: quantizeTime(event.time, gridTicks),
    velocity,
  }));
}

function resetGridTicksForRole(role: DrumRole, hatGridTicks: number, ticksPerBeat: number) {
  if (role === "closed_hat" || role === "open_hat") {
    return hatGridTicks;
  }

  if (role === "kick" || role === "snare" || role === "clap") {
    return ticksPerBeat / 2;
  }

  return hatGridTicks;
}

function hatResetGridTicks(subdivision: HatSubdivision, ticksPerBeat: number) {
  return subdivision === "eighth" ? ticksPerBeat / 2 : ticksPerBeat / 4;
}

function quantizeTime(time: number, gridTicks: number) {
  return Math.max(0, Math.round(time / gridTicks) * gridTicks);
}
