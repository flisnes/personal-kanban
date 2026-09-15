import {
  applyChangesToFiles,
  ConflictError,
  parseWorkspace,
  type FileChange,
  type OpResult,
  type Workspace,
} from '@kanban/core';

/**
 * Board state and the write queue.
 *
 * The shape here is: a *base* — the last snapshot we know GitHub has — plus a list of *intents*
 * that have not been committed yet. What the screen shows is the base with every pending intent
 * replayed over it. Because an intent is a pure function of a workspace (the same ops the MCP
 * server calls), "replay" is also exactly what conflict recovery needs: refetch the base, run the
 * intents again, commit. No separate optimistic-update path that could disagree with the real one.
 */

export interface RepoSnapshot {
  workspace: Workspace;
  files: Map<string, string>;
  sha: string;
  branch: string;
}

/** Structurally satisfied by `GitHubClient`; a fake stands in for it in tests. */
export interface BoardBackend {
  loadWorkspace(): Promise<RepoSnapshot>;
  commitFiles(input: {
    parentSha: string;
    branch: string;
    message: string;
    changes: readonly FileChange[];
  }): Promise<{ sha: string }>;
  latestSha(etag?: string): Promise<{ sha?: string; etag?: string; changed: boolean }>;
}

export interface Intent {
  /** Shown if the change has to be abandoned, e.g. "move \"Add dark mode\"". */
  label: string;
  /** Pure. Throws if the change no longer makes sense against `ws`. */
  run(ws: Workspace): OpResult;
}

export type SyncState = 'loading' | 'synced' | 'syncing' | 'retrying' | 'failed';

export interface BoardSnapshot {
  workspace: Workspace | null;
  loading: boolean;
  loadError: Error | null;
  sync: SyncState;
  /** Changes not yet on GitHub. */
  pending: number;
  /** Set when a write could not be delivered, or an intent had to be dropped. */
  syncError: string | null;
}

/** Give up replaying after this many rounds — at that point something is wrong, not just racy. */
const MAX_CONFLICT_REPLAYS = 5;
const DEFAULT_POLL_MS = 45_000;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class BoardStore {
  #base: RepoSnapshot | null = null;
  #pending: Intent[] = [];
  #listeners = new Set<() => void>();
  #snapshot: BoardSnapshot = {
    workspace: null,
    loading: true,
    loadError: null,
    sync: 'loading',
    pending: 0,
    syncError: null,
  };
  #draining = false;
  #replays = 0;
  #etag: string | undefined;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly backend: BoardBackend,
    private readonly pollMs = DEFAULT_POLL_MS,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): BoardSnapshot => this.#snapshot;

  /** Initial fetch. Safe to call again; queued changes survive and are replayed. */
  async load(): Promise<void> {
    this.#patch({ loading: this.#base === null, loadError: null });
    try {
      this.#base = await this.backend.loadWorkspace();
      this.#project({ loading: false, loadError: null });
      if (this.#pending.length > 0) void this.#drain();
    } catch (error) {
      this.#patch({
        loading: false,
        loadError: error instanceof Error ? error : new Error(message(error)),
      });
    }
  }

  enqueue(intent: Intent): void {
    this.#pending.push(intent);
    this.#project({ syncError: null, sync: 'syncing' });
    void this.#drain();
  }

  /** After a delivery failure — network back, or the user pressed Retry. */
  retry(): void {
    if (this.#pending.length === 0) return;
    this.#patch({ syncError: null, sync: 'syncing' });
    void this.#drain();
  }

  /** Throw away everything not yet committed. The escape hatch when replay keeps failing. */
  discardPending(): void {
    this.#pending = [];
    this.#replays = 0;
    this.#project({ syncError: null, sync: 'synced' });
  }

  /** Begin ETag polling so a change made from the MCP server shows up here. Returns a stopper. */
  start(): () => void {
    this.stop();
    this.#timer = setInterval(() => void this.poll(), this.pollMs);
    return () => this.stop();
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /**
   * A conditional request that comes back 304 does not count against the rate limit, so this is
   * effectively free to run on a timer. Only a sha we have not seen costs a real fetch.
   */
  async poll(): Promise<void> {
    if (this.#base === null) {
      if (this.#snapshot.loadError) await this.load();
      return;
    }
    try {
      const { changed, sha, etag } = await this.backend.latestSha(this.#etag);
      if (etag !== undefined) this.#etag = etag;
      if (changed && sha !== undefined && sha !== this.#base.sha) await this.load();
    } catch {
      // Offline, or rate limited. Nothing to do but try again on the next tick.
    }
    if (this.#pending.length > 0 && !this.#draining) void this.#drain();
  }

  async #drain(): Promise<void> {
    if (this.#draining) return;
    this.#draining = true;
    try {
      while (this.#pending.length > 0) {
        const base = this.#base;
        const intent = this.#pending[0];
        if (base === null || intent === undefined) break;

        let result: OpResult;
        try {
          result = intent.run(base.workspace);
        } catch (error) {
          // The card was deleted or moved elsewhere while this sat in the queue. Dropping it and
          // saying so is the honest outcome — the alternative is writing a change to a card the
          // user is no longer looking at.
          this.#retire(intent, `Could not apply ${intent.label}: ${message(error)}`);
          continue;
        }

        if (result.changes.length === 0) {
          this.#retire(intent, null);
          continue;
        }

        this.#patch({ sync: 'syncing' });
        try {
          const { sha } = await this.backend.commitFiles({
            parentSha: base.sha,
            branch: base.branch,
            message: result.message,
            changes: result.changes,
          });
          const files = applyChangesToFiles(base.files, result.changes);
          this.#base = { files, workspace: parseWorkspace(files), sha, branch: base.branch };
          this.#retire(intent, null);
        } catch (error) {
          if (error instanceof ConflictError && this.#replays < MAX_CONFLICT_REPLAYS) {
            this.#replays += 1;
            this.#patch({ sync: 'retrying' });
            await this.load();
            continue;
          }
          // Keep the queue: the change is still on screen, and `retry()` or the next poll will
          // have another go. Losing the user's edit because the wifi dropped would be worse.
          this.#patch({ sync: 'failed', syncError: message(error) });
          return;
        }
      }
      if (this.#pending.length === 0) this.#patch({ sync: 'synced' });
    } finally {
      this.#draining = false;
    }
  }

  /**
   * Drop one intent from the queue, optionally reporting why it never landed. By identity, not by
   * position: a commit that was already in flight when the user pressed Discard still completes,
   * and popping the head blindly would retire whatever they queued next instead.
   */
  #retire(intent: Intent, error: string | null): void {
    const at = this.#pending.indexOf(intent);
    if (at !== -1) this.#pending.splice(at, 1);
    this.#replays = 0;
    this.#project(error === null ? {} : { syncError: error });
  }

  /** Recompute the visible workspace as base + pending, dropping intents that no longer apply. */
  #project(patch: Partial<BoardSnapshot> = {}): void {
    const base = this.#base;
    if (base === null) {
      this.#patch({ ...patch, pending: this.#pending.length });
      return;
    }

    let files = base.files;
    let workspace = base.workspace;
    const kept: Intent[] = [];
    let dropped: string | null = null;

    for (const intent of this.#pending) {
      try {
        const result = intent.run(workspace);
        files = applyChangesToFiles(files, result.changes);
        workspace = parseWorkspace(files);
        kept.push(intent);
      } catch (error) {
        dropped = `Could not apply ${intent.label}: ${message(error)}`;
      }
    }
    this.#pending = kept;

    // The drop message goes on last: `enqueue` clears syncError as it projects, and an intent
    // that just died on the way in is exactly what the user needs told about.
    this.#patch({
      workspace,
      pending: kept.length,
      ...patch,
      ...(dropped === null ? {} : { syncError: dropped }),
    });
  }

  #patch(patch: Partial<BoardSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...patch, pending: patch.pending ?? this.#pending.length };
    for (const listener of this.#listeners) listener();
  }
}
