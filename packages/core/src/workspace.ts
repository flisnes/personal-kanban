import { CardParseError, parseCard } from './card.js';
import { ARCHIVE_DIR, BOARDS_DIR, segments } from './paths.js';
import { BoardSchema, type Board, type LoadedCard } from './schema.js';
import { isValidRank, sortByRank } from './rank.js';

export interface WorkspaceIssue {
  path: string;
  message: string;
}

export interface Workspace {
  boards: Board[];
  cards: LoadedCard[];
  archived: LoadedCard[];
  /**
   * Problems found while loading, rather than thrown. One hand-edited card with a typo in its
   * frontmatter must not blank out the whole board — it should show up as a repairable warning
   * while everything else keeps working.
   */
  issues: WorkspaceIssue[];
}

/**
 * Build a workspace from repo-relative path → file content. The only entry point for turning
 * raw files into a board, shared by the MCP server (reading a local clone) and the web app
 * (reading blobs from the GitHub API), so both see byte-identical semantics.
 */
export function parseWorkspace(files: Iterable<readonly [string, string]>): Workspace {
  const boards: Board[] = [];
  const cards: LoadedCard[] = [];
  const archived: LoadedCard[] = [];
  const issues: WorkspaceIssue[] = [];

  for (const [rawPath, content] of files) {
    const parts = segments(rawPath);
    const path = parts.join('/');
    const [root, boardId, third, fourth] = parts;

    if (root === BOARDS_DIR && boardId !== undefined && third === 'board.json') {
      try {
        const parsed: unknown = JSON.parse(content);
        const board = BoardSchema.parse(parsed);
        if (board.id !== boardId) {
          issues.push({
            path,
            message: `board id "${board.id}" does not match its directory "${boardId}"`,
          });
        }
        boards.push({ ...board, id: boardId });
      } catch (error) {
        issues.push({ path, message: describe(error) });
      }
      continue;
    }

    const isCard =
      boardId !== undefined && third === 'cards' && fourth !== undefined && fourth.endsWith('.md');
    if (isCard && (root === BOARDS_DIR || root === ARCHIVE_DIR)) {
      try {
        const card = parseCard(content, path);
        (root === BOARDS_DIR ? cards : archived).push({ ...card, boardId, path });
      } catch (error) {
        issues.push({ path, message: describe(error) });
      }
    }
  }

  boards.sort((a, b) => a.name.localeCompare(b.name));

  const knownBoards = new Map(boards.map((b) => [b.id, b]));
  const seenIds = new Map<string, string>();
  for (const card of cards) {
    const board = knownBoards.get(card.boardId);
    if (!board) {
      issues.push({ path: card.path, message: `no board.json for board "${card.boardId}"` });
    } else if (!board.columns.some((c) => c.id === card.column)) {
      issues.push({
        path: card.path,
        message: `column "${card.column}" is not defined on board "${card.boardId}"`,
      });
    }
    if (!isValidRank(card.rank)) {
      issues.push({
        path: card.path,
        message:
          `rank "${card.rank}" is not a valid order key — the card still shows, but its ` +
          `position is arbitrary until it is moved`,
      });
    }
    const duplicate = seenIds.get(card.id);
    if (duplicate !== undefined) {
      issues.push({ path: card.path, message: `duplicate card id, also used by ${duplicate}` });
    } else {
      seenIds.set(card.id, card.path);
    }
  }

  return { boards, cards, archived, issues };
}

function describe(error: unknown): string {
  if (error instanceof CardParseError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export const getBoard = (ws: Workspace, boardId: string): Board | undefined =>
  ws.boards.find((b) => b.id === boardId);

export const getCard = (ws: Workspace, cardId: string): LoadedCard | undefined =>
  ws.cards.find((c) => c.id === cardId);

export const boardCards = (ws: Workspace, boardId: string): LoadedCard[] =>
  ws.cards.filter((c) => c.boardId === boardId);

/** Cards in one column, in board order. */
export const columnCards = (ws: Workspace, boardId: string, columnId: string): LoadedCard[] =>
  sortByRank(ws.cards.filter((c) => c.boardId === boardId && c.column === columnId));
