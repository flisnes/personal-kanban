import { describe, expect, it } from 'vitest';
import {
  compareRank,
  isValidRank,
  rankAtEnd,
  rankAtIndex,
  rankAtStart,
  rankBetween,
  ranksBetween,
  sortByRank,
} from '../src/rank.js';

const ranked = (id: string, rank: string) => ({ id, rank });

describe('rankBetween', () => {
  it('produces a key that sorts strictly between its neighbours', () => {
    const mid = rankBetween('a0', 'a1');
    expect(mid > 'a0').toBe(true);
    expect(mid < 'a1').toBe(true);
  });

  it('supports open ends', () => {
    expect(rankBetween(null, null)).toBe('a0');
    expect(rankBetween('a0', null) > 'a0').toBe(true);
    expect(rankBetween(null, 'a0') < 'a0').toBe(true);
  });

  it('stays strictly between after repeated subdivision', () => {
    let low = 'a0';
    const high = 'a1';
    for (let i = 0; i < 50; i++) {
      const mid = rankBetween(low, high);
      expect(mid > low).toBe(true);
      expect(mid < high).toBe(true);
      low = mid;
    }
  });

  it('reports out-of-order input rather than producing a bad key', () => {
    expect(() => rankBetween('a1', 'a0')).toThrow(/cannot generate a rank/);
  });
});

describe('ranksBetween', () => {
  it('returns n ascending keys', () => {
    const keys = ranksBetween(null, null, 4);
    expect(keys).toHaveLength(4);
    expect([...keys].sort()).toEqual(keys);
  });

  it('returns nothing for a non-positive count', () => {
    expect(ranksBetween(null, null, 0)).toEqual([]);
  });
});

describe('ordering', () => {
  it('breaks rank ties by id so the order is total', () => {
    const a = ranked('B', 'a0');
    const b = ranked('A', 'a0');
    expect(compareRank(a, b)).toBeGreaterThan(0);
    expect(sortByRank([a, b]).map((r) => r.id)).toEqual(['A', 'B']);
  });

  it('does not mutate its input', () => {
    const items = [ranked('C3', 'a2'), ranked('C1', 'a0')];
    sortByRank(items);
    expect(items.map((i) => i.id)).toEqual(['C3', 'C1']);
  });
});

describe('placement', () => {
  const sorted = [ranked('C1', 'a0'), ranked('C2', 'a1'), ranked('C3', 'a2')];

  it('places at the start and end', () => {
    expect(rankAtStart(sorted) < 'a0').toBe(true);
    expect(rankAtEnd(sorted) > 'a2').toBe(true);
  });

  it('places at an index between existing neighbours', () => {
    const rank = rankAtIndex(sorted, 1);
    expect(rank > 'a0').toBe(true);
    expect(rank < 'a1').toBe(true);
  });

  it('clamps an out-of-range index to the end', () => {
    expect(rankAtIndex(sorted, 99) > 'a2').toBe(true);
  });

  it('measures against future neighbours when moving within a list', () => {
    // Moving C1 (currently first) to the end must land after C3, not after itself.
    const rank = rankAtIndex(sorted, 3, 'C1');
    expect(rank > 'a2').toBe(true);
  });

  it('handles an empty list', () => {
    expect(rankAtIndex([], 0)).toBe('a0');
  });
});

describe('isValidRank', () => {
  it('accepts well-formed keys', () => {
    for (const key of ['a0', 'a0V', 'az', 'b00', 'Zz']) expect(isValidRank(key)).toBe(true);
  });

  it('rejects the shapes a human would type by hand', () => {
    for (const key of ['b0', 'a', '', 'xyz', '1', 'first']) expect(isValidRank(key)).toBe(false);
  });
});

// A hand-edited card with a bad rank must not block inserts into its column.
describe('placement with a corrupt neighbour', () => {
  const withBad = [ranked('C1', 'a0'), ranked('BAD', 'b0'), ranked('C3', 'a2')];

  it('ignores the corrupt rank when appending', () => {
    expect(rankAtEnd(withBad) > 'a2').toBe(true);
  });

  it('ignores the corrupt rank when prepending', () => {
    expect(rankAtStart(withBad) < 'a0').toBe(true);
  });

  it('ignores the corrupt rank when inserting at an index', () => {
    const rank = rankAtIndex(withBad, 1);
    expect(rank > 'a0').toBe(true);
    expect(rank < 'a2').toBe(true);
  });

  it('still works when every neighbour is corrupt', () => {
    expect(isValidRank(rankAtEnd([ranked('X', 'b0'), ranked('Y', 'zz')]))).toBe(true);
  });
});
