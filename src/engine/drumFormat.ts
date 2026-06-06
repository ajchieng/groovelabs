import type { DrumRole, HatSubdivision } from "../types/groove";
import { clamp } from "./math";

export function velocityToMidi(velocity: number) {
  return Math.round(clamp(velocity, 0, 1) * 127);
}

export function midiToVelocity(midiVelocity: number) {
  return round(clamp(Math.round(midiVelocity), 0, 127) / 127, 4);
}

export function roleLabel(role: DrumRole) {
  switch (role) {
    case "closed_hat":
      return "Closed Hat";
    case "open_hat":
      return "Open Hat";
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

export function hatSubdivisionLabel(subdivision: HatSubdivision) {
  switch (subdivision) {
    case "quarter":
      return "4ths";
    case "eighth":
      return "8ths";
    case "sixteenth":
      return "16ths";
    case "mixed":
      return "Mixed";
    case "none":
      return "None";
  }
}

function round(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
