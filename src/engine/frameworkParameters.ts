import type { HumanizerFrameworkParameters } from "../types/groove";
import { defaultFramework } from "../data/humanizerFrameworks";

const DEFAULTS = defaultFramework.parameters;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// Pad/truncate to the expected length and replace any non-finite entries with the
// matching default. Guarantees the accent lookups (which index by bar/step) stay in
// bounds and never read `undefined`, and that `array.length` modulos are never 0.
function fixedArray(
  value: unknown,
  fallback: readonly number[],
): { result: number[]; corrected: boolean } {
  const source = Array.isArray(value) ? value : [];
  let corrected = source.length !== fallback.length;
  const result = fallback.map((defaultValue, index) => {
    const candidate = source[index];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    corrected = true;
    return defaultValue;
  });
  return { result, corrected };
}

// Coerce unvalidated framework parameters (which may arrive with NaN/Infinity scalars
// or wrong-length accent arrays) into a safe, fully-populated shape. Corrections fall
// back to the canonical "push-pull" defaults and are reported via console.warn rather
// than thrown, so a malformed framework degrades gracefully instead of producing NaN
// output or crashing on a modulo-by-zero.
export function sanitizeFrameworkParameters(
  params: Partial<HumanizerFrameworkParameters> | undefined,
): HumanizerFrameworkParameters {
  const input = params ?? {};
  const corrected: string[] = [];

  const sanitized = {} as Record<keyof HumanizerFrameworkParameters, number | number[]>;

  for (const key of Object.keys(DEFAULTS) as (keyof HumanizerFrameworkParameters)[]) {
    const defaultValue = DEFAULTS[key];
    const candidate = (input as Record<string, unknown>)[key];

    if (Array.isArray(defaultValue)) {
      const { result, corrected: didCorrect } = fixedArray(candidate, defaultValue);
      sanitized[key] = result;
      if (didCorrect) {
        corrected.push(key);
      }
    } else {
      const value = finiteOr(candidate, defaultValue as number);
      sanitized[key] = value;
      if (value !== candidate) {
        corrected.push(key);
      }
    }
  }

  if (corrected.length > 0) {
    console.warn(`sanitizeFrameworkParameters: corrected ${corrected.join(", ")}`);
  }

  return sanitized as unknown as HumanizerFrameworkParameters;
}
