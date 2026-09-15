import type { Board, LoadedCard } from '@kanban/core';

const PRIORITY_STYLE: Record<string, string> = {
  P0: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  P1: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  P2: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  P3: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export function CardTile({
  card,
  board,
  onOpen,
}: {
  card: LoadedCard;
  board: Board;
  onOpen: () => void;
}): React.ReactElement {
  const colours = new Map(board.labels.map((l) => [l.id, l.color]));
  const checklist = countChecklist(card.body);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-[--color-line] bg-[--color-surface] p-3 text-left transition hover:border-sky-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
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
