// Lookups across the engine key events by `id`. When two items share an id, a
// naive `new Map(items.map(...))` silently drops all but the last occurrence,
// causing invisible data loss. `uniqueById` makes the rule explicit: keep the
// first occurrence, warn about the rest, and never throw in production.
export function uniqueById<T extends { id: string }>(items: readonly T[], label: string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  let dropped = 0;

  for (const item of items) {
    if (seen.has(item.id)) {
      dropped += 1;
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }

  if (dropped > 0) {
    console.warn(`${label}: dropped ${dropped} duplicate event id(s)`);
  }

  return result;
}
