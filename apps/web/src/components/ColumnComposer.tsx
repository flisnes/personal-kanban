import { useEffect, useRef, useState } from 'react';

/**
 * Add a card without leaving the board. Title only — everything else has a sensible default and
 * is one click away in the drawer, and a capture box that asks for six fields does not get used.
 */
export function ColumnComposer({
  columnName,
  onCreate,
}: {
  columnName: string;
  onCreate: (title: string) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function submit(): void {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    onCreate(trimmed);
    setTitle('');
    // Stay open: adding cards comes in bursts.
    input.current?.focus();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-[--color-line] px-3 py-2 text-left text-xs text-[--color-muted] transition hover:border-sky-400 hover:text-[--color-fg]"
      >
        + Add a card
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-sky-400 bg-[--color-surface] p-2">
      <textarea
        ref={input}
        value={title}
        rows={2}
        aria-label={`New card in ${columnName}`}
        placeholder="What needs doing?"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            setTitle('');
            setOpen(false);
          }
        }}
        className="w-full resize-none rounded border-none bg-transparent text-sm outline-none"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={title.trim().length === 0}
          className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            setTitle('');
            setOpen(false);
          }}
          className="rounded px-2 py-1 text-xs text-[--color-muted] hover:bg-[--color-sunken]"
        >
          Cancel
        </button>
        <span className="ml-auto text-[10px] text-[--color-muted]">Enter to add</span>
      </div>
    </div>
  );
}
