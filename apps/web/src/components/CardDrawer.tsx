import {
  ESTIMATES,
  PRIORITIES,
  type Board,
  type Estimate,
  type LoadedCard,
  type MoveCardInput,
  type Priority,
  type UpdateCardPatch,
} from '@kanban/core';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const MarkdownBody = lazy(() => import('./MarkdownBody.js'));

export interface CardEditor {
  update: (patch: UpdateCardPatch) => void;
  move: (input: MoveCardInput) => void;
  archive: () => void;
}

export function CardDrawer({
  card,
  board,
  cards,
  editor,
  onClose,
  onOpenCard,
}: {
  card: LoadedCard;
  board: Board;
  cards: LoadedCard[];
  editor: CardEditor;
  onClose: () => void;
  onOpenCard: (id: string) => void;
}): React.ReactElement {
  const [editingTitle, setEditingTitle] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const bodyEditor = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Escape belongs to whatever is being edited first; only a quiet drawer closes on it.
      if (e.key === 'Escape' && draft === null && !editingTitle) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, draft, editingTitle]);

  useEffect(() => {
    if (draft !== null) bodyEditor.current?.focus();
  }, [draft]);

  const column = board.columns.find((c) => c.id === card.column);
  const blockers = card.blockedBy.map((id) => ({ id, card: cards.find((c) => c.id === id) }));
  const knownLabels = [...new Set([...board.labels.map((l) => l.id), ...card.labels])];

  function toggleLabel(label: string): void {
    editor.update({
      labels: card.labels.includes(label)
        ? card.labels.filter((l) => l !== label)
        : [...card.labels, label],
    });
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} role="presentation" aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={card.title}
        className="relative flex h-dvh w-full max-w-xl flex-col overflow-y-auto border-l border-[--color-line] bg-[--color-surface] shadow-2xl"
      >
        <header className="sticky top-0 z-10 border-b border-[--color-line] bg-[--color-surface]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start gap-3">
            {editingTitle ? (
              <TitleEditor
                initial={card.title}
                onDone={(title) => {
                  if (title.length > 0 && title !== card.title) editor.update({ title });
                  setEditingTitle(false);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                title="Rename"
                className="flex-1 rounded px-1 py-0.5 text-left text-lg leading-snug font-semibold hover:bg-[--color-sunken]"
              >
                {card.title}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg px-2 py-1 text-xl leading-none text-[--color-muted] hover:bg-[--color-sunken]"
            >
              ×
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Select
              label="Column"
              value={card.column}
              options={board.columns.map((c) => [c.id, c.name])}
              onChange={(columnId) => editor.move({ column: columnId })}
            />
            <Select
              label="Priority"
              value={card.priority}
              options={PRIORITIES.map((p) => [p, p])}
              onChange={(priority) => editor.update({ priority: priority as Priority })}
            />
            <Select
              label="Estimate"
              value={card.estimate ?? ''}
              options={[['', '—'], ...ESTIMATES.map((e) => [e, e] as [string, string])]}
              onChange={(estimate) =>
                editor.update({ estimate: estimate === '' ? null : (estimate as Estimate) })
              }
            />
          </div>
        </header>

        <div className="flex-1 px-5 py-5">
          <section aria-label="Labels" className="mb-5 flex flex-wrap items-center gap-1.5">
            {knownLabels.map((label) => {
              const on = card.labels.includes(label);
              const colour = board.labels.find((l) => l.id === label)?.color ?? '#a3a3a3';
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleLabel(label)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ring-1 transition ${
                    on
                      ? 'bg-[--color-sunken] font-medium ring-sky-400'
                      : 'text-[--color-muted] ring-[--color-line] hover:ring-sky-300'
                  }`}
                >
                  <span aria-hidden className="size-2 rounded-full" style={{ background: colour }} />
                  {label}
                </button>
              );
            })}
            <LabelAdder
              onAdd={(label) => {
                if (!card.labels.includes(label)) editor.update({ labels: [...card.labels, label] });
              }}
            />
          </section>

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

          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide text-[--color-muted] uppercase">
              Description
            </h3>
            {draft === null && (
              <button
                type="button"
                onClick={() => setDraft(card.body)}
                className="rounded px-2 py-1 text-xs text-sky-600 hover:bg-[--color-sunken] dark:text-sky-400"
              >
                Edit
              </button>
            )}
          </div>

          {draft === null ? (
            card.body.trim() ? (
              <Suspense fallback={<p className="text-sm text-[--color-muted]">Rendering…</p>}>
                <MarkdownBody>{card.body}</MarkdownBody>
              </Suspense>
            ) : (
              <p className="text-sm text-[--color-muted]">No description yet.</p>
            )
          ) : (
            <div>
              <textarea
                ref={bodyEditor}
                value={draft}
                aria-label="Description"
                rows={16}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setDraft(null);
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    if (draft !== card.body) editor.update({ body: draft });
                    setDraft(null);
                  }
                }}
                className="w-full rounded-lg border border-[--color-line] bg-[--color-sunken] p-3 font-mono text-[13px] leading-relaxed outline-none focus:border-sky-500"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (draft !== card.body) editor.update({ body: draft });
                    setDraft(null);
                  }}
                  className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-lg px-3 py-1.5 text-sm text-[--color-muted] hover:bg-[--color-sunken]"
                >
                  Cancel
                </button>
                <span className="ml-auto text-[10px] text-[--color-muted]">Ctrl+Enter saves</span>
              </div>
            </div>
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
          <div className="mb-2 flex items-center gap-2">
            {confirmArchive ? (
              <>
                <span className="text-xs">Move to the archive?</span>
                <button
                  type="button"
                  onClick={() => {
                    editor.archive();
                    onClose();
                  }}
                  className="rounded-lg bg-amber-600 px-2.5 py-1 text-xs font-medium text-white"
                >
                  Archive
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmArchive(false)}
                  className="rounded-lg px-2 py-1 text-xs hover:bg-[--color-sunken]"
                >
                  Keep
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="rounded-lg border border-[--color-line] px-2.5 py-1 text-xs hover:bg-[--color-sunken]"
              >
                Archive card
              </button>
            )}
            <span className="ml-auto">{column?.name ?? card.column}</span>
          </div>
          <p className="break-all">{card.path}</p>
          <p className="mt-1">
            created {formatDate(card.created)} · updated {formatDate(card.updated)}
          </p>
        </footer>
      </aside>
    </div>
  );
}

function TitleEditor({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (title: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <input
      value={value}
      autoFocus
      aria-label="Title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim());
        if (e.key === 'Escape') onDone(initial);
      }}
      className="flex-1 rounded border border-sky-500 bg-[--color-sunken] px-1 py-0.5 text-lg leading-snug font-semibold outline-none"
    />
  );
}

function LabelAdder({ onAdd }: { onAdd: (label: string) => void }): React.ReactElement {
  const [value, setValue] = useState<string | null>(null);
  if (value === null) {
    return (
      <button
        type="button"
        onClick={() => setValue('')}
        className="rounded px-2 py-1 text-xs text-[--color-muted] ring-1 ring-dashed ring-[--color-line] hover:text-[--color-fg]"
      >
        + label
      </button>
    );
  }
  return (
    <input
      value={value}
      autoFocus
      aria-label="New label"
      placeholder="label"
      onChange={(e) => setValue(e.target.value.trim().toLowerCase())}
      onBlur={() => setValue(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value.length > 0) {
          onAdd(value);
          setValue(null);
        }
        if (e.key === 'Escape') setValue(null);
      }}
      className="w-24 rounded border border-sky-400 bg-[--color-sunken] px-2 py-1 text-xs outline-none"
    />
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-[--color-muted]">
      {label}
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-[--color-line] bg-[--color-surface] px-2 py-1 text-xs text-[--color-fg]"
      >
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
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
