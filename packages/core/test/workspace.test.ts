import { describe, expect, it } from 'vitest';
import { parseWorkspace } from '../src/workspace.js';
import { DEMO_BOARD, cardFile, makeWorkspace } from './fixture.js';

const boardJson = JSON.stringify(DEMO_BOARD);

describe('parseWorkspace', () => {
  it('loads boards and cards', () => {
    const ws = makeWorkspace();
    expect(ws.boards.map((b) => b.id)).toEqual(['demo']);
    expect(ws.cards).toHaveLength(3);
    expect(ws.issues).toEqual([]);
  });

  it('separates archived cards from live ones', () => {
    const ws = parseWorkspace([
      ['boards/demo/board.json', boardJson],
      ['boards/demo/cards/a--000001.md', cardFile({ id: 'A', title: 'A', column: 'todo', rank: 'a0' })],
      ['archive/demo/cards/b--000002.md', cardFile({ id: 'B', title: 'B', column: 'done', rank: 'a0' })],
    ]);
    expect(ws.cards.map((c) => c.id)).toEqual(['A']);
    expect(ws.archived.map((c) => c.id)).toEqual(['B']);
  });

  it('accepts Windows-style separators in the supplied paths', () => {
    const ws = parseWorkspace([
      ['boards\\demo\\board.json', boardJson],
      ['boards\\demo\\cards\\a--000001.md', cardFile({ id: 'A', title: 'A', column: 'todo', rank: 'a0' })],
    ]);
    expect(ws.cards[0]?.path).toBe('boards/demo/cards/a--000001.md');
  });

  it('ignores files that are not board data', () => {
    const ws = parseWorkspace([
      ['boards/demo/board.json', boardJson],
      ['README.md', '# hello'],
      ['boards/demo/notes.txt', 'scratch'],
      ['boards/demo/cards/.gitkeep', ''],
    ]);
    expect(ws.cards).toEqual([]);
    expect(ws.issues).toEqual([]);
  });

  // One bad file must not take the board down with it: these get hand-edited.
  it('reports a malformed card as an issue and keeps the rest of the board', () => {
    const ws = parseWorkspace([
      ['boards/demo/board.json', boardJson],
      ['boards/demo/cards/good--000001.md', cardFile({ id: 'A', title: 'A', column: 'todo', rank: 'a0' })],
      ['boards/demo/cards/bad--000002.md', 'no frontmatter here'],
    ]);
    expect(ws.cards.map((c) => c.id)).toEqual(['A']);
    expect(ws.issues).toHaveLength(1);
    expect(ws.issues[0]?.path).toBe('boards/demo/cards/bad--000002.md');
  });

  it('reports invalid board.json as an issue', () => {
    const ws = parseWorkspace([['boards/demo/board.json', '{ not json']]);
    expect(ws.boards).toEqual([]);
    expect(ws.issues[0]?.message).toMatch(/SyntaxError|JSON/);
  });

  it('flags a card whose column is not defined on its board', () => {
    const ws = parseWorkspace([
      ['boards/demo/board.json', boardJson],
      ['boards/demo/cards/a--000001.md', cardFile({ id: 'A', title: 'A', column: 'ghost', rank: 'a0' })],
    ]);
    expect(ws.cards).toHaveLength(1);
    expect(ws.issues[0]?.message).toMatch(/column "ghost" is not defined/);
  });

  it('flags a card belonging to a board with no board.json', () => {
    const ws = parseWorkspace([
      ['boards/orphan/cards/a--000001.md', cardFile({ id: 'A', title: 'A', column: 'todo', rank: 'a0' })],
    ]);
    expect(ws.issues[0]?.message).toMatch(/no board\.json/);
  });

  it('flags duplicate card ids', () => {
    const ws = parseWorkspace([
      ['boards/demo/board.json', boardJson],
      ['boards/demo/cards/a--000001.md', cardFile({ id: 'DUP', title: 'A', column: 'todo', rank: 'a0' })],
      ['boards/demo/cards/b--000002.md', cardFile({ id: 'DUP', title: 'B', column: 'todo', rank: 'a1' })],
    ]);
    expect(ws.issues.some((i) => i.message.includes('duplicate card id'))).toBe(true);
  });

  it('flags a board whose id disagrees with its directory', () => {
    const ws = parseWorkspace([
      ['boards/renamed/board.json', boardJson],
    ]);
    expect(ws.issues[0]?.message).toMatch(/does not match its directory/);
    // The directory wins, so paths and lookups stay consistent.
    expect(ws.boards[0]?.id).toBe('renamed');
  });
});
