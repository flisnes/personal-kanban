import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitOptions {
  enabled: boolean;
  /** Skip a pull if we pulled more recently than this. */
  pullTtlMs: number;
  /** Coalescing window for pushes, so a burst of edits becomes one push. */
  pushDelayMs: number;
}

interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Git sync for the board data.
 *
 * Two things drive the design. First, several Claude sessions can be open at once, each with its
 * own server process writing the same clone — so every git invocation is serialised in-process and
 * retried when another process holds the index lock. Second, sync is a convenience, never a
 * gate: if the network is down or the remote rejects us, the write has already landed on disk and
 * the tool must still succeed. Failures surface as warnings, not errors.
 */
export class Git {
  /** In-process serialisation: git is not safe to run concurrently against one working tree. */
  private chain: Promise<unknown> = Promise.resolve();
  private lastPull = 0;
  private pushTimer: NodeJS.Timeout | undefined;
  private pushPending = false;
  private upstream: boolean | undefined;

  readonly available: boolean;

  constructor(
    private readonly dir: string,
    private readonly options: GitOptions,
  ) {
    this.available = options.enabled && existsSync(join(dir, '.git'));
  }

  private serialise<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    // Keep the chain alive regardless of outcome, so one failure cannot wedge every later call.
    this.chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async run(args: string[], attempt = 0): Promise<RunResult> {
    try {
      return await execFileAsync('git', args, { cwd: this.dir, windowsHide: true });
    } catch (error) {
      const message = describeExecError(error);
      // Another process (another session's server) is mid-commit. Back off and try again.
      if (attempt < 4 && /index\.lock|Unable to create|another git process/i.test(message)) {
        await delay(120 * (attempt + 1));
        return this.run(args, attempt + 1);
      }
      throw new Error(message);
    }
  }

  private async hasUpstream(): Promise<boolean> {
    if (this.upstream === undefined) {
      try {
        await this.run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
        this.upstream = true;
      } catch {
        this.upstream = false;
      }
    }
    return this.upstream;
  }

  /** Pull if our view of the repo is older than the TTL. Returns a warning, or undefined. */
  async refresh(force = false): Promise<string | undefined> {
    if (!this.available) return undefined;
    if (!force && Date.now() - this.lastPull < this.options.pullTtlMs) return undefined;

    return this.serialise(async () => {
      if (!(await this.hasUpstream())) {
        this.lastPull = Date.now();
        return undefined;
      }
      try {
        await this.run(['pull', '--rebase', '--autostash']);
        this.lastPull = Date.now();
        return undefined;
      } catch (error) {
        // Leave the working tree in a usable state rather than mid-rebase.
        await this.run(['rebase', '--abort']).catch(() => undefined);
        this.lastPull = Date.now();
        return `could not pull board changes: ${firstLine(error)}`;
      }
    });
  }

  /**
   * Stage exactly the paths we wrote and commit them. Staging only our own paths keeps an
   * unrelated hand edit in the data repo from being swept into our commit.
   */
  async commit(message: string, paths: readonly string[]): Promise<string | undefined> {
    if (!this.available || paths.length === 0) return undefined;

    return this.serialise(async () => {
      try {
        await this.run(['add', '--all', '--', ...paths]);
        try {
          await this.run(['diff', '--cached', '--quiet', '--', ...paths]);
          return undefined; // exit 0 means nothing staged
        } catch {
          // exit 1 means there are staged changes, which is what we want
        }
        await this.run(['commit', '--no-verify', '-m', message, '--', ...paths]);
        return undefined;
      } catch (error) {
        return `changes saved to disk but not committed: ${firstLine(error)}`;
      }
    });
  }

  /** Queue a push, coalescing a burst of writes into one. */
  schedulePush(): void {
    if (!this.available) return;
    this.pushPending = true;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.flush(), this.options.pushDelayMs);
    this.pushTimer.unref();
  }

  /** Push now if one is queued. Returns a warning, or undefined. */
  async flush(): Promise<string | undefined> {
    if (!this.available || !this.pushPending) return undefined;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
    this.pushPending = false;

    return this.serialise(async () => {
      if (!(await this.hasUpstream())) return undefined;
      try {
        await this.run(['push']);
        return undefined;
      } catch (error) {
        // Someone pushed first. Rebase onto them and try once more — the ordinary two-device case.
        try {
          await this.run(['pull', '--rebase', '--autostash']);
          await this.run(['push']);
          this.lastPull = Date.now();
          return undefined;
        } catch (retryError) {
          await this.run(['rebase', '--abort']).catch(() => undefined);
          return `committed locally but not pushed: ${firstLine(retryError)}`;
        }
      }
    });
  }

  /** Commits made locally that the remote does not have yet. -1 when there is no upstream. */
  async unpushedCount(): Promise<number> {
    if (!this.available) return 0;
    try {
      if (!(await this.hasUpstream())) return -1;
      const { stdout } = await this.serialise(() =>
        this.run(['rev-list', '--count', '@{u}..HEAD']),
      );
      return Number(stdout.trim()) || 0;
    } catch {
      return -1;
    }
  }

  /** Uncommitted paths in the data repo, for reporting. */
  async dirtyPaths(): Promise<string[]> {
    if (!this.available) return [];
    try {
      const { stdout } = await this.serialise(() => this.run(['status', '--porcelain']));
      return stdout
        .split('\n')
        .map((l) => l.slice(3).trim())
        .filter((l) => l.length > 0);
    } catch {
      return [];
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function describeExecError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const e = error as { stderr?: string; stdout?: string; message?: string };
    const detail = (e.stderr ?? '').trim() || (e.stdout ?? '').trim();
    if (detail) return detail;
    if (e.message) return e.message;
  }
  return String(error);
}

const firstLine = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? 'unknown error';
