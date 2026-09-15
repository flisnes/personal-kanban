import { ulid } from 'ulid';
import { appendNote, serializeCard } from './card.js';
import { archiveCardPath, cardFileName, cardPath } from './paths.js';
import { isValidRank, rankAtIndex, ranksBetween, sortByRank } from './rank.js';
import type { Card, Estimate, LoadedCard, Priority } from './schema.js';
import { boardCards, columnCards, getBoard, getCard, type Workspace } from './workspace.js';

export class KanbanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KanbanError';
  }
}

export type FileChange =
  | { kind: 'write'; path: string; content: string }
  | { kind: 'delete'; path: string };

/**
 * Replay a change set over an in-memory file map. The browser uses this to show a write before it
 * has been committed: apply, reparse, and the optimistic board is byte-identical to the one the
 * commit will produce. (The filesystem equivalent lives in `node.ts`.)
 */
export function applyChangesToFiles(
  files: ReadonlyMap<string, string>,
  changes: readonly FileChange[],
): Map<string, string> {
  const next = new Map(files);
  for (const change of changes) {
    if (change.kind === 'delete') next.delete(change.path);
    else next.set(change.path, change.content);
  }
  return next;
}

export interface OpResult {
  changes: FileChange[];
  /** Commit message. Produced here so the web app and the MCP server write identical history. */
  message: string;
}

export interface CardOpResult extends OpResult {
  card: LoadedCard;
}

/** Where to drop a card within its column. `before`/`after` take card ids. */
export interface Placement {
  before?: string;
  after?: string;
  position?: 'top' | 'bottom';
  index?: number;
}

export interface CreateCardInput {
  boardId: string;
  title: string;
  body?: string;
  column?: string;
  priority?: Priority;
  labels?: string[];
  estimate?: Estimate;
  links?: string[];
  blockedBy?: string[];
  placement?: Placement;
  /** Injectable for tests and for replaying an optimistic write. */
  id?: string;
  now?: Date;
}

export interface UpdateCardPatch {
  title?: string;
  body?: string;
  priority?: Priority;
  labels?: string[];
  estimate?: Estimate | null;
  links?: string[];
  blockedBy?: string[];
}

export function createCard(ws: Workspace, input: CreateCardInput): CardOpResult {
  const board = requireBoard(ws, input.boardId);
  const columnId = input.column ?? board.columns[0]?.id;
  if (columnId === undefined) throw new KanbanError(`board "${board.id}" has no columns`);
  requireColumn(ws, input.boardId, columnId);

  const now = input.now ?? new Date();
  const iso = now.toISOString();
  const id = input.id ?? ulid(now.getTime());
  const siblings = columnCards(ws, input.boardId, columnId);

  const card: Card = {
    id,
    title: input.title.trim(),
    column: columnId,
    rank: placementRank(siblings, input.placement ?? { position: 'bottom' }),
    priority: input.priority ?? 'P2',
    labels: input.labels ?? [],
    ...(input.estimate !== undefined ? { estimate: input.estimate } : {}),
    created: iso,
    updated: iso,
    blockedBy: input.blockedBy ?? [],
    links: input.links ?? [],
    body: input.body?.trim() ?? '',
  };

  const loaded: LoadedCard = {
    ...card,
    boardId: input.boardId,
    path: cardPath(input.boardId, cardFileName(card.title, card.id)),
  };

  return {
    card: loaded,
    changes: [{ kind: 'write', path: loaded.path, content: serializeCard(card) }],
    message: `kanban(${input.boardId}): add "${card.title}"`,
  };
}

export function updateCard(
  ws: Workspace,
  cardId: string,
  patch: UpdateCardPatch,
  now = new Date(),
): CardOpResult {
  const current = requireCard(ws, cardId);
  const next: LoadedCard = {
    ...current,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.labels !== undefined ? { labels: patch.labels } : {}),
    ...(patch.links !== undefined ? { links: patch.links } : {}),
    ...(patch.blockedBy !== undefined ? { blockedBy: patch.blockedBy } : {}),
    updated: now.toISOString(),
  };
  if (patch.estimate === null) delete next.estimate;
  else if (patch.estimate !== undefined) next.estimate = patch.estimate;

  // The filename is cosmetic; renaming on every title edit would churn git history for nothing.
  return {
    card: next,
    changes: [{ kind: 'write', path: next.path, content: serializeCard(next) }],
    message: `kanban(${next.boardId}): update "${next.title}"`,
  };
}

export interface MoveCardInput extends Placement {
  column?: string;
}

export function moveCard(
  ws: Workspace,
  cardId: string,
  input: MoveCardInput,
  now = new Date(),
): CardOpResult {
  const current = requireCard(ws, cardId);
  const columnId = input.column ?? current.column;
  requireColumn(ws, current.boardId, columnId);

  const siblings = columnCards(ws, current.boardId, columnId);
  const placement: Placement =
    input.before !== undefined || input.after !== undefined || input.index !== undefined
      ? input
      : { position: input.position ?? 'bottom' };

  const next: LoadedCard = {
    ...current,
    column: columnId,
    rank: placementRank(siblings, placement, cardId),
    updated: now.toISOString(),
  };

  const moved = columnId !== current.column;
  return {
    card: next,
    changes: [{ kind: 'write', path: next.path, content: serializeCard(next) }],
    message: moved
      ? `kanban(${next.boardId}): move "${next.title}" to ${columnId}`
      : `kanban(${next.boardId}): reposition "${next.title}" in ${columnId}`,
  };
}

/**
 * Apply an explicit order to a whole column. Unlike a single move this may rewrite several files
 * — it is the "here is my new priority order" operation — but only cards whose rank actually
 * changes are written.
 */
export function reorderColumn(
  ws: Workspace,
  boardId: string,
  columnId: string,
  orderedIds: readonly string[],
  now = new Date(),
): OpResult {
  requireColumn(ws, boardId, columnId);
  const existing = columnCards(ws, boardId, columnId);
  const byId = new Map(existing.map((c) => [c.id, c]));

  const ordered = orderedIds.map((id) => {
    const card = byId.get(id);
    if (!card) throw new KanbanError(`card ${id} is not in ${boardId}/${columnId}`);
    return card;
  });
  // Anything the caller did not mention keeps its relative order, after the explicit ones.
  const mentioned = new Set(orderedIds);
  const rest = existing.filter((c) => !mentioned.has(c.id));
  const target = [...ordered, ...rest];

  const ranks = ranksBetween(null, null, target.length);
  const changes: FileChange[] = [];
  target.forEach((card, i) => {
    const rank = ranks[i];
    if (rank === undefined || card.rank === rank) return;
    changes.push({
      kind: 'write',
      path: card.path,
      content: serializeCard({ ...card, rank, updated: now.toISOString() }),
    });
  });

  return {
    changes,
    message: `kanban(${boardId}): reorder ${columnId} (${changes.length} card${
      changes.length === 1 ? '' : 's'
    } moved)`,
  };
}

export function archiveCard(ws: Workspace, cardId: string, now = new Date()): CardOpResult {
  const current = requireCard(ws, cardId);
  const fileName = current.path.split('/').at(-1) ?? cardFileName(current.title, current.id);
  const destination = archiveCardPath(current.boardId, fileName);
  const next: LoadedCard = {
    ...current,
    path: destination,
    updated: now.toISOString(),
    extra: { ...current.extra, archivedAt: now.toISOString() },
  };

  return {
    card: next,
    changes: [
      { kind: 'delete', path: current.path },
      { kind: 'write', path: destination, content: serializeCard(next) },
    ],
    message: `kanban(${current.boardId}): archive "${current.title}"`,
  };
}

export function deleteCard(ws: Workspace, cardId: string): OpResult {
  const current = requireCard(ws, cardId);
  return {
    changes: [{ kind: 'delete', path: current.path }],
    message: `kanban(${current.boardId}): delete "${current.title}"`,
  };
}

export function addNote(
  ws: Workspace,
  cardId: string,
  text: string,
  author = 'claude',
  now = new Date(),
): CardOpResult {
  const current = requireCard(ws, cardId);
  const next: LoadedCard = {
    ...current,
    body: appendNote(current.body, text, author, now),
    updated: now.toISOString(),
  };
  return {
    card: next,
    changes: [{ kind: 'write', path: next.path, content: serializeCard(next) }],
    message: `kanban(${next.boardId}): note on "${next.title}"`,
  };
}

/** Cards in `done`-style columns that have sat there past the column's auto-archive window. */
export function staleDoneCards(ws: Workspace, boardId: string, now = new Date()): LoadedCard[] {
  const board = requireBoard(ws, boardId);
  const stale: LoadedCard[] = [];
  for (const column of board.columns) {
    if (column.autoArchiveAfterDays === undefined) continue;
    const cutoff = now.getTime() - column.autoArchiveAfterDays * 86_400_000;
    for (const card of columnCards(ws, boardId, column.id)) {
      if (Date.parse(card.updated) < cutoff) stale.push(card);
    }
  }
  return stale;
}

function placementRank(
  siblings: readonly LoadedCard[],
  placement: Placement,
  excludeId?: string,
): string {
  /*
   * Every placement is measured against the card's *future* neighbours: the column as it will look
   * once the card has left its old slot, minus any card whose rank is too corrupt to measure
   * against. Resolving `before`/`after` against a list that still contained the moving card put it
   * one position too far whenever it travelled downwards — dragging a card down a column is the
   * single most common gesture there is, so this list has to be the same one throughout.
   */
  const neighbours = sortByRank(siblings).filter(
    (c) => c.id !== excludeId && isValidRank(c.rank),
  );
  const at = (index: number): string => rankAtIndex(neighbours, index);

  if (placement.before !== undefined) {
    const index = neighbours.findIndex((c) => c.id === placement.before);
    if (index === -1) throw new KanbanError(`card ${placement.before} is not in that column`);
    return at(index);
  }
  if (placement.after !== undefined) {
    const index = neighbours.findIndex((c) => c.id === placement.after);
    if (index === -1) throw new KanbanError(`card ${placement.after} is not in that column`);
    return at(index + 1);
  }
  if (placement.index !== undefined) return at(placement.index);
  return at(placement.position === 'top' ? 0 : neighbours.length);
}

function requireBoard(ws: Workspace, boardId: string) {
  const board = getBoard(ws, boardId);
  if (!board) {
    const known = ws.boards.map((b) => b.id).join(', ') || '(none)';
    throw new KanbanError(`no board "${boardId}". Known boards: ${known}`);
  }
  return board;
}

function requireColumn(ws: Workspace, boardId: string, columnId: string) {
  const board = requireBoard(ws, boardId);
  const column = board.columns.find((c) => c.id === columnId);
  if (!column) {
    const known = board.columns.map((c) => c.id).join(', ');
    throw new KanbanError(`board "${boardId}" has no column "${columnId}". Columns: ${known}`);
  }
  return column;
}

function requireCard(ws: Workspace, cardId: string): LoadedCard {
  const card = getCard(ws, cardId);
  if (!card) throw new KanbanError(`no card with id "${cardId}"`);
  return card;
}
