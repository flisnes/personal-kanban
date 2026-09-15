import { PRIORITIES, type Board } from '@kanban/core';
import type { BoardSnapshot } from '../lib/boardStore.js';
import type { Filters } from './BoardView.js';
import { SyncStatus } from './SyncStatus.js';

export function Toolbar({
  boards,
  board,
  filters,
  onFilters,
  onSelectBoard,
  onRefresh,
  onSignOut,
  onRetry,
  onDiscard,
  state,
}: {
  boards: Board[];
  board: Board;
  filters: Filters;
  onFilters: (filters: Filters) => void;
  onSelectBoard: (id: string) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  state: BoardSnapshot;
}): React.ReactElement {
  const active = filters.query || filters.label || filters.priority;

  return (
    <header className="border-b border-[--color-line] bg-[--color-surface]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
        <select
          value={board.id}
          onChange={(e) => onSelectBoard(e.target.value)}
          aria-label="Board"
          className="rounded-lg border border-[--color-line] bg-[--color-surface] px-2.5 py-1.5 text-sm font-medium"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <input
          type="search"
          value={filters.query}
          onChange={(e) => onFilters({ ...filters, query: e.target.value })}
          placeholder="Search cards…"
          className="min-w-0 flex-1 rounded-lg border border-[--color-line] bg-[--color-surface] px-3 py-1.5 text-sm outline-none focus:border-sky-500"
        />

        <select
          value={filters.label ?? ''}
          onChange={(e) => onFilters({ ...filters, label: e.target.value || null })}
          aria-label="Filter by label"
          className="rounded-lg border border-[--color-line] bg-[--color-surface] px-2.5 py-1.5 text-sm"
        >
          <option value="">All labels</option>
          {board.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id}
            </option>
          ))}
        </select>

        <select
          value={filters.priority ?? ''}
          onChange={(e) => onFilters({ ...filters, priority: e.target.value || null })}
          aria-label="Filter by priority"
          className="rounded-lg border border-[--color-line] bg-[--color-surface] px-2.5 py-1.5 text-sm"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        {active && (
          <button
            type="button"
            onClick={() => onFilters({ query: '', label: null, priority: null })}
            className="rounded-lg px-2.5 py-1.5 text-sm text-[--color-muted] hover:bg-[--color-sunken]"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <SyncStatus state={state} onRetry={onRetry} onDiscard={onDiscard} />
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-[--color-line] px-2.5 py-1.5 text-sm hover:bg-[--color-sunken]"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onSignOut}
            title="Forget the token stored in this browser"
            className="rounded-lg px-2.5 py-1.5 text-sm text-[--color-muted] hover:bg-[--color-sunken]"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
