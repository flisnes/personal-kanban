import {
  applyChangesToFiles,
  columnCards,
  ConflictError,
  parseWorkspace,
  type FileChange,
} from '@kanban/core';
import { describe, expect, it, vi } from 'vitest';
import { BoardStore, type BoardBackend, type RepoSnapshot } from '../src/lib/boardStore.js';
import { archiveCardIntent, createCardIntent, moveCardIntent } from '../src/lib/intents.js';

const BOARD = JSON.stringify({
  id: 'demo',
  name: 'Demo',
  columns: [
    { id: 'todo', name: 'To Do' },
    { id: 'doing', name: 'In Progress' },
  ],
  labels: [],
});

const card = (id: string, title: string, column: string, rank: string): string =>
  [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `column: ${column}`,
    `rank: '${rank}'`,
    'priority: P2',
    "created: '2026-01-01T00:00:00.000Z'",
    "updated: '2026-01-01T00:00:00.000Z'",
    '---',
    '',
    'Body.',
    '',
  ].join('\n');

/** An in-memory stand-in for the data repo, with the same fast-forward rule GitHub enforces. */
class FakeRepo implements BoardBackend {
  files = new Map<string, string>([
    ['boards/demo/board.json', BOARD],
    ['boards/demo/cards/one.md', card('C1', 'First', 'todo', 'a0')],
    ['boards/demo/cards/two.md', card('C2', 'Second', 'todo', 'a1')],
  ]);
  sha = 'sha-0';
  commits: { message: string; changes: readonly FileChange[] }[] = [];
  /** Set to make the next commit attempt blow up, e.g. to simulate the network dropping. */
  failNext: Error | null = null;
  /** Set before a write to hold that one commit open until `release()`. Arms once. */
  gateNext = false;
  /** Commits currently held open. */
  inFlight = 0;
  #release: (() => void) | null = null;
  #n = 0;

  loadWorkspace(): Promise<RepoSnapshot> {
    const files = new Map(this.files);
    return Promise.resolve({ files, workspace: parseWorkspace(files), sha: this.sha, branch: 'main' });
  }

  async commitFiles(input: {
    parentSha: string;
    message: string;
    changes: readonly FileChange[];
  }): Promise<{ sha: string }> {
    if (this.gateNext) {
      this.gateNext = false;
      this.inFlight += 1;
      await new Promise<void>((resolve) => (this.#release = resolve));
      this.inFlight -= 1;
    }
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (input.parentSha !== this.sha) throw new ConflictError('main moved');
    this.files = applyChangesToFiles(this.files, input.changes);
    this.sha = `sha-${++this.#n}`;
    this.commits.push({ message: input.message, changes: input.changes });
    return { sha: this.sha };
  }

  latestSha(etag?: string): Promise<{ sha?: string; etag?: string; changed: boolean }> {
    return Promise.resolve({ changed: etag !== this.sha, sha: this.sha, etag: this.sha });
  }

  release(): void {
    this.#release?.();
    this.#release = null;
  }

  /** Someone else — the MCP server, or a phone — pushing while we were looking away. */
  push(path: string, content: string): void {
    this.files.set(path, content);
    this.sha = `sha-${++this.#n}`;
  }
}

const todo = (store: BoardStore): string[] => {
  const ws = store.getSnapshot().workspace;
  return ws === null ? [] : columnCards(ws, 'demo', 'todo').map((c) => c.id);
};

const settled = (store: BoardStore): Promise<void> =>
  vi.waitFor(() => expect(store.getSnapshot().sync).toBe('synced'));

describe('BoardStore', () => {
  it('loads the board', async () => {
    const store = new BoardStore(new FakeRepo());
    await store.load();
    expect(store.getSnapshot().loading).toBe(false);
    expect(todo(store)).toEqual(['C1', 'C2']);
  });

  it('shows a move before it has been committed, and commits it with the ops message', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    repo.gateNext = true;
    store.enqueue(moveCardIntent('C1', 'First', { after: 'C2' }));

    // The board must not wait on the network.
    expect(todo(store)).toEqual(['C2', 'C1']);
    expect(store.getSnapshot().pending).toBe(1);
    expect(repo.commits).toHaveLength(0);

    repo.release();
    await settled(store);
    expect(repo.commits.map((c) => c.message)).toEqual([
      'kanban(demo): reposition "First" in todo',
    ]);
    expect(store.getSnapshot().pending).toBe(0);
  });

  it('serialises a burst of changes into one commit each, in order', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    store.enqueue(moveCardIntent('C1', 'First', { column: 'doing' }));
    store.enqueue(createCardIntent({ boardId: 'demo', title: 'Third', column: 'todo' }));
    store.enqueue(archiveCardIntent('C2', 'Second'));
    await settled(store);

    expect(repo.commits.map((c) => c.message)).toEqual([
      'kanban(demo): move "First" to doing',
      'kanban(demo): add "Third"',
      'kanban(demo): archive "Second"',
    ]);
    expect(repo.commits.every((c) => c.changes.length > 0)).toBe(true);
  });

  // The payoff of keeping intents as functions rather than as precomputed file contents.
  it('replays a move against the board as it now is, not as it was', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    // Someone appends a card while our snapshot is stale, so the first ref update is rejected.
    repo.push('boards/demo/cards/nine.md', card('C9', 'Ninth', 'todo', 'a2'));

    store.enqueue(moveCardIntent('C1', 'First', { after: 'C2' }));
    await settled(store);

    // Replayed against the fresh board, the card still lands where it was dropped — directly
    // after C2 — rather than at the bottom where a precomputed rank would have put it.
    expect(todo(store)).toEqual(['C2', 'C1', 'C9']);
    expect(parseWorkspace(repo.files).cards.find((c) => c.id === 'C1')?.rank).toMatch(/^a1/);
  });

  it('keeps an undelivered change on screen and lands it on retry', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    repo.failNext = new Error('Failed to fetch');
    store.enqueue(moveCardIntent('C1', 'First', { column: 'doing' }));
    await vi.waitFor(() => expect(store.getSnapshot().sync).toBe('failed'));

    expect(store.getSnapshot().pending).toBe(1);
    expect(store.getSnapshot().syncError).toBe('Failed to fetch');
    expect(todo(store)).toEqual(['C2']); // still shown as moved

    store.retry();
    await settled(store);
    expect(repo.commits).toHaveLength(1);
    expect(store.getSnapshot().pending).toBe(0);
  });

  it('discards a stuck change when asked, reverting the board', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    repo.failNext = new Error('Failed to fetch');
    store.enqueue(moveCardIntent('C1', 'First', { column: 'doing' }));
    await vi.waitFor(() => expect(store.getSnapshot().sync).toBe('failed'));

    store.discardPending();
    expect(todo(store)).toEqual(['C1', 'C2']);
    expect(store.getSnapshot().pending).toBe(0);
  });

  // A commit already on the wire cannot be recalled. What must not happen is the queue then
  // retiring whatever was enqueued after the discard, in its place.
  it('does not swallow a change queued after a discard', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    repo.gateNext = true;
    store.enqueue(moveCardIntent('C1', 'First', { column: 'doing' }));
    await vi.waitFor(() => expect(repo.inFlight).toBe(1));

    store.discardPending();
    store.enqueue(moveCardIntent('C2', 'Second', { column: 'doing' }));
    repo.release();
    await settled(store);

    expect(repo.commits.map((c) => c.message)).toEqual([
      'kanban(demo): move "First" to doing',
      'kanban(demo): move "Second" to doing',
    ]);
  });

  it('drops a change whose card is gone, and says so rather than failing silently', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    repo.files.delete('boards/demo/cards/one.md');
    repo.sha = 'sha-elsewhere';
    await store.load();

    store.enqueue(moveCardIntent('C1', 'First', { column: 'doing' }));
    await vi.waitFor(() => expect(store.getSnapshot().syncError).toMatch(/no card with id "C1"/));
    expect(store.getSnapshot().pending).toBe(0);
    expect(repo.commits).toHaveLength(0);
  });

  it('picks up a change made elsewhere on the next poll', async () => {
    const repo = new FakeRepo();
    const store = new BoardStore(repo);
    await store.load();

    repo.push('boards/demo/cards/nine.md', card('C9', 'Ninth', 'todo', 'a2'));
    await store.poll();

    expect(todo(store)).toEqual(['C1', 'C2', 'C9']);
  });

  it('does not refetch when nothing has moved', async () => {
    const repo = new FakeRepo();
    const load = vi.spyOn(repo, 'loadWorkspace');
    const store = new BoardStore(repo);
    await store.load();

    await store.poll();
    await store.poll();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('surfaces a load failure instead of showing an empty board', async () => {
    const repo = new FakeRepo();
    vi.spyOn(repo, 'loadWorkspace').mockRejectedValue(new Error('Bad credentials'));
    const store = new BoardStore(repo);
    await store.load();

    expect(store.getSnapshot().loadError?.message).toBe('Bad credentials');
    expect(store.getSnapshot().workspace).toBeNull();
  });
});
