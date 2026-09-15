import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { columnCards, type Board, type LoadedCard, type MoveCardInput, type Workspace } from '@kanban/core';
import Fuse from 'fuse.js';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CardTile, SortableCardTile } from './CardTile.js';
import { ColumnComposer } from './ColumnComposer.js';

export interface Filters {
  query: string;
  label: string | null;
  priority: string | null;
}

export interface BoardActions {
  move: (card: LoadedCard, input: MoveCardInput) => void;
  create: (columnId: string, title: string) => void;
}

interface ColumnLayout {
  id: string;
  name: string;
  wipLimit?: number | undefined;
  /** Cards passing the filters — what is on screen, and what a move is measured against. */
  cards: LoadedCard[];
  total: number;
}

const DROPPABLE = 'column:';

/**
 * A column is a droppable wrapped around its cards, so a centre-distance test will sometimes pick
 * the column when the pointer is plainly on a card — turning "drop it here" into "put it at the
 * bottom". Prefer whatever card the pointer is actually inside; fall back to the column, which is
 * what makes an empty column a valid target.
 */
const preferCards: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  const hits = within.length > 0 ? within : rectIntersection(args);
  const card = hits.find((hit) => !String(hit.id).startsWith(DROPPABLE));
  return card ? [card] : hits;
};

export function BoardView({
  workspace,
  board,
  filters,
  actions,
  onOpenCard,
}: {
  workspace: Workspace;
  board: Board;
  filters: Filters;
  actions: BoardActions;
  onOpenCard: (id: string) => void;
}): React.ReactElement {
  const matches = useMatchingIds(workspace, board, filters);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const refocus = useRef<string | null>(null);

  const layout = useMemo<ColumnLayout[]>(
    () =>
      board.columns.map((column) => {
        const all = columnCards(workspace, board.id, column.id);
        return {
          id: column.id,
          name: column.name,
          wipLimit: column.wipLimit,
          cards: matches === null ? all : all.filter((c) => matches.has(c.id)),
          total: all.length,
        };
      }),
    [workspace, board, matches],
  );

  const byId = useMemo(
    () => new Map(layout.flatMap((c) => c.cards.map((card) => [card.id, card] as const))),
    [layout],
  );

  // A keyboard move re-renders the card into a new place, which drops focus. Put it back, so a
  // run of Shift+Arrow presses walks a card across the board the way holding a key should.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)?.focus();
  });

  const sensors = useSensors(
    // A few pixels of slop, so a tap on a card still opens it instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null);
      const { active, over } = event;
      if (!over) return;
      const card = byId.get(String(active.id));
      if (!card) return;
      const overId = String(over.id);

      if (overId.startsWith(DROPPABLE)) {
        const columnId = overId.slice(DROPPABLE.length);
        const target = layout.find((c) => c.id === columnId);
        const last = target?.cards.at(-1);
        if (last === undefined) {
          if (columnId !== card.column) actions.move(card, { column: columnId });
          return;
        }
        if (last.id === card.id) return;
        actions.move(card, { column: columnId, after: last.id });
        return;
      }

      const overCard = byId.get(overId);
      if (!overCard || overCard.id === card.id) return;

      // Which side of the target it landed on: compare the dragged card's centre with the
      // target's. dnd-kit hands us both rects, so no guessing from the drag direction.
      const dragged = active.rect.current.translated;
      const below =
        dragged !== null && dragged !== undefined
          ? dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2
          : false;

      actions.move(card, {
        column: overCard.column,
        ...(below ? { after: overCard.id } : { before: overCard.id }),
      });
    },
    [actions, byId, layout],
  );

  const keyboardMove = useCallback(
    (card: LoadedCard, direction: 'up' | 'down' | 'left' | 'right') => {
      const columnIndex = layout.findIndex((c) => c.id === card.column);
      const column = layout[columnIndex];
      if (!column) return;
      const index = column.cards.findIndex((c) => c.id === card.id);

      if (direction === 'up' || direction === 'down') {
        const neighbour = column.cards[direction === 'up' ? index - 1 : index + 1];
        if (!neighbour) return;
        actions.move(card, direction === 'up' ? { before: neighbour.id } : { after: neighbour.id });
        setAnnouncement(
          `${card.title} moved ${direction} in ${column.name}, position ${
            direction === 'up' ? index : index + 2
          } of ${column.cards.length}`,
        );
      } else {
        const target = layout[columnIndex + (direction === 'left' ? -1 : 1)];
        if (!target) return;
        // Keep it at roughly the same height in the new column rather than dumping it at the end.
        const at = target.cards[Math.min(index, target.cards.length - 1)];
        const input: MoveCardInput =
          at === undefined
            ? { column: target.id }
            : index >= target.cards.length
              ? { column: target.id, after: at.id }
              : { column: target.id, before: at.id };
        actions.move(card, input);
        setAnnouncement(`${card.title} moved to ${target.name}`);
      }
      refocus.current = card.id;
    },
    [actions, layout],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const DIRECTIONS = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      } as const;
      const direction = DIRECTIONS[event.key as keyof typeof DIRECTIONS];
      if (direction === undefined) return;

      const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-card-id]');
      const id = tile?.dataset['cardId'];
      if (id === undefined) return;
      const card = byId.get(id);
      if (!card) return;

      event.preventDefault();
      if (event.shiftKey) {
        keyboardMove(card, direction);
      } else {
        const next = neighbourOf(layout, card, direction);
        if (next) {
          refocus.current = next;
          document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(next)}"]`)?.focus();
        }
      }
    },
    [byId, keyboardMove, layout],
  );

  const activeCard = dragging === null ? undefined : byId.get(dragging);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={preferCards}
      onDragStart={(event: DragStartEvent) => setDragging(String(event.active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- delegated from the card buttons */}
      <div className="flex h-full gap-4 overflow-x-auto px-4 pb-6 sm:px-6" onKeyDown={onKeyDown}>
        {layout.map((column) => (
          <ColumnPanel
            key={column.id}
            column={column}
            board={board}
            filtered={matches !== null}
            onOpenCard={onOpenCard}
            onCreate={(title) => actions.create(column.id, title)}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeCard ? <CardTile card={activeCard} board={board} onOpen={() => {}} dragging /> : null}
      </DragOverlay>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </DndContext>
  );
}

function ColumnPanel({
  column,
  board,
  filtered,
  onOpenCard,
  onCreate,
}: {
  column: ColumnLayout;
  board: Board;
  filtered: boolean;
  onOpenCard: (id: string) => void;
  onCreate: (title: string) => void;
}): React.ReactElement {
  const { isOver, setNodeRef } = useDroppable({ id: `${DROPPABLE}${column.id}` });
  const overLimit = column.wipLimit !== undefined && column.total > column.wipLimit;

  return (
    <section className="flex w-[17rem] shrink-0 flex-col sm:w-80" aria-label={column.name}>
      <header className="sticky top-0 flex items-baseline gap-2 bg-[--color-sunken] py-2">
        <h2 className="text-sm font-semibold">{column.name}</h2>
        <span
          className={`text-xs ${overLimit ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-[--color-muted]'}`}
          title={overLimit ? `Over the WIP limit of ${column.wipLimit}` : undefined}
        >
          {filtered ? `${column.cards.length} of ${column.total}` : column.total}
          {column.wipLimit !== undefined && ` / ${column.wipLimit}`}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-2 rounded-lg transition ${
          isOver ? 'bg-sky-500/10 ring-1 ring-sky-400/60' : ''
        }`}
      >
        <SortableContext items={column.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {column.cards.map((card) => (
            <SortableCardTile
              key={card.id}
              card={card}
              board={board}
              onOpen={() => onOpenCard(card.id)}
            />
          ))}
        </SortableContext>

        {column.cards.length === 0 && (
          <p className="rounded-lg border border-dashed border-[--color-line] px-3 py-6 text-center text-xs text-[--color-muted]">
            {column.total === 0 ? 'Nothing here' : 'Nothing matches'}
          </p>
        )}

        <ColumnComposer columnName={column.name} onCreate={onCreate} />
      </div>
    </section>
  );
}

/** The card an arrow key should move focus to. Left/right keep the row, clamped to what is there. */
function neighbourOf(
  layout: ColumnLayout[],
  card: LoadedCard,
  direction: 'up' | 'down' | 'left' | 'right',
): string | undefined {
  const columnIndex = layout.findIndex((c) => c.id === card.column);
  const column = layout[columnIndex];
  if (!column) return undefined;
  const index = column.cards.findIndex((c) => c.id === card.id);

  if (direction === 'up' || direction === 'down') {
    return column.cards[direction === 'up' ? index - 1 : index + 1]?.id;
  }
  for (
    let i = columnIndex + (direction === 'left' ? -1 : 1);
    i >= 0 && i < layout.length;
    i += direction === 'left' ? -1 : 1
  ) {
    const cards = layout[i]?.cards ?? [];
    if (cards.length > 0) return cards[Math.min(index, cards.length - 1)]?.id;
  }
  return undefined;
}

/** Ids passing the current filters, or null when no filter is active (so nothing is hidden). */
function useMatchingIds(workspace: Workspace, board: Board, filters: Filters): Set<string> | null {
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
