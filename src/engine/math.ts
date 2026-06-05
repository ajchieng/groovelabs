export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ticksToMs(ticks: number, tempoBpm: number, ticksPerBeat: number) {
  const msPerBeat = 60_000 / tempoBpm;
  return (ticks / ticksPerBeat) * msPerBeat;
}

export function msToTicks(ms: number, tempoBpm: number, ticksPerBeat: number) {
  const msPerBeat = 60_000 / tempoBpm;
  return (ms / msPerBeat) * ticksPerBeat;
}

export function hashString(input: string) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededUnit(seed: string) {
  let state = hashString(seed);
  state += 0x6d2b79f5;
  let value = Math.imul(state ^ (state >>> 15), state | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export function seededSigned(seed: string) {
  return seededUnit(seed) * 2 - 1;
}

export function nearestGridDistance(time: number, grid: number) {
  const nearest = Math.round(time / grid) * grid;
  return time - nearest;
}
