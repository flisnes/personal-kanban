import {
  ESTIMATES,
  KanbanError,
  PRIORITIES,
  addNote,
  archiveCard,
  columnCards,
  createCard,
  deleteCard,
  moveCard,
  reorderColumn,
  updateCard,
  type Board,
  type LoadedCard,
  type Placement,
  type Workspace,
} from '@kanban/core';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  ageDays,
  cardLine,
  renderBoard,
  renderBoardList,
  renderCard,
  renderStats,
} from './format.js';
import { findCard, shortId, type Store } from './store.js';

type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

const text = (body: string): ToolResult => ({ content: [{ type: 'text', text: body }] });

/**
 * Tool errors come back as readable text rather than protocol errors: the model should be able to
 * correct itself from the message ("no column X, the columns are ...") without the call failing.
 * Sync warnings are appended either way — a push that failed is worth saying out loud, but it does
 * not make the operation a failure, because the change is already on disk.
 */
async function runGuarded(store: Store, run: () => Promise<ToolResult>): Promise<ToolResult> {
  let result: ToolResult;
  try {
    result = await run();
  } catch (error) {
    const message =
      error instanceof KanbanError || error instanceof Error ? error.message : String(error);
    result = { content: [{ type: 'text', text: message }], isError: true };
  }

  const warnings = store.drainWarnings();
  if (warnings.length > 0) {
    result.content.push({ type: 'text', text: warnings.map((w) => `! ${w}`).join('\n') });
  }
  return result;
}

const boardArg = z
  .string()
  .optional()
  .describe('Board id. Omit to use the board matching the current working directory.');
const cardArg = z
  .string()
  .describe('Card id, the short id shown in listings (e.g. "pe0004"), or the exact title.');

const placementArgs = {
  before: z.string().optional().describe('Place directly above this card (id, short id or title).'),
  after: z.string().optional().describe('Place directly below this card.'),
  position: z.enum(['top', 'bottom']).optional().describe('Place at the top or bottom of the column. Default: bottom.'),
};

/** Resolve before/after card references to real ids, since core ops address cards by id. */
function toPlacement(
  ws: Workspace,
  boardId: string,
  args: { before?: string | undefined; after?: string | undefined; position?: 'top' | 'bottom' | undefined },
): Placement {
  const placement: Placement = {};
  if (args.before !== undefined) placement.before = findCard(ws, args.before, boardId).id;
  if (args.after !== undefined) placement.after = findCard(ws, args.after, boardId).id;
  if (args.position !== undefined) placement.position = args.position;
  return placement;
}

function summariseWrite(
  ws: Workspace,
  board: Board,
  card: LoadedCard,
  written: number,
  headline: string,
): string {
  const column = board.columns.find((c) => c.id === card.column);
  const lines = [headline, `${written} file(s) written · ${card.path}`];
  if (column?.wipLimit !== undefined) {
    // `ws` is the pre-write state, so exclude this card before counting: it may already be in
    // this column (an update, or a reposition), in which case it must not be counted twice.
    const after = columnCards(ws, board.id, card.column).filter((c) => c.id !== card.id).length + 1;
    lines.push(
      `${column.name}: ${after}/${column.wipLimit}${after > column.wipLimit ? '  !! over WIP limit' : ''}`,
    );
  }
  return lines.join('\n');
}

export function registerTools(server: McpServer, store: Store): void {
  const guard = (run: () => Promise<ToolResult>): Promise<ToolResult> => runGuarded(store, run);

  // ---------------------------------------------------------------- reads

  server.registerTool(
    'list_boards',
    {
      title: 'List boards',
      description: 'Every kanban board, with card counts and the project paths each belongs to.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => guard(async () => text(renderBoardList(await store.load()))),
  );

  server.registerTool(
    'get_board',
    {
      title: 'Get board',
      description:
        'Cards on a board, grouped by column, in priority order. Metadata only — use get_card ' +
        'for a card body. This is the cheap survey; start here.',
      inputSchema: z.object({
        board: boardArg,
        column: z.string().optional().describe('Show only this column.'),
        label: z.string().optional().describe('Show only cards carrying this label.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ board, column, label }) =>
      guard(async () => {
        const ws = await store.load();
        const target = await store.resolveBoardId(ws, board);
        return text(renderBoard(ws, target, { column, label }));
      }),
  );

  server.registerTool(
    'get_card',
    {
      title: 'Get card',
      description: 'One card in full, including its markdown body and notes log.',
      inputSchema: z.object({ card: cardArg, board: boardArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ card, board }) =>
      guard(async () => {
        const ws = await store.load();
        const boardId = board === undefined ? undefined : (await store.resolveBoardId(ws, board)).id;
        return text(renderCard(findCard(ws, card, boardId), new Date()));
      }),
  );

  server.registerTool(
    'search_cards',
    {
      title: 'Search cards',
      description: 'Find cards by text in the title, labels or body. Searches every board by default.',
      inputSchema: z.object({
        query: z.string().min(1),
        board: z.string().optional().describe('Restrict to one board.'),
        limit: z.number().int().positive().max(50).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, board, limit }) =>
      guard(async () => {
        const ws = await store.load();
        const needle = query.toLowerCase();
        const pool = board === undefined ? ws.cards : ws.cards.filter((c) => c.boardId === board);

        const scored = pool
          .map((card) => {
            let score = 0;
            const where: string[] = [];
            if (card.title.toLowerCase().includes(needle)) (score += 3), where.push('title');
            if (card.labels.some((l) => l.toLowerCase().includes(needle))) (score += 2), where.push('label');
            if (card.body.toLowerCase().includes(needle)) (score += 1), where.push('body');
            return { card, score, where };
          })
          .filter((m) => m.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit ?? 20);

        if (scored.length === 0) return text(`No cards match "${query}".`);
        const lines = [`${scored.length} match(es) for "${query}":`];
        for (const { card, where } of scored) {
          lines.push(`${cardLine(card, ws)}  [${card.boardId}/${card.column}] — ${where.join('+')}`);
        }
        return text(lines.join('\n'));
      }),
  );

  server.registerTool(
    'board_stats',
    {
      title: 'Board stats',
      description: 'Column counts, WIP pressure, priority and label spread, least recently touched cards.',
      inputSchema: z.object({ board: boardArg }),
      annotations: { readOnlyHint: true },
    },
    async ({ board }) =>
      guard(async () => {
        const ws = await store.load();
        const target = await store.resolveBoardId(ws, board);
        return text(renderStats(ws, target, new Date()));
      }),
  );

  server.registerTool(
    'suggest_next',
    {
      title: 'Suggest next card',
      description:
        'Candidates for what to work on next, each with the raw signals behind it — priority, ' +
        'how far along its column is, age, blocked state, WIP pressure. It ranks; you judge. ' +
        'Prefer finishing something already in progress over starting new work.',
      inputSchema: z.object({
        board: boardArg,
        count: z.number().int().positive().max(10).optional().describe('How many candidates. Default 3.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ board, count }) =>
      guard(async () => {
        const ws = await store.load();
        const target = await store.resolveBoardId(ws, board);
        const now = new Date();

        const doneColumns = new Set(
          target.columns.filter((c) => c.autoArchiveAfterDays !== undefined).map((c) => c.id),
        );
        const stage = new Map(target.columns.map((c, i) => [c.id, i]));
        const priorityRank = new Map(PRIORITIES.map((p, i) => [p, i]));

        const candidates = ws.cards
          .filter((c) => c.boardId === target.id && !doneColumns.has(c.column))
          .map((card) => ({
            card,
            position: columnCards(ws, target.id, card.column).findIndex((c) => c.id === card.id) + 1,
            columnSize: columnCards(ws, target.id, card.column).length,
            blocked: card.blockedBy.length > 0,
          }))
          .sort((a, b) => {
            if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
            // Later column first: finishing started work beats starting more of it.
            const byStage = (stage.get(b.card.column) ?? 0) - (stage.get(a.card.column) ?? 0);
            if (byStage !== 0) return byStage;
            const byPriority =
              (priorityRank.get(a.card.priority) ?? 9) - (priorityRank.get(b.card.priority) ?? 9);
            if (byPriority !== 0) return byPriority;
            return a.position - b.position;
          })
          .slice(0, count ?? 3);

        if (candidates.length === 0) return text(`Nothing open on ${target.name}.`);

        const lines: string[] = [];
        const wip = target.columns
          .filter((c) => c.wipLimit !== undefined && !doneColumns.has(c.id))
          .map((c) => `${c.name} ${columnCards(ws, target.id, c.id).length}/${c.wipLimit}`);
        lines.push(`${target.name}${wip.length > 0 ? ` · ${wip.join(' · ')}` : ''}`, '');

        candidates.forEach((entry, i) => {
          const { card } = entry;
          lines.push(`${i + 1}. ${cardLine(card, ws).trim()}`);
          const signals = [
            `priority ${card.priority}`,
            `${card.column} #${entry.position} of ${entry.columnSize}`,
            `untouched ${ageDays(card.updated, now)}d`,
            entry.blocked ? 'BLOCKED' : 'unblocked',
          ];
          if (card.estimate) signals.push(`estimate ${card.estimate}`);
          lines.push(`   ${signals.join(' · ')}`);
        });

        lines.push('', 'Signals, not a verdict — weigh them against what this session is for.');
        return text(lines.join('\n'));
      }),
  );

  // ---------------------------------------------------------------- writes

  server.registerTool(
    'create_card',
    {
      title: 'Create card',
      description:
        'Add a card. Put the real substance in `body` as markdown — context, acceptance criteria ' +
        'as checkboxes — so a later session can pick it up cold.',
      inputSchema: z.object({
        board: boardArg,
        title: z.string().min(1),
        body: z.string().optional().describe('Markdown body.'),
        column: z.string().optional().describe('Column id. Default: the first column.'),
        priority: z.enum(PRIORITIES).optional(),
        labels: z.array(z.string()).optional(),
        estimate: z.enum(ESTIMATES).optional(),
        links: z.array(z.string()).optional(),
        ...placementArgs,
      }),
    },
    async (args) =>
      guard(async () => {
        const ws = await store.load();
        const board = await store.resolveBoardId(ws, args.board);
        const result = createCard(ws, {
          boardId: board.id,
          title: args.title,
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.column !== undefined ? { column: args.column } : {}),
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.labels !== undefined ? { labels: args.labels } : {}),
          ...(args.estimate !== undefined ? { estimate: args.estimate } : {}),
          ...(args.links !== undefined ? { links: args.links } : {}),
          placement: toPlacement(ws, board.id, args),
        });
        const changes = await store.write(result);
        return text(
          summariseWrite(
            ws,
            board,
            result.card,
            changes.length,
            `Created ${shortId(result.card.id)} "${result.card.title}" in ${result.card.column}.`,
          ),
        );
      }),
  );

  server.registerTool(
    'update_card',
    {
      title: 'Update card',
      description: 'Change a card\'s fields. Use move_card to change its column or position.',
      inputSchema: z.object({
        card: cardArg,
        board: boardArg,
        title: z.string().optional(),
        body: z.string().optional().describe('Replaces the whole body. Use add_note to append.'),
        priority: z.enum(PRIORITIES).optional(),
        labels: z.array(z.string()).optional(),
        estimate: z.enum([...ESTIMATES, 'none']).optional().describe('"none" clears the estimate.'),
        links: z.array(z.string()).optional(),
        blockedBy: z.array(z.string()).optional().describe('Card ids this one waits on.'),
      }),
    },
    async (args) =>
      guard(async () => {
        const ws = await store.load();
        const boardId = args.board === undefined ? undefined : (await store.resolveBoardId(ws, args.board)).id;
        const current = findCard(ws, args.card, boardId);
        const board = await store.resolveBoardId(ws, current.boardId);

        const result = updateCard(ws, current.id, {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.body !== undefined ? { body: args.body } : {}),
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.labels !== undefined ? { labels: args.labels } : {}),
          ...(args.links !== undefined ? { links: args.links } : {}),
          ...(args.blockedBy !== undefined
            ? { blockedBy: args.blockedBy.map((ref) => findCard(ws, ref, current.boardId).id) }
            : {}),
          ...(args.estimate !== undefined
            ? { estimate: args.estimate === 'none' ? null : args.estimate }
            : {}),
        });
        const changes = await store.write(result);
        return text(
          summariseWrite(ws, board, result.card, changes.length, `Updated "${result.card.title}".`),
        );
      }),
  );

  server.registerTool(
    'move_card',
    {
      title: 'Move card',
      description:
        'Move a card to another column and/or another position. Touches one file — position is a ' +
        'fractional index, so siblings are left alone.',
      inputSchema: z.object({
        card: cardArg,
        board: boardArg,
        column: z.string().optional().describe('Target column id. Omit to reposition in place.'),
        ...placementArgs,
      }),
    },
    async (args) =>
      guard(async () => {
        const ws = await store.load();
        const boardId = args.board === undefined ? undefined : (await store.resolveBoardId(ws, args.board)).id;
        const current = findCard(ws, args.card, boardId);
        const board = await store.resolveBoardId(ws, current.boardId);

        const result = moveCard(ws, current.id, {
          ...(args.column !== undefined ? { column: args.column } : {}),
          ...toPlacement(ws, current.boardId, args),
        });
        const changes = await store.write(result);
        const moved = result.card.column !== current.column;
        return text(
          summariseWrite(
            ws,
            board,
            result.card,
            changes.length,
            moved
              ? `Moved "${result.card.title}" from ${current.column} to ${result.card.column}.`
              : `Repositioned "${result.card.title}" in ${result.card.column}.`,
          ),
        );
      }),
  );

  server.registerTool(
    'reorder_cards',
    {
      title: 'Reorder a column',
      description:
        'Set the order of a whole column at once — the re-prioritisation tool. Cards you leave ' +
        'out keep their relative order, after the ones you list.',
      inputSchema: z.object({
        board: boardArg,
        column: z.string().describe('Column id.'),
        cards: z.array(z.string()).min(1).describe('Card references, in the order you want them.'),
      }),
    },
    async ({ board, column, cards }) =>
      guard(async () => {
        const ws = await store.load();
        const target = await store.resolveBoardId(ws, board);
        const ids = cards.map((ref) => findCard(ws, ref, target.id).id);
        const result = reorderColumn(ws, target.id, column, ids);
        const changes = await store.write(result);
        if (changes.length === 0) return text('Already in that order — nothing written.');
        return text(
          [`Reordered ${column} on ${target.name}.`, `${changes.length} file(s) written.`, '', renderBoard(await store.load(), target, { column })].join('\n'),
        );
      }),
  );

  server.registerTool(
    'add_note',
    {
      title: 'Add a note to a card',
      description:
        'Append a dated line to the card\'s Notes section. Use it to record what you found — ' +
        'where the relevant code is, what you tried, what is still unresolved — so the next ' +
        'session starts informed instead of re-deriving it.',
      inputSchema: z.object({
        card: cardArg,
        board: boardArg,
        text: z.string().min(1).describe('One observation, in a sentence or two.'),
      }),
    },
    async (args) =>
      guard(async () => {
        const ws = await store.load();
        const boardId = args.board === undefined ? undefined : (await store.resolveBoardId(ws, args.board)).id;
        const current = findCard(ws, args.card, boardId);
        const result = addNote(ws, current.id, args.text, store.config.author);
        await store.write(result);
        return text(`Noted on "${result.card.title}".`);
      }),
  );

  server.registerTool(
    'archive_card',
    {
      title: 'Archive card',
      description: 'Move a card out of the board into archive/. Reversible — the file is kept.',
      inputSchema: z.object({ card: cardArg, board: boardArg }),
    },
    async (args) =>
      guard(async () => {
        const ws = await store.load();
        const boardId = args.board === undefined ? undefined : (await store.resolveBoardId(ws, args.board)).id;
        const current = findCard(ws, args.card, boardId);
        const result = archiveCard(ws, current.id);
        await store.write(result);
        return text(`Archived "${result.card.title}" → ${result.card.path}`);
      }),
  );

  server.registerTool(
    'sync',
    {
      title: 'Sync the board repo',
      description:
        'Push anything queued and pull the latest. Writes sync on their own — reach for this to ' +
        'force it, or to check whether the board repo is clean.',
      inputSchema: z.object({}),
    },
    async () =>
      guard(async () => {
        if (!store.git.available) {
          return text(
            store.config.autoSync
              ? `${store.config.dataDir} is not a git repository — changes are saved to disk only.`
              : 'Auto-sync is off (KANBAN_AUTOSYNC=0). Changes are saved to disk only.',
          );
        }
        await store.syncNow();
        const [dirty, unpushed] = await Promise.all([
          store.git.dirtyPaths(),
          store.git.unpushedCount(),
        ]);

        const lines: string[] = [];
        if (dirty.length > 0) {
          lines.push(
            `${dirty.length} path(s) uncommitted:`,
            ...dirty.slice(0, 10).map((p) => `  ${p}`),
          );
        }
        if (unpushed > 0) lines.push(`${unpushed} commit(s) committed locally but not pushed.`);
        else if (unpushed < 0) lines.push('No upstream branch — changes stay on this machine.');

        if (lines.length === 0) return text('Board repo is in sync with the remote.');
        return text(lines.join('\n'));
      }),
  );

  server.registerTool(
    'delete_card',
    {
      title: 'Delete card',
      description:
        'Permanently delete a card file. Prefer archive_card — this leaves nothing behind except ' +
        'git history. Requires confirm: true.',
      inputSchema: z.object({
        card: cardArg,
        board: boardArg,
        confirm: z.literal(true).describe('Must be true. Guards against an accidental delete.'),
      }),
      annotations: { destructiveHint: true },
    },
    async (args) =>
      guard(async () => {
        const ws = await store.load();
        const boardId = args.board === undefined ? undefined : (await store.resolveBoardId(ws, args.board)).id;
        const current = findCard(ws, args.card, boardId);
        const result = deleteCard(ws, current.id);
        await store.write(result);
        return text(`Deleted "${current.title}" (${current.path}). Recoverable only from git history.`);
      }),
  );
}
