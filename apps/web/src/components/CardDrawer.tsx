import type { Board, LoadedCard } from '@kanban/core';
import { lazy, Suspense, useEffect } from 'react';

const MarkdownBody = lazy(() => import('./MarkdownBody.js'));

export function CardDrawer({
  card,
  board,
  cards,
  onClose,
  onOpenCard,
}: {
  card: LoadedCard;
  board: Board;
  cards: LoadedCard[];
  onClose: () => void;
  onOpenCard: (id: string) => void;
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const column = board.columns.find((c) => c.id === card.column);
  const blockers = card.blockedBy.map((id) => ({
    id,
    card: cards.find((c) => c.id === id),
  }));

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        role="presentation"
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={card.title}
        className="relative flex h-dvh w-full max-w-xl flex-col overflow-y-auto border-l border-[--color-line] bg-[--color-surface] shadow-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-[--color-line] bg-[--color-surface]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start gap-3">
            <h2 className="flex-1 text-lg leading-snug font-semibold">{card.title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-xl leading-none text-[--color-muted] hover:bg-[--color-sunken]"
            >
              ×
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[--color-muted]">
            <span>{column?.name ?? card.column}</span>
            <span>{card.priority}</span>
            {card.estimate && <span>estimate {card.estimate}</span>}
            {card.labels.map((l) => (
              <span key={l}>#{l}</span>
            ))}
          </div>
        </header>

        <div className="flex-1 px-5 py-5">
          {blockers.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
              <p className="font-medium text-amber-900 dark:text-amber-200">Blocked by</p>
              <ul className="mt-1 space-y-1">
                {blockers.map((b) => (
                  <li key={b.id}>
                    {b.card ? (
                      <button
                        type="button"
                        onClick={() => onOpenCard(b.id)}
                        className="text-sky-700 underline dark:text-sky-300"
                      >
                        {b.card.title}
                      </button>
                    ) : (
                      <span className="text-[--color-muted]">{b.id} (not found)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {card.body.trim() ? (
            <Suspense fallback={<p className="text-sm text-[--color-muted]">Rendering…</p>}>
              <MarkdownBody>{card.body}</MarkdownBody>
            </Suspense>
          ) : (
            <p className="text-sm text-[--color-muted]">No description yet.</p>
          )}

          {card.links.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold tracking-wide text-[--color-muted] uppercase">Links</h3>
              <ul className="mt-2 space-y-1 text-sm">
                {card.links.map((link) => (
                  <li key={link}>
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-sky-600 underline dark:text-sky-400"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="border-t border-[--color-line] px-5 py-3 text-[11px] text-[--color-muted]">
          <p className="break-all">{card.path}</p>
          <p className="mt-1">
            created {formatDate(card.created)} · updated {formatDate(card.updated)}
          </p>
        </footer>
      </aside>
    </div>
  );
}

function formatDate(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
