import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Board, LoadedCard } from '@kanban/core';

const PRIORITY_STYLE: Record<string, string> = {
  P0: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  P1: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  P2: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  P3: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

/** Read by the board's delegated key handler, and the target it puts focus back on after a move. */
export const MOVE_HINT_ID = 'card-move-hint';

/**
 * The whole tile is the drag handle. With a few pixels of activation slop a tap still opens the
 * card, so there is no separate grab strip to hit — which matters most on a phone, where a 20px
 * handle is the difference between usable and not.
 */
export function SortableCardTile({
  card,
  board,
  onOpen,
}: {
  card: LoadedCard;
  board: Board;
  onOpen: () => void;
}): React.ReactElement {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id: card.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // The original stays in place as a gap while the overlay follows the pointer.
        opacity: isDragging ? 0.35 : undefined,
      }}
    >
      <CardTile card={card} board={board} onOpen={onOpen} listeners={listeners} />
    </div>
  );
}

export function CardTile({
  card,
  board,
  onOpen,
  listeners,
  dragging = false,
}: {
  card: LoadedCard;
  board: Board;
  onOpen: () => void;
  listeners?: Record<string, unknown>;
  /** Rendered inside the drag overlay rather than in a column. */
  dragging?: boolean;
}): React.ReactElement {
  const colours = new Map(board.labels.map((l) => [l.id, l.color]));
  const checklist = countChecklist(card.body);

  return (
    <button
      type="button"
      data-card-id={card.id}
      onClick={onOpen}
      aria-describedby={MOVE_HINT_ID}
      // Without this the browser claims the touch for scrolling and a drag never starts.
      style={{ touchAction: 'none' }}
      {...listeners}
      className={`w-full rounded-lg border bg-[--color-surface] p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-sky-500/40 ${
        dragging
          ? 'rotate-1 cursor-grabbing border-sky-400 shadow-xl'
          : 'cursor-grab border-[--color-line] hover:border-sky-400 focus:border-sky-500'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLE[card.priority] ?? ''}`}>
          {card.priority}
        </span>
        <span className="flex-1 text-sm leading-snug font-medium">{card.title}</span>
      </div>

      {(card.labels.length > 0 || card.estimate || checklist) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-[--color-muted]">
          {card.labels.map((label) => (
            <span key={label} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 ring-1 ring-[--color-line]">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: colours.get(label) ?? '#a3a3a3' }}
              />
              {label}
            </span>
          ))}
          {card.estimate && <span className="rounded px-1.5 py-0.5 ring-1 ring-[--color-line]">{card.estimate}</span>}
          {checklist && (
            <span className={checklist.done === checklist.total ? 'text-emerald-600 dark:text-emerald-400' : ''}>
              {checklist.done}/{checklist.total} done
            </span>
          )}
        </div>
      )}

      {card.blockedBy.length > 0 && (
        <p className="mt-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
          blocked by {card.blockedBy.length} card{card.blockedBy.length === 1 ? '' : 's'}
        </p>
      )}
    </button>
  );
}

/** Acceptance criteria are written as task lists, so their progress is worth surfacing. */
function countChecklist(body: string): { done: number; total: number } | null {
  const items = body.match(/^\s*[-*]\s+\[[ xX]\]/gm);
  if (!items || items.length === 0) return null;
  return {
    done: items.filter((i) => /\[[xX]\]/.test(i)).length,
    total: items.length,
  };
}
