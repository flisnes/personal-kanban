import { GitHubClient, GitHubError } from '@kanban/core';
import { useState, type FormEvent } from 'react';
import type { Credentials } from '../lib/credentials.js';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export function SetupScreen({
  onConnect,
  initial,
}: {
  onConnect: (credentials: Credentials) => void;
  initial?: Credentials | null;
}): React.ReactElement {
  const [owner, setOwner] = useState(initial?.owner ?? '');
  const [repo, setRepo] = useState(initial?.repo ?? 'personal-kanban-data');
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<'idle' | 'checking'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Verify before saving: a token that cannot reach the repo should fail here, with GitHub's own
  // words, rather than turning into a blank board later.
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setStatus('checking');
    setError(null);
    const credentials = { owner: owner.trim(), repo: repo.trim(), token: token.trim() };

    try {
      const { canWrite } = await new GitHubClient(credentials).verify();
      await new GitHubClient(credentials).loadWorkspace();
      if (!canWrite) {
        setError(
          'Connected, but this token is read-only. Editing from the browser will need ' +
            'Contents: Read and write.',
        );
      }
      onConnect(credentials);
    } catch (caught) {
      const hint = caught instanceof GitHubError ? caught.hint : undefined;
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(hint ? `${message} — ${hint}` : message);
      setStatus('idle');
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
      <h1 className="text-2xl font-semibold">Connect your board</h1>
      <p className="mt-2 text-sm text-[--color-muted]">
        This page talks to your private data repo directly from the browser. Nothing is stored
        anywhere but this device.
      </p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="GitHub username" value={owner} onChange={setOwner} placeholder="flisnes" />
        <Field label="Data repository" value={repo} onChange={setRepo} placeholder="personal-kanban-data" />
        <Field
          label="Fine-grained access token"
          value={token}
          onChange={setToken}
          placeholder="github_pat_…"
          type="password"
        />

        <div className="rounded-lg border border-[--color-line] bg-[--color-surface] p-4 text-sm text-[--color-muted]">
          <a href={TOKEN_URL} target="_blank" rel="noreferrer" className="font-medium text-sky-600 underline dark:text-sky-400">
            Create a token
          </a>{' '}
          with <strong>only</strong> this repository selected, and{' '}
          <strong>Repository permissions → Contents: Read and write</strong>. Give it an expiry —
          you can always make another.
        </div>

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'checking' || !owner || !repo || !token}
          className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-white transition hover:bg-sky-700 disabled:opacity-40"
        >
          {status === 'checking' ? 'Checking…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-[--color-line] bg-[--color-surface] px-3 py-2 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
      />
    </label>
  );
}
