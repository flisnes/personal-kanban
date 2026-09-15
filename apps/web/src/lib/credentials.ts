export interface Credentials {
  owner: string;
  repo: string;
  token: string;
}

const KEY = 'kanban.credentials';

/**
 * The token lives in localStorage, which is the honest cost of a static site with no backend:
 * anyone with access to this browser profile can read it. It is scoped to one repo and should
 * carry an expiry — and `clear()` is wired to a visible sign-out for shared machines.
 */
export function loadCredentials(): Credentials | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Credentials>;
    if (!parsed.owner || !parsed.repo || !parsed.token) return null;
    return { owner: parsed.owner, repo: parsed.repo, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveCredentials(credentials: Credentials): void {
  localStorage.setItem(KEY, JSON.stringify(credentials));
}

export function clearCredentials(): void {
  localStorage.removeItem(KEY);
}
