import { describe, expect, it } from 'vitest';
import { parseCard } from '../src/card.js';
import {
  addNote,
  archiveCard,
  createCard,
  deleteCard,
  KanbanError,
  moveCard,
  reorderColumn,
  staleDoneCards,
  updateCard,
  type FileChange,
} from '../src/ops.js';
import { columnCards, getCard, parseWorkspace } from '../src/workspace.js';
import { T0, makeWorkspace } from './fixture.js';

/** Re-parse an emitted change set so assertions run against what would actually hit disk. */
function written(changes: readonly FileChange[]) {
  return changes.flatMap((c) => (c.kind === 'write' ? [{ path: c.path, card: parseCard(c.content) }] : []));
}

describe('createCard', () => {
  it('writes one file, at the bottom of the first column by default', () => {
    const ws = makeWorkspace();
    const { card, changes, message } = createCard(ws, {
      boardId: 'demo',
      title: 'New thing',
      now: T0,
    });

    expect(changes).toHaveLength(1);
    expect(card.column).toBe('backlog');
    expect(card.path).toMatch(/^boards\/demo\/cards\/new-thing--[a-z0-9]{6}\.md$/);
    expect(message).toBe('kanban(demo): add "New thing"');
    expect(written(changes)[0]?.card.title).toBe('New thing');
  });

  it('places a card after a named sibling', () => {
    const ws = makeWorkspace();
    const { card } = createCard(ws, {
      boardId: 'demo',
      title: 'Between',
      column: 'todo',
      placement: { after: 'C1' },
      now: T0,
    });
    expect(card.rank > 'a0').toBe(true);
    expect(card.rank < 'a1').toBe(true);
  });

  it('places a card at the top when asked', () => {
    const ws = makeWorkspace();
    const { card } = createCard(ws, {
      boardId: 'demo',
      title: 'Urgent',
      column: 'todo',
      placement: { position: 'top' },
      now: T0,
    });
    expect(card.rank < 'a0').toBe(true);
  });

  it('rejects an unknown board, listing the ones that exist', () => {
    const ws = makeWorkspace();
    expect(() => createCard(ws, { boardId: 'nope', title: 'x' })).toThrow(KanbanError);
    expect(() => createCard(ws, { boardId: 'nope', title: 'x' })).toThrow(/Known boards: demo/);
  });

  it('rejects an unknown column, listing the ones that exist', () => {
    const ws = makeWorkspace();
    expect(() => createCard(ws, { boardId: 'demo', title: 'x', column: 'nope' })).toThrow(
      /has no column "nope". Columns: backlog, todo, doing, done/,
    );
  });
});

describe('moveCard', () => {
  it('touches exactly one file when moving between columns', () => {
    const ws = makeWorkspace();
    const { card, changes, message } = moveCard(ws, 'C2', { column: 'doing' }, T0);
    expect(changes).toHaveLength(1);
    expect(card.column).toBe('doing');
    expect(message).toBe('kanban(demo): move "Second" to doing');
  });

  it('keeps the file path stable across a move', () => {
    const ws = makeWorkspace();
    const before = getCard(ws, 'C2')?.path;
    const { card } = moveCard(ws, 'C2', { column: 'doing' }, T0);
    expect(card.path).toBe(before);
  });

  it('reorders within a column without disturbing siblings', () => {
    const ws = makeWorkspace();
    const { card, changes, message } = moveCard(ws, 'C3', { before: 'C1' }, T0);
    expect(changes).toHaveLength(1);
    expect(card.rank < 'a0').toBe(true);
    expect(message).toBe('kanban(demo): reposition "Third" in todo');
  });

  it('lands after the last card when moving the first card to the bottom', () => {
    const ws = makeWorkspace();
    const { card } = moveCard(ws, 'C1', { position: 'bottom' }, T0);
    expect(card.rank > 'a2').toBe(true);
  });

  it('bumps the updated timestamp', () => {
    const ws = makeWorkspace();
    const later = new Date('2026-02-02T12:00:00.000Z');
    const { card } = moveCard(ws, 'C1', { column: 'done' }, later);
    expect(card.updated).toBe(later.toISOString());
    expect(card.created).toBe(T0.toISOString());
  });

  it('rejects a placement relative to a card in another column', () => {
    const ws = makeWorkspace();
    expect(() => moveCard(ws, 'C1', { column: 'doing', after: 'C2' }, T0)).toThrow(
      /is not in that column/,
    );
  });
});

describe('updateCard', () => {
  it('does not rename the file when the title changes', () => {
    const ws = makeWorkspace();
    const original = getCard(ws, 'C1');
    const { card, changes } = updateCard(ws, 'C1', { title: 'Renamed entirely' }, T0);
    expect(card.path).toBe(original?.path);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'write', path: original?.path });
  });

  it('clears an estimate when explicitly set to null', () => {
    const ws = makeWorkspace();
    const withEstimate = updateCard(ws, 'C1', { estimate: 'M' }, T0).card;
    expect(withEstimate.estimate).toBe('M');
    const cleared = updateCard({ ...ws, cards: [withEstimate] }, 'C1', { estimate: null }, T0).card;
    expect(cleared.estimate).toBeUndefined();
  });

  it('leaves untouched fields alone', () => {
    const ws = makeWorkspace();
    const { card } = updateCard(ws, 'C1', { priority: 'P0' }, T0);
    expect(card.priority).toBe('P0');
    expect(card.title).toBe('First');
    expect(card.rank).toBe('a0');
  });
});

describe('reorderColumn', () => {
  it('applies an explicit order and only rewrites what moved', () => {
    const ws = makeWorkspace();
    const { changes, message } = reorderColumn(ws, 'demo', 'todo', ['C3', 'C1', 'C2'], T0);

    const ranks = new Map(written(changes).map((w) => [w.card.id, w.card.rank]));
    const rankOf = (id: string) => ranks.get(id) ?? getCard(ws, id)?.rank ?? '';
    expect(rankOf('C3') < rankOf('C1')).toBe(true);
    expect(rankOf('C1') < rankOf('C2')).toBe(true);
    expect(message).toMatch(/reorder todo/);
  });

  it('is a no-op when the order is already correct', () => {
    const ws = makeWorkspace();
    expect(reorderColumn(ws, 'demo', 'todo', ['C1', 'C2', 'C3'], T0).changes).toEqual([]);
  });

  it('keeps unmentioned cards at the end, in their existing order', () => {
    const ws = makeWorkspace();
    const { changes } = reorderColumn(ws, 'demo', 'todo', ['C3'], T0);
    const ranks = new Map(written(changes).map((w) => [w.card.id, w.card.rank]));
    const rankOf = (id: string) => ranks.get(id) ?? getCard(ws, id)?.rank ?? '';
    expect(rankOf('C3') < rankOf('C1')).toBe(true);
    expect(rankOf('C1') < rankOf('C2')).toBe(true);
  });

  it('rejects ids that are not in the column', () => {
    const ws = makeWorkspace();
    expect(() => reorderColumn(ws, 'demo', 'todo', ['nope'], T0)).toThrow(/is not in demo\/todo/);
  });
});

describe('archiveCard', () => {
  it('moves the file under archive/ and records when', () => {
    const ws = makeWorkspace();
    const { card, changes } = archiveCard(ws, 'C1', T0);
    expect(changes).toEqual([
      { kind: 'delete', path: 'boards/demo/cards/first--000001.md' },
      { kind: 'write', path: 'archive/demo/cards/first--000001.md', content: expect.any(String) },
    ]);
    expect(card.extra?.['archivedAt']).toBe(T0.toISOString());
  });

  it('keeps the archived card parseable, with its provenance', () => {
    const ws = makeWorkspace();
    const { changes } = archiveCard(ws, 'C1', T0);
    const archived = written(changes)[0]?.card;
    expect(archived?.id).toBe('C1');
    expect(archived?.extra?.['archivedAt']).toBe(T0.toISOString());
  });
});

describe('deleteCard', () => {
  it('emits a single delete', () => {
    const ws = makeWorkspace();
    expect(deleteCard(ws, 'C2').changes).toEqual([
      { kind: 'delete', path: 'boards/demo/cards/second--000002.md' },
    ]);
  });

  it('rejects an unknown id', () => {
    expect(() => deleteCard(makeWorkspace(), 'nope')).toThrow(/no card with id "nope"/);
  });
});

describe('addNote', () => {
  it('appends a dated entry to the body', () => {
    const ws = makeWorkspace();
    const { card, message } = addNote(ws, 'C1', 'ranks live in theme.dart', 'claude', T0);
    expect(card.body).toContain('- 2026-01-01 (claude): ranks live in theme.dart');
    expect(message).toBe('kanban(demo): note on "First"');
  });

  it('survives a serialise/parse round trip', () => {
    const ws = makeWorkspace();
    const { changes } = addNote(ws, 'C1', 'a finding', 'claude', T0);
    expect(written(changes)[0]?.card.body).toContain('a finding');
  });
});

describe('staleDoneCards', () => {
  it('finds cards sitting past their column auto-archive window', () => {
    const ws = parseWorkspace([
      ['boards/demo/board.json', JSON.stringify({
        id: 'demo',
        name: 'Demo',
        columns: [{ id: 'done', name: 'Done', autoArchiveAfterDays: 14 }],
      })],
      ['boards/demo/cards/old--000001.md', [
        '---', 'id: OLD', 'title: Old', 'column: done', "rank: 'a0'",
        "created: '2026-01-01T00:00:00.000Z'", "updated: '2026-01-01T00:00:00.000Z'",
        '---', '', 'x', '',
      ].join('\n')],
    ]);

    expect(staleDoneCards(ws, 'demo', new Date('2026-01-10T00:00:00.000Z'))).toHaveLength(0);
    expect(staleDoneCards(ws, 'demo', new Date('2026-02-01T00:00:00.000Z'))).toHaveLength(1);
  });
});

describe('workspace queries', () => {
  it('returns a column in rank order', () => {
    expect(columnCards(makeWorkspace(), 'demo', 'todo').map((c) => c.id)).toEqual([
      'C1',
      'C2',
      'C3',
    ]);
  });
});
