import { columnCards, type Board, type LoadedCard, type Workspace } from '@kanban/core';
import Fuse from 'fuse.js';
import { useMemo } from 'react';
import { CardTile } from './CardTile.js';

export interface Filters {
  query: string;
  label: string | null;
  priority: string | null;
}

export function BoardView({
  workspace,
  board,
  filters,
  onOpenCard,
}: {
  workspace: Workspace;
  board: Board;
  filters: Filters;
  onOpenCard: (id: string) => void;
}): React.ReactElement {
  const matches = useMatchingIds(workspace, board, filters);

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-4 pb-6 sm:px-6">
      {board.columns.map((column) => {
        const all = columnCards(workspace, board.id, column.id);
        const cards = matches === null ? all : all.filter((c) => matches.has(c.id));
        const overLimit = column.wipLimit !== undefined && all.length > column.wipLimit;

        return (
          <section
            key={column.id}
            className="flex w-[17rem] shrink-0 flex-col sm:w-80"
            aria-label={column.name}
          >
            <header className="sticky top-0 flex items-baseline gap-2 bg-[--color-sunken] py-2">
              <h2 className="text-sm font-semibold">{column.name}</h2>
              <span
                className={`text-xs ${overLimit ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-[--color-muted]'}`}
                title={overLimit ? `Over the WIP limit of ${column.wipLimit}` : undefined}
              >
                {matches === null ? all.length : `${cards.length} of ${all.length}`}
                {column.wipLimit !== undefined && ` / ${column.wipLimit}`}
              </span>
            </header>

            <div className="flex flex-col gap-2">
              {cards.map((card) => (
                <CardTile key={card.id} card={card} board={board} onOpen={() => onOpenCard(card.id)} />
              ))}
              {cards.length === 0 && (
                <p className="rounded-lg border border-dashed border-[--color-line] px-3 py-6 text-center text-xs text-[--color-muted]">
                  {all.length === 0 ? 'Nothing here' : 'Nothing matches'}
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Ids passing the current filters, or null when no filter is active (so nothing is hidden). */
function useMatchingIds(
  workspace: Workspace,
  board: Board,
  filters: Filters,
): Set<string> | null {
  const cards = useMemo(
    () => workspace.cards.filter((c) => c.boardId === board.id),
    [workspace, board.id],
  );

  // Fuzzy, because you rarely remember a card's exact wording — only roughly what it was about.
  const fuse = useMemo(
    () =>
      new Fuse(cards, {
        keys: [
          { name: 'title', weight: 3 },
          { name: 'labels', weight: 2 },
          { name: 'body', weight: 1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [cards],
  );

  return useMemo(() => {
    const query = filters.query.trim();
    if (!query && !filters.label && !filters.priority) return null;

    let pool: LoadedCard[] = cards;
    if (filters.label) pool = pool.filter((c) => c.labels.includes(filters.label as string));
    if (filters.priority) pool = pool.filter((c) => c.priority === filters.priority);

    if (query) {
      const allowed = new Set(pool.map((c) => c.id));
      return new Set(
        fuse
          .search(query)
          .map((r) => r.item.id)
          .filter((id) => allowed.has(id)),
      );
    }
    return new Set(pool.map((c) => c.id));
  }, [cards, fuse, filters.query, filters.label, filters.priority]);
}
