import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, GitHubClient, GitHubError } from '../src/github.js';

const CONFIG = { owner: 'flisnes', repo: 'personal-kanban-data', token: 'tok' };

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
}

/**
 * A fetch stub that answers the Git Data endpoints in sequence. `overrides` replaces the response
 * for a matching URL fragment, which is how the conflict case is set up.
 */
function stubFetch(overrides: { match: string; status: number; body: unknown }[] = []): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    calls.push({ url, method, body });

    const override = overrides.find((o) => url.includes(o.match));
    const respond = (payload: unknown, status = 200): Response =>
      new Response(JSON.stringify(payload), { status });

    if (override) return respond(override.body, override.status);
    if (url.includes('/git/commits/')) return respond({ sha: 'parent', tree: { sha: 'tree-0' } });
    if (url.endsWith('/git/trees')) return respond({ sha: 'tree-1' });
    if (url.endsWith('/git/commits')) return respond({ sha: 'commit-1' });
    if (url.includes('/git/refs/heads/')) return respond({ ref: 'refs/heads/main' });
    throw new Error(`unexpected request: ${method} ${url}`);
  });

  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('commitFiles', () => {
  const input = {
    parentSha: 'parent',
    branch: 'main',
    message: 'kanban(demo): move "First" to doing',
    changes: [
      { kind: 'write' as const, path: 'boards/demo/cards/a.md', content: 'hello' },
      { kind: 'delete' as const, path: 'boards/demo/cards/b.md' },
    ],
  };

  it('builds one tree on the parent and fast-forwards the ref', async () => {
    const calls = stubFetch();
    const result = await new GitHubClient(CONFIG).commitFiles(input);

    expect(result).toEqual({ sha: 'commit-1' });
    expect(calls.map((c) => `${c.method} ${c.url.split('/git/')[1]}`)).toEqual([
      'GET commits/parent',
      'POST trees',
      'POST commits',
      'PATCH refs/heads/main',
    ]);
  });

  it('sends writes as inline blobs and deletions as a null sha, so it stays one request', () => {
    const calls = stubFetch();
    return new GitHubClient(CONFIG).commitFiles(input).then(() => {
      const tree = calls.find((c) => c.url.endsWith('/git/trees'))?.body;
      expect(tree?.['base_tree']).toBe('tree-0');
      expect(tree?.['tree']).toEqual([
        { path: 'boards/demo/cards/a.md', mode: '100644', type: 'blob', content: 'hello' },
        { path: 'boards/demo/cards/b.md', mode: '100644', type: 'blob', sha: null },
      ]);
    });
  });

  it('parents the commit on the sha the caller read, which is the concurrency control', async () => {
    const calls = stubFetch();
    await new GitHubClient(CONFIG).commitFiles(input);
    const commit = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/commits'))?.body;
    expect(commit).toEqual({ message: input.message, tree: 'tree-1', parents: ['parent'] });
  });

  it('never force-updates the ref', async () => {
    const calls = stubFetch();
    await new GitHubClient(CONFIG).commitFiles(input);
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      sha: 'commit-1',
      force: false,
    });
  });

  // The whole point of passing parentSha: someone else pushed, so this is a replay, not a failure.
  it('reports a rejected ref update as a conflict', async () => {
    stubFetch([
      {
        match: '/git/refs/heads/',
        status: 422,
        body: { message: 'Update is not a fast forward' },
      },
    ]);
    await expect(new GitHubClient(CONFIG).commitFiles(input)).rejects.toBeInstanceOf(ConflictError);
  });

  it('leaves other ref failures as plain errors', async () => {
    stubFetch([
      { match: '/git/refs/heads/', status: 403, body: { message: 'Resource not accessible' } },
    ]);
    const error = await new GitHubClient(CONFIG).commitFiles(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).not.toBeInstanceOf(ConflictError);
    expect((error as GitHubError).status).toBe(403);
  });

  it('refuses an empty change set rather than writing an empty commit', async () => {
    stubFetch();
    await expect(
      new GitHubClient(CONFIG).commitFiles({ ...input, changes: [] }),
    ).rejects.toThrow(/nothing to commit/);
  });
});

describe('loadWorkspace', () => {
  it('returns the raw blobs and the branch alongside the parsed board', async () => {
    vi.stubGlobal('fetch', async () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              repository: {
                defaultBranchRef: { name: 'trunk', target: { oid: 'abc123' } },
                boards: {
                  entries: [
                    {
                      name: 'demo',
                      object: {
                        entries: [
                          {
                            name: 'board.json',
                            object: {
                              text: JSON.stringify({
                                id: 'demo',
                                name: 'Demo',
                                columns: [{ id: 'todo', name: 'To Do' }],
                              }),
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
                archive: null,
              },
            },
          }),
        ),
      ),
    );

    const loaded = await new GitHubClient(CONFIG).loadWorkspace();
    expect(loaded.sha).toBe('abc123');
    expect(loaded.branch).toBe('trunk');
    // The blobs are what optimistic writes are replayed over, so they have to come back too.
    expect([...loaded.files.keys()]).toEqual(['boards/demo/board.json']);
    expect(loaded.workspace.boards[0]?.name).toBe('Demo');
  });
});
