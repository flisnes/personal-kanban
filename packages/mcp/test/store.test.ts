import { parseWorkspace, type Workspace } from '@kanban/core';
import { describe, expect, it } from 'vitest';
import { findCard, shortId } from '../src/store.js';

const card = (id: string, title: string, column = 'todo', rank = 'a0', board = 'demo'): string =>
  [
    '---',
    `id: ${id}`,
    `title: '${title.replace(/'/g, "''")}'`,
    `column: ${column}`,
    `rank: '${rank}'`,
    "created: '2026-01-01T00:00:00.000Z'",
    "updated: '2026-01-01T00:00:00.000Z'",
    '---',
    '',
    `Body for ${board}.`,
    '',
  ].join('\n');

const board = (id: string) =>
  JSON.stringify({ id, name: id, columns: [{ id: 'todo', name: 'To Do' }] });

const ws: Workspace = parseWorkspace([
  ['boards/demo/board.json', board('demo')],
  ['boards/demo/cards/a.md', card('01AAAAAAAAAAAAAAAAAAPE0004', 'Read tools')],
  ['boards/demo/cards/b.md', card('01BBBBBBBBBBBBBBBBBBPE0005', 'Write tools', 'todo', 'a1')],
  ['boards/other/board.json', board('other')],
  ['boards/other/cards/c.md', card('01CCCCCCCCCCCCCCCCCCPE0006', 'Read tools', 'todo', 'a0', 'other')],
]);

describe('shortId', () => {
  it('is the lowercased tail of the id, matching what listings print', () => {
    expect(shortId('01AAAAAAAAAAAAAAAAAAPE0004')).toBe('pe0004');
  });
});

describe('findCard', () => {
  it('finds by full id, case-insensitively', () => {
    expect(findCard(ws, '01aaaaaaaaaaaaaaaaaape0004').title).toBe('Read tools');
  });

  it('finds by the short id a listing printed', () => {
    expect(findCard(ws, 'pe0005').title).toBe('Write tools');
  });

  it('finds by exact title', () => {
    expect(findCard(ws, 'Write tools').title).toBe('Write tools');
  });

  it('matches titles case-insensitively', () => {
    expect(findCard(ws, 'write TOOLS').title).toBe('Write tools');
  });

  // The important one: two boards can hold cards with the same title.
  it('refuses to pick between duplicate titles across boards', () => {
    expect(() => findCard(ws, 'Read tools')).toThrow(/matches 2 cards by title/);
  });

  it('resolves a duplicate title once a board narrows it', () => {
    expect(findCard(ws, 'Read tools', 'other').boardId).toBe('other');
  });

  it('scopes short-id lookup to the given board', () => {
    expect(() => findCard(ws, 'pe0004', 'other')).toThrow(/No card matching/);
  });

  it('suggests near matches instead of failing blankly', () => {
    expect(() => findCard(ws, 'tools')).toThrow(/Did you mean/);
  });

  it('reports an unknown reference with no false suggestions', () => {
    expect(() => findCard(ws, 'zzzz')).toThrow(/No card matching "zzzz"\.$/);
  });

  it('ignores surrounding whitespace', () => {
    expect(findCard(ws, '  pe0005  ').title).toBe('Write tools');
  });
});
