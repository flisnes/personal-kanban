import { columnCards, type Board, type LoadedCard, type Workspace } from '@kanban/core';
import { shortId } from './store.js';

/**
 * Rendering for a model reader, not a human one. The governing constraint is token economy:
 * surveying a board should cost a few hundred tokens, so listings carry metadata only and bodies
 * are fetched one card at a time.
 */

export function ageDays(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000));
}

/** "today" / "3d ago" — reads as a phrase on its own, so callers do not append "ago". */
const age = (iso: string, now: Date): string => {
  const days = ageDays(iso, now);
  return days === 0 ? 'today' : `${days}d ago`;
};

/** One line per card: `pe0004  P0 [M] Title  #label` */
export function cardLine(card: LoadedCard, ws?: Workspace): string {
  const head = [card.priority, card.estimate ? `[${card.estimate}]` : '', card.title]
    .filter(Boolean)
    .join(' ');

  const tail: string[] = [];
  if (card.labels.length > 0) tail.push(card.labels.map((l) => `#${l}`).join(' '));
  if (card.blockedBy.length > 0) {
    const names = ws
      ? card.blockedBy.map((id) => ws.cards.find((c) => c.id === id)?.title ?? id)
      : card.blockedBy;
    tail.push(`(blocked by ${names.join(', ')})`);
  }

  return `  ${shortId(card.id)}  ${head}${tail.length > 0 ? `  ${tail.join('  ')}` : ''}`;
}

function columnHeading(board: Board, columnId: string, count: number): string {
  const column = board.columns.find((c) => c.id === columnId);
  const name = column?.name ?? columnId;
  if (column?.wipLimit === undefined) return `${name} (${count})`;
  const over = count > column.wipLimit ? '  !! over WIP limit' : '';
  return `${name} (${count}/${column.wipLimit})${over}`;
}

export function renderBoard(
  ws: Workspace,
  board: Board,
  filter?: { column?: string | undefined; label?: string | undefined },
): string {
  const lines: string[] = [];
  const total = ws.cards.filter((c) => c.boardId === board.id).length;
  lines.push(`${board.name}  (board: ${board.id})`, `${total} cards`, '');

  const columns = filter?.column
    ? board.columns.filter((c) => c.id === filter.column)
    : board.columns;

  for (const column of columns) {
    let cards = columnCards(ws, board.id, column.id);
    if (filter?.label) cards = cards.filter((c) => c.labels.includes(filter.label as string));
    lines.push(columnHeading(board, column.id, cards.length));
    if (cards.length === 0) lines.push('  (empty)');
    else for (const card of cards) lines.push(cardLine(card, ws));
    lines.push('');
  }

  const issues = ws.issues.filter((i) => i.path.includes(`/${board.id}/`));
  if (issues.length > 0) {
    lines.push(`${issues.length} file(s) need attention:`);
    for (const issue of issues) lines.push(`  ${issue.path}: ${issue.message}`);
  }

  return lines.join('\n').trimEnd();
}

export function renderCard(card: LoadedCard, now: Date): string {
  const meta = [
    `board: ${card.boardId}`,
    `column: ${card.column}`,
    `id: ${card.id} (${shortId(card.id)})`,
  ];
  const attrs = [`priority: ${card.priority}`];
  if (card.estimate) attrs.push(`estimate: ${card.estimate}`);
  if (card.labels.length > 0) attrs.push(`labels: ${card.labels.join(', ')}`);
  if (card.blockedBy.length > 0) attrs.push(`blocked by: ${card.blockedBy.join(', ')}`);

  const lines = [
    card.title,
    meta.join(' · '),
    attrs.join(' · '),
    `created ${age(card.created, now)} · updated ${age(card.updated, now)}`,
    `file: ${card.path}`,
  ];
  if (card.links.length > 0) lines.push(`links: ${card.links.join(' ')}`);
  lines.push('', '---', '', card.body.length > 0 ? card.body : '(no body)');
  return lines.join('\n');
}

export function renderBoardList(ws: Workspace): string {
  if (ws.boards.length === 0) return 'No boards yet.';
  const lines = ['Boards:'];
  for (const board of ws.boards) {
    const cards = ws.cards.filter((c) => c.boardId === board.id);
    const open = cards.filter((c) => c.column !== 'done').length;
    lines.push(`  ${board.id}  —  ${board.name}  (${cards.length} cards, ${open} not done)`);
    for (const path of board.projectPaths) lines.push(`      ${path}`);
  }
  return lines.join('\n');
}

export function renderStats(ws: Workspace, board: Board, now: Date): string {
  const cards = ws.cards.filter((c) => c.boardId === board.id);
  const lines = [`${board.name} (${board.id}) — ${cards.length} cards`, ''];

  lines.push(
    board.columns
      .map((c) => {
        const n = columnCards(ws, board.id, c.id).length;
        return c.wipLimit === undefined ? `${c.name} ${n}` : `${c.name} ${n}/${c.wipLimit}`;
      })
      .join(' · '),
  );

  const tally = (values: string[]): string =>
    [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');

  lines.push(`priorities: ${tally(cards.map((c) => c.priority))}`);
  const labels = tally(cards.flatMap((c) => c.labels));
  if (labels) lines.push(`labels: ${labels}`);

  const overLimit = board.columns.filter(
    (c) => c.wipLimit !== undefined && columnCards(ws, board.id, c.id).length > c.wipLimit,
  );
  if (overLimit.length > 0) {
    lines.push('', `over WIP limit: ${overLimit.map((c) => c.name).join(', ')}`);
  }

  const blocked = cards.filter((c) => c.blockedBy.length > 0);
  if (blocked.length > 0) lines.push(`blocked: ${blocked.length}`);

  const untouched = [...cards]
    .filter((c) => c.column !== 'done')
    .sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated))
    .slice(0, 3);
  if (untouched.length > 0) {
    lines.push('', 'least recently touched:');
    for (const c of untouched) {
      lines.push(`  ${shortId(c.id)}  ${c.title}  (${age(c.updated, now)})`);
    }
  }

  return lines.join('\n');
}
