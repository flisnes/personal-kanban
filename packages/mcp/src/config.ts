import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  /** Root of the board data repo. */
  dataDir: string;
  /** Working directory of the session that spawned this server — used to pick a board. */
  cwd: string;
  /** $KANBAN_BOARD, if set. */
  envBoard: string | undefined;
  /** Author name recorded in card notes. */
  author: string;
}

function defaultDataDir(): string {
  // From packages/mcp/dist/config.js, the repo root is three levels up; the data repo is its
  // sibling. Keeps a fresh clone working with no configuration.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../..', '..', 'personal-kanban-data');
}

export function loadConfig(): Config {
  const dataDir = resolve(process.env['KANBAN_DATA_DIR'] ?? defaultDataDir());

  if (!existsSync(join(dataDir, 'boards'))) {
    throw new Error(
      `No boards directory at ${join(dataDir, 'boards')}. ` +
        `Set KANBAN_DATA_DIR to the personal-kanban-data checkout.`,
    );
  }

  return {
    dataDir,
    cwd: resolve(process.env['KANBAN_CWD'] ?? process.cwd()),
    envBoard: process.env['KANBAN_BOARD'],
    author: process.env['KANBAN_AUTHOR'] ?? 'claude',
  };
}
