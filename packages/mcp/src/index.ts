#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { renderBoard } from './format.js';
import { Store } from './store.js';
import { registerTools } from './tools.js';

// stdout carries the JSON-RPC stream — anything written there corrupts the protocol.
const log = (message: string): void => void process.stderr.write(`${message}\n`);

function createServer(): McpServer {
  const config = loadConfig();
  const store = new Store(config);

  const server = new McpServer(
    { name: 'kanban', version: '0.1.0' },
    {
      instructions:
        'Personal kanban boards, stored as markdown files in a git repo.\n\n' +
        'Start with get_board — it gives the whole board for a few hundred tokens and needs no ' +
        'arguments inside a known project directory. Fetch bodies one at a time with get_card.\n\n' +
        'When you finish a piece of work, move the card and add_note what you learned: the notes ' +
        'are what let the next session start informed. Prefer archive_card over delete_card.',
    },
  );

  registerTools(server, store);

  server.registerResource(
    'board',
    new ResourceTemplate('kanban://boards/{boardId}', {
      list: async () => {
        const ws = await store.load();
        return {
          resources: ws.boards.map((board) => ({
            uri: `kanban://boards/${board.id}`,
            name: board.name,
            description: `${ws.cards.filter((c) => c.boardId === board.id).length} cards`,
            mimeType: 'text/markdown',
          })),
        };
      },
    }),
    { title: 'Kanban board', description: 'A whole board rendered as markdown.' },
    async (uri, variables) => {
      const ws = await store.load();
      const boardId = String(variables['boardId']);
      const board = ws.boards.find((b) => b.id === boardId);
      if (!board) throw new Error(`No board "${boardId}"`);
      return {
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderBoard(ws, board) }],
      };
    },
  );

  server.registerPrompt(
    'plan-session',
    {
      title: 'Plan this session',
      description: 'Survey the board and propose what to work on, with reasoning.',
      argsSchema: z.object({ board: z.string().optional() }),
    },
    ({ board }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Survey the kanban board${board ? ` "${board}"` : ' for this project'} with ` +
              `get_board and suggest_next, then read the bodies of the two or three most likely ` +
              `candidates.\n\nPropose one thing to work on this session and say why it beats the ` +
              `alternatives — weigh unfinished work in progress ahead of starting something new, ` +
              `and take the size of the session into account. Ask me before you start.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'groom-backlog',
    {
      title: 'Groom the backlog',
      description: 'Find stale, vague, duplicated or mis-prioritised cards.',
      argsSchema: z.object({ board: z.string().optional() }),
    },
    ({ board }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `Review the kanban board${board ? ` "${board}"` : ' for this project'}: get_board ` +
              `and board_stats first, then read the cards that look questionable.\n\nReport ` +
              `cards that are duplicates, too vague to start, stale, or priced wrong relative to ` +
              `the rest. Propose specific changes — a reorder, a merge, a rewritten body — and ` +
              `wait for my go-ahead before writing anything.`,
          },
        },
      ],
    }),
  );

  // A queued push must not be lost when the client goes away, which is how this process usually
  // ends. Best-effort: the write itself is already committed by this point.
  let flushing = false;
  const flush = (): void => {
    if (flushing) return;
    flushing = true;
    void store.syncNow().catch(() => undefined);
  };
  process.once('SIGINT', flush);
  process.once('SIGTERM', flush);
  process.once('beforeExit', flush);

  log(
    `kanban MCP server: data=${config.dataDir} cwd=${config.cwd} ` +
      `sync=${store.git.available ? 'on' : 'off'}`,
  );
  return server;
}

try {
  void serveStdio(createServer);
} catch (error) {
  log(`kanban MCP server failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
