import type { Board } from './schema.js';

/**
 * Working out which board the user means without being told.
 *
 * This is what turns "let's pick a thing from this project's kanban board" into a zero-argument
 * request: a session in C:/Users/Haakon/develop/mtg_app resolves to the mtg-app board by matching
 * the working directory, or failing that the git remote.
 */

export type ResolvedVia = 'explicit' | 'env' | 'cwd' | 'remote' | 'only-board' | 'unresolved';

export interface ResolveInput {
  /** Board id passed directly by the caller — always wins. */
  explicit?: string | undefined;
  /** $KANBAN_BOARD. */
  envBoard?: string | undefined;
  cwd?: string | undefined;
  gitRemote?: string | undefined;
}

export interface ResolveResult {
  boardId?: string;
  via: ResolvedVia;
  /** Board ids to offer the user when resolution failed. */
  candidates: string[];
}

/** Lower-cased, forward-slashed, no trailing slash. Windows paths compare case-insensitively. */
export function normalizePath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** `git@github.com:me/repo.git`, `https://github.com/me/repo` → `github.com/me/repo`. */
export function normalizeRemote(remote: string): string {
  return remote
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^[^/@]+@/, '')
    .replace(/^([^/:]+):(?!\d)/, '$1/')
    // Trailing slashes come off before the .git suffix — ".../repo.git/" is a real spelling.
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function pathMatchLength(cwd: string, projectPath: string): number {
  const a = normalizePath(cwd);
  const b = normalizePath(projectPath);
  if (b.length === 0) return 0;
  if (a === b || a.startsWith(`${b}/`)) return b.length;
  return 0;
}

export function resolveBoard(boards: readonly Board[], input: ResolveInput): ResolveResult {
  const candidates = boards.map((b) => b.id);
  const has = (id: string | undefined): id is string =>
    id !== undefined && boards.some((b) => b.id === id);

  if (input.explicit !== undefined) {
    return has(input.explicit)
      ? { boardId: input.explicit, via: 'explicit', candidates }
      : { via: 'unresolved', candidates };
  }
  if (has(input.envBoard)) return { boardId: input.envBoard, via: 'env', candidates };

  // Most specific project path wins, so a board for a subdirectory beats one for its parent.
  if (input.cwd !== undefined) {
    let best: { id: string; length: number } | undefined;
    for (const board of boards) {
      for (const projectPath of board.projectPaths) {
        const length = pathMatchLength(input.cwd, projectPath);
        if (length > 0 && (best === undefined || length > best.length)) {
          best = { id: board.id, length };
        }
      }
    }
    if (best) return { boardId: best.id, via: 'cwd', candidates };
  }

  if (input.gitRemote !== undefined) {
    const target = normalizeRemote(input.gitRemote);
    const match = boards.find((b) => b.gitRemotes.some((r) => normalizeRemote(r) === target));
    if (match) return { boardId: match.id, via: 'remote', candidates };
  }

  const only = boards[0];
  if (boards.length === 1 && only) return { boardId: only.id, via: 'only-board', candidates };

  return { via: 'unresolved', candidates };
}
