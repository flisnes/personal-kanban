// @vitest-environment happy-dom
import { parseWorkspace, type Workspace } from '@kanban/core';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.js';
import { BoardView, type Filters } from '../src/components/BoardView.js';

afterEach(cleanup);

const NO_FILTERS: Filters = { query: '', label: null, priority: null };

const card = (id: string, title: string, column: string, rank: string, labels = '', body = 'Body.') =>
  [
    '---',
    `id: ${id}`,
    `title: '${title}'`,
    `column: ${column}`,
    `rank: '${rank}'`,
    'priority: P1',
    ...(labels ? [`labels: [${labels}]`] : []),
    "created: '2026-01-01T00:00:00.000Z'",
    "updated: '2026-01-01T00:00:00.000Z'",
    '---',
    '',
    body,
    '',
  ].join('\n');

const workspace: Workspace = parseWorkspace([
  [
    'boards/demo/board.json',
    JSON.stringify({
      id: 'demo',
      name: 'Demo',
      columns: [
        { id: 'todo', name: 'To Do', wipLimit: 1 },
        { id: 'doing', name: 'In Progress' },
      ],
      labels: [{ id: 'web', color: '#3b82f6' }],
    }),
  ],
  ['boards/demo/cards/a.md', card('A1', 'Scaffold the web app', 'todo', 'a0', 'web')],
  ['boards/demo/cards/b.md', card('B2', 'Wire up the loader', 'todo', 'a1')],
  ['boards/demo/cards/c.md', card('C3', 'Deploy to Pages', 'doing', 'a0')],
]);

const board = workspace.boards[0]!;

describe('App', () => {
  // The failure this guards against is a blank page: the shell deploys fine even if React throws.
  it('renders the setup screen when there are no stored credentials', () => {
    localStorage.clear();
    render(<App />);
    expect(screen.getByRole('heading', { name: /connect your board/i })).toBeTruthy();
    expect(screen.getByLabelText(/github username/i)).toBeTruthy();
    expect(screen.getByLabelText(/fine-grained access token/i)).toBeTruthy();
  });

  it('keeps the connect button disabled until every field is filled', () => {
    localStorage.clear();
    render(<App />);
    const button = screen.getByRole('button', { name: /connect/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/github username/i), { target: { value: 'flisnes' } });
    fireEvent.change(screen.getByLabelText(/fine-grained access token/i), {
      target: { value: 'token' },
    });
    expect(button.disabled).toBe(false);
  });
});

describe('BoardView', () => {
  const renderBoard = (filters: Filters = NO_FILTERS) =>
    render(
      <BoardView workspace={workspace} board={board} filters={filters} onOpenCard={() => {}} />,
    );

  it('renders every column with its cards in rank order', () => {
    renderBoard();
    const todo = screen.getByRole('region', { name: 'To Do' });
    const titles = within(todo)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    expect(titles[0]).toContain('Scaffold the web app');
    expect(titles[1]).toContain('Wire up the loader');
    expect(within(screen.getByRole('region', { name: 'In Progress' })).getByText(/Deploy to Pages/)).toBeTruthy();
  });

  it('flags a column that is over its WIP limit', () => {
    renderBoard();
    const todo = screen.getByRole('region', { name: 'To Do' });
    expect(within(todo).getByTitle(/over the wip limit/i)).toBeTruthy();
  });

  it('narrows to matching cards when searching', () => {
    renderBoard({ ...NO_FILTERS, query: 'loader' });
    expect(screen.getByText(/Wire up the loader/)).toBeTruthy();
    expect(screen.queryByText(/Deploy to Pages/)).toBeNull();
  });

  it('filters by label', () => {
    renderBoard({ ...NO_FILTERS, label: 'web' });
    expect(screen.getByText(/Scaffold the web app/)).toBeTruthy();
    expect(screen.queryByText(/Wire up the loader/)).toBeNull();
  });

  it('says so when a filter matches nothing, rather than rendering an empty column', () => {
    renderBoard({ ...NO_FILTERS, query: 'nothing matches this' });
    expect(screen.getAllByText(/nothing matches/i).length).toBeGreaterThan(0);
  });
});
