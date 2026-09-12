import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Card order is a fractional index: a string key strictly between its neighbours. Moving a card
 * rewrites exactly one file, never the rest of the column — which is what keeps drag-and-drop from
 * producing 20-file commits and what makes concurrent edits from two devices merge cleanly.
 */

export interface Ranked {
  id: string;
  rank: string;
}

/**
 * The underlying generator does not reject reversed bounds — it returns a key anyway, which would
 * silently corrupt the column's order. Check the invariant ourselves before trusting it.
 */
function assertOrdered(a: string | null, b: string | null): void {
  if (a !== null && b !== null && a >= b) {
    throw new Error(
      `cannot generate a rank between ${JSON.stringify(a)} and ${JSON.stringify(b)}: ` +
        `the bounds are reversed or equal`,
    );
  }
}

/** A rank strictly between `a` and `b`. Pass null for "start of list" / "end of list". */
export function rankBetween(a: string | null, b: string | null): string {
  assertOrdered(a, b);
  try {
    return generateKeyBetween(a, b);
  } catch (cause) {
    throw new Error(
      `cannot generate a rank between ${JSON.stringify(a)} and ${JSON.stringify(b)}: ` +
        `malformed rank`,
      { cause },
    );
  }
}

/** `n` ranks strictly between `a` and `b`, in ascending order. */
export function ranksBetween(a: string | null, b: string | null, n: number): string[] {
  if (n <= 0) return [];
  assertOrdered(a, b);
  try {
    return generateNKeysBetween(a, b, n);
  } catch (cause) {
    throw new Error(
      `cannot generate ${n} ranks between ${JSON.stringify(a)} and ${JSON.stringify(b)}`,
      { cause },
    );
  }
}

/**
 * Comparator, with the card id as tiebreak. Duplicate ranks are possible in principle — two
 * devices can append to the same column while offline — so the order still has to be total.
 */
export function compareRank(a: Ranked, b: Ranked): number {
  if (a.rank === b.rank) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return a.rank < b.rank ? -1 : 1;
}

export function sortByRank<T extends Ranked>(items: readonly T[]): T[] {
  return [...items].sort(compareRank);
}

/** Rank that places an item at the end of an already-sorted list. */
export function rankAtEnd(sorted: readonly Ranked[]): string {
  const last = sorted.at(-1);
  return rankBetween(last ? last.rank : null, null);
}

/** Rank that places an item at the start of an already-sorted list. */
export function rankAtStart(sorted: readonly Ranked[]): string {
  const first = sorted[0];
  return rankBetween(null, first ? first.rank : null);
}

/**
 * Rank for dropping an item into a sorted list at `index` (0 = first, list.length = last).
 * `excludeId` is the item being moved, so a within-column move measures against its future
 * neighbours rather than against itself.
 */
export function rankAtIndex(
  sorted: readonly Ranked[],
  index: number,
  excludeId?: string,
): string {
  const others = excludeId === undefined ? sorted : sorted.filter((i) => i.id !== excludeId);
  const clamped = Math.max(0, Math.min(index, others.length));
  const before = clamped > 0 ? others[clamped - 1] : undefined;
  const after = others[clamped];
  return rankBetween(before?.rank ?? null, after?.rank ?? null);
}
