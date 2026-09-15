import {
  KanbanError,
  resolveBoard,
  type Board,
  type FileChange,
  type LoadedCard,
  type OpResult,
  type Workspace,
} from '@kanban/core';
import { applyChanges, gitRemote, readWorkspace } from '@kanban/core/node';
import type { Config } from './config.js';

/**
 * Data access for the tools. The workspace is re-read on every call rather than cached: the web
 * app and `git pull` both change these files behind our back, and a stale board is worse than a
 * few milliseconds of file reads.
 */
export class Store {
  private remote: string | undefined;
  private remoteChecked = false;

  constructor(readonly config: Config) {}

  async load(): Promise<Workspace> {
    return readWorkspace(this.config.dataDir);
  }

  /** Cached for the process lifetime — the session's repo does not move. */
  private async sessionRemote(): Promise<string | undefined> {
    if (!this.remoteChecked) {
      this.remote = await gitRemote(this.config.cwd);
      this.remoteChecked = true;
    }
    return this.remote;
  }

  /**
   * Which board the caller means. An explicit id wins; otherwise the session's directory and git
   * remote decide. When nothing matches we ask rather than guess — picking the wrong board
   * silently is worse than one extra round trip.
   */
  async resolveBoardId(ws: Workspace, explicit?: string): Promise<Board> {
    const result = resolveBoard(ws.boards, {
      explicit,
      envBoard: this.config.envBoard,
      cwd: this.config.cwd,
      gitRemote: await this.sessionRemote(),
    });

    if (result.boardId === undefined) {
      const known = result.candidates.length > 0 ? result.candidates.join(', ') : '(none)';
      throw new KanbanError(
        explicit !== undefined
          ? `No board "${explicit}". Known boards: ${known}`
          : `Could not tell which board applies to ${this.config.cwd}. ` +
            `Pass one of: ${known} — or add that path to the board's projectPaths.`,
      );
    }

    const board = ws.boards.find((b) => b.id === result.boardId);
    if (!board) throw new KanbanError(`No board "${result.boardId}"`);
    return board;
  }

  async write(result: OpResult): Promise<FileChange[]> {
    await applyChanges(this.config.dataDir, result.changes);
    // Phase 2 hooks in here: commit with result.message, then debounce a push.
    return result.changes;
  }
}

/** Short form shown in listings: the tail of the id, which is what a model will quote back. */
export const shortId = (id: string): string => id.slice(-6).toLowerCase();

/**
 * Accepts a full id, the short id from a listing, or an exact title. Models refer to cards by
 * whatever they last saw printed, so all three have to work — but never ambiguously.
 */
export function findCard(ws: Workspace, ref: string, boardId?: string): LoadedCard {
  const pool = boardId === undefined ? ws.cards : ws.cards.filter((c) => c.boardId === boardId);
  const needle = ref.trim();
  const lower = needle.toLowerCase();

  const exact = pool.find((c) => c.id.toLowerCase() === lower);
  if (exact) return exact;

  const bySuffix = pool.filter((c) => shortId(c.id) === lower || c.id.toLowerCase().endsWith(lower));
  if (bySuffix.length === 1 && bySuffix[0]) return bySuffix[0];
  if (bySuffix.length > 1) {
    throw new KanbanError(
      `"${needle}" matches ${bySuffix.length} cards: ` +
        bySuffix.map((c) => `${shortId(c.id)} ${c.title}`).join('; '),
    );
  }

  const byTitle = pool.filter((c) => c.title.toLowerCase() === lower);
  if (byTitle.length === 1 && byTitle[0]) return byTitle[0];
  if (byTitle.length > 1) {
    throw new KanbanError(
      `"${needle}" matches ${byTitle.length} cards by title: ` +
        byTitle.map((c) => `${shortId(c.id)} in ${c.boardId}/${c.column}`).join('; '),
    );
  }

  const near = pool
    .filter((c) => c.title.toLowerCase().includes(lower))
    .slice(0, 5)
    .map((c) => `${shortId(c.id)} ${c.title}`);
  throw new KanbanError(
    `No card matching "${needle}".` + (near.length > 0 ? ` Did you mean: ${near.join('; ')}` : ''),
  );
}
