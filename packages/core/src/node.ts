import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { promisify } from 'node:util';
import type { FileChange } from './ops.js';
import { ARCHIVE_DIR, BOARDS_DIR } from './paths.js';
import { parseWorkspace, type Workspace } from './workspace.js';

const execFileAsync = promisify(execFile);

/** Node-only filesystem bindings. The browser builds the same Workspace from GitHub API blobs. */

const DATA_DIRS = [BOARDS_DIR, ARCHIVE_DIR] as const;
const DATA_FILES = /\.(?:md|json)$/i;

export async function readFiles(rootDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const dir of DATA_DIRS) {
    const absolute = join(rootDir, dir);
    let entries: string[];
    try {
      entries = await readdir(absolute, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (!DATA_FILES.test(entry)) continue;
      const relative = `${dir}/${entry.replace(/\\/g, '/')}`;
      files.set(relative, await readFile(join(absolute, entry), 'utf8'));
    }
  }
  return files;
}

export async function readWorkspace(rootDir: string): Promise<Workspace> {
  return parseWorkspace(await readFiles(rootDir));
}

export async function applyChanges(rootDir: string, changes: readonly FileChange[]): Promise<void> {
  for (const change of changes) {
    const target = resolvePath(rootDir, change.path);
    // Guard against a malformed path escaping the data directory.
    if (!target.startsWith(resolvePath(rootDir))) {
      throw new Error(`refusing to write outside the data directory: ${change.path}`);
    }
    if (change.kind === 'delete') {
      await rm(target, { force: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, change.content, 'utf8');
    }
  }
}

/** The origin remote of the repo containing `cwd`, if there is one. */
export async function gitRemote(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
    const url = stdout.trim();
    return url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}
