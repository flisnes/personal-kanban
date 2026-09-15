import type { BoardSnapshot } from '../lib/boardStore.js';

/**
 * Writes never block the board, so this is the only place the network is visible. It has to be
 * honest about the one state that matters: a change that is on screen but not yet on GitHub.
 */
export function SyncStatus({
  state,
  onRetry,
  onDiscard,
}: {
  state: BoardSnapshot;
  onRetry: () => void;
  onDiscard: () => void;
}): React.ReactElement | null {
  const { sync, pending, syncError } = state;

  if (sync === 'failed') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-red-600 dark:text-red-400" title={syncError ?? undefined}>
          {pending} unsaved
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-[--color-line] px-2 py-1 hover:bg-[--color-sunken]"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onDiscard}
          title={syncError ?? 'Throw away the changes that could not be saved'}
          className="rounded px-2 py-1 text-[--color-muted] hover:bg-[--color-sunken]"
        >
          Discard
        </button>
      </div>
    );
  }

  if (sync === 'syncing' || sync === 'retrying') {
    return (
      <span className="text-xs text-[--color-muted]">
        {sync === 'retrying' ? 'Board changed elsewhere — reapplying…' : 'Saving…'}
        {pending > 1 && ` (${pending})`}
      </span>
    );
  }

  // A dropped intent is worth reporting even once everything else is saved.
  if (syncError !== null) {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-400" title={syncError}>
        {syncError.length > 48 ? `${syncError.slice(0, 48)}…` : syncError}
      </span>
    );
  }

  return <span className="text-xs text-[--color-muted]">Saved</span>;
}
