import {
  archiveCard,
  createCard,
  moveCard,
  updateCard,
  type MoveCardInput,
  type UpdateCardPatch,
} from '@kanban/core';
import { ulid } from 'ulid';
import type { Intent } from './boardStore.js';

/**
 * Every browser write, expressed as a replayable intent over the shared core ops. Nothing here
 * implements a mutation of its own — that is the rule that keeps the UI and the MCP server from
 * drifting apart.
 *
 * What is captured at enqueue time and what is left to replay matters:
 *   - ids and timestamps are frozen, so a conflict replay updates the same card rather than
 *     creating a second one;
 *   - placement is expressed against *neighbouring card ids*, not indices, so replaying against a
 *     board that moved underneath still lands the card where the user dropped it.
 */

export function createCardIntent(input: {
  boardId: string;
  title: string;
  column: string;
  body?: string;
}): Intent {
  const now = new Date();
  const id = ulid(now.getTime());
  return {
    label: `new card "${input.title}"`,
    run: (ws) =>
      createCard(ws, {
        boardId: input.boardId,
        title: input.title,
        column: input.column,
        ...(input.body === undefined ? {} : { body: input.body }),
        placement: { position: 'bottom' },
        id,
        now,
      }),
  };
}

export function updateCardIntent(cardId: string, title: string, patch: UpdateCardPatch): Intent {
  const now = new Date();
  return {
    label: `edit "${title}"`,
    run: (ws) => updateCard(ws, cardId, patch, now),
  };
}

export function moveCardIntent(cardId: string, title: string, input: MoveCardInput): Intent {
  const now = new Date();
  return {
    label: `move "${title}"`,
    run: (ws) => moveCard(ws, cardId, input, now),
  };
}

export function archiveCardIntent(cardId: string, title: string): Intent {
  const now = new Date();
  return {
    label: `archive "${title}"`,
    run: (ws) => archiveCard(ws, cardId, now),
  };
}
