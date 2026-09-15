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
      headers: { ...this.headers, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!response.ok && response.status !== 304) {
      throw await describe(response);
    }
    return response;
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
  async loadWorkspace(): Promise<{ workspace: Workspace; sha: string }> {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          defaultBranchRef { target { oid } }
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
        defaultBranchRef?: { target?: { oid?: string } } | null;
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
      sha: repository.defaultBranchRef?.target?.oid ?? '',
    };
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
