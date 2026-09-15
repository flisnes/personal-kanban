import type { FileChange } from './ops.js';
import { parseWorkspace, type Workspace } from './workspace.js';

/**
 * A thin GitHub client over `fetch`, shared by the browser app and anything else that needs to
 * read the board data repo remotely. Deliberately hand-rolled: Octokit is ~100 KB for features
 * this needs none of, and keeping every network call behind this one module is what makes the
 * eventual swap to a token-broker backend a local change.
 */

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/**
 * The ref moved between the read the caller based its change on and the write. Not a failure —
 * it is the expected outcome of editing the same board from a phone and from this PC, and the
 * caller is meant to refetch, replay its operation against fresh state, and try again.
 */
export class ConflictError extends GitHubError {
  constructor(message: string) {
    super(message, 409, 'The board changed elsewhere. Reload and reapply the change.');
    this.name = 'ConflictError';
  }
}

export interface CommitInput {
  /** The commit the caller's state was built on. This is the concurrency control. */
  parentSha: string;
  branch: string;
  message: string;
  changes: readonly FileChange[];
}

export interface LoadedRepo {
  workspace: Workspace;
  /**
   * The raw blobs the workspace was parsed from. Callers that apply local changes optimistically
   * replay them over these and reparse, so what the screen shows is byte-identical to what the
   * next commit will contain — there is no second, divergent "optimistic update" code path.
   */
  files: Map<string, string>;
  /** Commit the snapshot came from; pass it back as `parentSha` when committing against it. */
  sha: string;
  branch: string;
}

interface BlobNode {
  text?: string | null;
}
interface TreeNode {
  entries?: { name: string; object?: BlobNode & TreeNode }[] | null;
}

const API = 'https://api.github.com';

export class GitHubClient {
  constructor(private readonly config: GitHubConfig) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async rest(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok && response.status !== 304) {
      throw await describe(response);
    }
    return response;
  }

  /** POST/GET a Git Data endpoint and read its JSON body. */
  private async api<T>(path: string, body?: unknown): Promise<T> {
    const init: RequestInit =
      body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
    return (await (await this.rest(path, init)).json()) as T;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${API}/graphql`, {
      method: 'POST',
      headers: { ...this.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) throw await describe(response);

    const payload = (await response.json()) as { data?: T; errors?: { message: string }[] };
    if (payload.errors?.length) {
      const message = payload.errors.map((e) => e.message).join('; ');
      // GraphQL reports a missing or unreachable repo as a 200 with errors, so the hint that the
      // REST path would have attached has to be recovered here — it is the likeliest setup mistake.
      const hint = /could not resolve to a repository/i.test(message)
        ? 'Check the owner and repo name, and that the token is scoped to that repository.'
        : undefined;
      throw new GitHubError(message, 200, hint);
    }
    if (!payload.data) throw new GitHubError('GitHub returned no data', 200);
    return payload.data;
  }

  /** Confirms the token works and actually reaches the data repo. */
  async verify(): Promise<{ login: string; canWrite: boolean }> {
    const user = (await (await this.rest('/user')).json()) as { login?: string };
    const repo = (await (
      await this.rest(`/repos/${this.config.owner}/${this.config.repo}`)
    ).json()) as { permissions?: { push?: boolean } };
    return { login: user.login ?? 'unknown', canWrite: repo.permissions?.push === true };
  }

  /**
   * The whole board set in one request. The REST contents API would need a call per card file;
   * GraphQL can return a directory tree with blob contents inline, so this stays a single round
   * trip no matter how many cards there are.
   */
  async loadWorkspace(): Promise<LoadedRepo> {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          defaultBranchRef { name target { oid } }
          boards: object(expression: "HEAD:boards") { ...tree }
          archive: object(expression: "HEAD:archive") { ...tree }
        }
      }
      fragment tree on Tree {
        entries {
          name
          object {
            ... on Tree {
              entries {
                name
                object {
                  ... on Blob { text }
                  ... on Tree { entries { name object { ... on Blob { text } } } }
                }
              }
            }
          }
        }
      }`;

    const data = await this.graphql<{
      repository: {
        defaultBranchRef?: { name?: string; target?: { oid?: string } } | null;
        boards?: TreeNode | null;
        archive?: TreeNode | null;
      } | null;
    }>(query, { owner: this.config.owner, repo: this.config.repo });

    const repository = data.repository;
    if (!repository) {
      throw new GitHubError(
        `Repository ${this.config.owner}/${this.config.repo} not found`,
        404,
        'Check the owner and repo name, and that the token can see this repository.',
      );
    }

    const files = new Map<string, string>();
    collect(files, 'boards', repository.boards ?? undefined);
    collect(files, 'archive', repository.archive ?? undefined);

    return {
      workspace: parseWorkspace(files),
      files,
      sha: repository.defaultBranchRef?.target?.oid ?? '',
      branch: repository.defaultBranchRef?.name ?? 'main',
    };
  }

  /**
   * One commit containing every change, written through the Git Data API: build a tree on top of
   * `parentSha`'s tree, commit it, then fast-forward the branch ref.
   *
   * The ref update is the concurrency control. Our commit's parent is the state the caller read,
   * so if anything else pushed in the meantime the update is no longer a fast-forward and GitHub
   * rejects it — surfaced as a ConflictError rather than silently clobbering the other change.
   */
  async commitFiles(input: CommitInput): Promise<{ sha: string }> {
    if (input.changes.length === 0) throw new GitHubError('nothing to commit', 400);
    const repo = `/repos/${this.config.owner}/${this.config.repo}`;

    const parent = await this.api<{ tree?: { sha?: string } }>(
      `${repo}/git/commits/${input.parentSha}`,
    );
    const baseTree = parent.tree?.sha;
    if (baseTree === undefined) {
      throw new GitHubError(`commit ${input.parentSha} has no tree`, 502);
    }

    // Inline blob content: the trees endpoint creates the blobs itself, so a multi-file change is
    // still one request rather than one per file.
    const tree = input.changes.map((change) =>
      change.kind === 'delete'
        ? { path: change.path, mode: '100644', type: 'blob', sha: null }
        : { path: change.path, mode: '100644', type: 'blob', content: change.content },
    );

    const created = await this.api<{ sha?: string }>(`${repo}/git/trees`, {
      base_tree: baseTree,
      tree,
    });
    if (created.sha === undefined) throw new GitHubError('GitHub returned no tree sha', 502);

    const commit = await this.api<{ sha?: string }>(`${repo}/git/commits`, {
      message: input.message,
      tree: created.sha,
      parents: [input.parentSha],
    });
    if (commit.sha === undefined) throw new GitHubError('GitHub returned no commit sha', 502);

    try {
      await this.rest(`${repo}/git/refs/heads/${encodeURIComponent(input.branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commit.sha, force: false }),
      });
    } catch (error) {
      if (error instanceof GitHubError && isNotFastForward(error)) {
        throw new ConflictError(`${input.branch} moved since this change was prepared`);
      }
      throw error;
    }

    return { sha: commit.sha };
  }

  /**
   * Cheap freshness check. A conditional request that comes back 304 does not count against the
   * rate limit, so this can poll often without costing anything.
   */
  async latestSha(etag?: string): Promise<{ sha?: string; etag?: string; changed: boolean }> {
    const response = await this.rest(
      `/repos/${this.config.owner}/${this.config.repo}/commits?per_page=1`,
      { headers: etag ? { 'If-None-Match': etag } : {} },
    );
    if (response.status === 304) return { changed: false, ...(etag ? { etag } : {}) };

    const commits = (await response.json()) as { sha?: string }[];
    const nextEtag = response.headers.get('etag') ?? undefined;
    return {
      changed: true,
      ...(commits[0]?.sha ? { sha: commits[0].sha } : {}),
      ...(nextEtag ? { etag: nextEtag } : {}),
    };
  }
}

/** Flatten `boards/<board>/board.json` and `boards/<board>/cards/*.md` into path → content. */
function collect(files: Map<string, string>, root: string, tree: TreeNode | undefined): void {
  for (const boardEntry of tree?.entries ?? []) {
    for (const child of boardEntry.object?.entries ?? []) {
      const childPath = `${root}/${boardEntry.name}/${child.name}`;
      if (typeof child.object?.text === 'string') {
        files.set(childPath, child.object.text);
        continue;
      }
      for (const leaf of child.object?.entries ?? []) {
        if (typeof leaf.object?.text === 'string') {
          files.set(`${childPath}/${leaf.name}`, leaf.object.text);
        }
      }
    }
  }
}

async function describe(response: Response): Promise<GitHubError> {
  let message = response.statusText;
  try {
    const body = (await response.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // no JSON body — the status text will do
  }

  const hints: Record<number, string> = {
    401: 'The token is invalid or expired. Generate a new fine-grained token.',
    403: 'The token lacks permission, or you have hit the rate limit.',
    404: 'Repository not found, or the token is not scoped to it.',
  };
  return new GitHubError(message, response.status, hints[response.status]);
}

/**
 * GitHub answers a rejected ref update with 422 and a message, not a dedicated code — and a 409
 * shows up when the ref is being updated concurrently. Both mean "someone else got there first".
 */
function isNotFastForward(error: GitHubError): boolean {
  return (
    error.status === 409 ||
    (error.status === 422 && /fast forward|not a fast|reference cannot be updated/i.test(error.message))
  );
}
