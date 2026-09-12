import { parseWorkspace, type Workspace } from '../src/workspace.js';

export const T0 = new Date('2026-01-01T00:00:00.000Z');

export function cardFile(fields: {
  id: string;
  title: string;
  column: string;
  rank: string;
  body?: string;
  extra?: string;
}): string {
  return [
    '---',
    `id: ${fields.id}`,
    `title: ${fields.title}`,
    `column: ${fields.column}`,
    `rank: '${fields.rank}'`,
    'priority: P2',
    `created: '${T0.toISOString()}'`,
    `updated: '${T0.toISOString()}'`,
    ...(fields.extra ? [fields.extra] : []),
    '---',
    '',
    fields.body ?? 'Body text.',
    '',
  ].join('\n');
}

export const DEMO_BOARD = {
  id: 'demo',
  name: 'Demo',
  projectPaths: ['C:/Users/Haakon/develop/demo'],
  gitRemotes: ['git@github.com:haakon/demo.git'],
  columns: [
    { id: 'backlog', name: 'Backlog' },
    { id: 'todo', name: 'To Do' },
    { id: 'doing', name: 'In Progress', wipLimit: 2 },
    { id: 'done', name: 'Done', autoArchiveAfterDays: 14 },
  ],
  labels: [{ id: 'bug', color: '#ef4444' }],
};

/** Three cards in `todo`, ranked a0 < a1 < a2. */
export function makeWorkspace(): Workspace {
  return parseWorkspace([
    ['boards/demo/board.json', JSON.stringify(DEMO_BOARD, null, 2)],
    ['boards/demo/cards/first--000001.md', cardFile({ id: 'C1', title: 'First', column: 'todo', rank: 'a0' })],
    ['boards/demo/cards/second--000002.md', cardFile({ id: 'C2', title: 'Second', column: 'todo', rank: 'a1' })],
    ['boards/demo/cards/third--000003.md', cardFile({ id: 'C3', title: 'Third', column: 'todo', rank: 'a2' })],
  ]);
}
