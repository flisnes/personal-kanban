// @vitest-environment happy-dom
import { parseWorkspace, type Workspace } from '@kanban/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.js';
import { BoardView, TOUCH_HOLD, type BoardActions, type Filters } from '../src/components/BoardView.js';
import { CardDrawer } from '../src/components/CardDrawer.js';

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

const noActions: BoardActions = { move: () => {}, create: () => {} };

describe('BoardView', () => {
  const renderBoard = (filters: Filters = NO_FILTERS, actions: BoardActions = noActions) =>
    render(
      <BoardView
        workspace={workspace}
        board={board}
        filters={filters}
        actions={actions}
        onOpenCard={() => {}}
      />,
    );

  it('renders every column with its cards in rank order', () => {
    renderBoard();
    const todo = screen.getByRole('region', { name: 'To Do' });
    const titles = within(todo)
      .getAllByRole('button')
      .filter((b) => b.dataset['cardId'] !== undefined)
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

describe('keyboard moves', () => {
  const setup = () => {
    const moves: { id: string; input: unknown }[] = [];
    const actions: BoardActions = {
      move: (card, input) => moves.push({ id: card.id, input }),
      create: () => {},
    };
    render(
      <BoardView
        workspace={workspace}
        board={board}
        filters={NO_FILTERS}
        actions={actions}
        onOpenCard={() => {}}
      />,
    );
    const tile = (id: string) => document.querySelector(`[data-card-id="${id}"]`) as HTMLElement;
    return { moves, tile };
  };

  // Dragging is not reachable without a pointer, so the arrow keys are the real move path and not
  // a fallback: every gesture the mouse can make has to be available here too.
  it('moves a card down its column with shift+down', () => {
    const { moves, tile } = setup();
    fireEvent.keyDown(tile('A1'), { key: 'ArrowDown', shiftKey: true });
    expect(moves).toEqual([{ id: 'A1', input: { after: 'B2' } }]);
  });

  it('moves a card up its column with shift+up', () => {
    const { moves, tile } = setup();
    fireEvent.keyDown(tile('B2'), { key: 'ArrowUp', shiftKey: true });
    expect(moves).toEqual([{ id: 'B2', input: { before: 'A1' } }]);
  });

  it('moves a card to the next column with shift+right', () => {
    const { moves, tile } = setup();
    fireEvent.keyDown(tile('A1'), { key: 'ArrowRight', shiftKey: true });
    expect(moves).toEqual([{ id: 'A1', input: { column: 'doing', before: 'C3' } }]);
  });

  it('does nothing at the edges rather than wrapping around', () => {
    const { moves, tile } = setup();
    fireEvent.keyDown(tile('A1'), { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(tile('A1'), { key: 'ArrowLeft', shiftKey: true });
    expect(moves).toEqual([]);
  });

  it('moves focus, not the card, without shift', () => {
    const { moves, tile } = setup();
    fireEvent.keyDown(tile('A1'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(tile('B2'));
    expect(moves).toEqual([]);
  });

  it('announces a move for screen readers', () => {
    const { tile } = setup();
    fireEvent.keyDown(tile('A1'), { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByText(/Scaffold the web app moved to In Progress/)).toBeTruthy();
  });
});

describe('picking a card up', () => {
  // The board scrolls sideways by swiping, and a column scrolls by swiping too — and both swipes
  // start on a card more often than not. So a finger that moves straight away is scrolling, and
  // only a finger that rests on the card first is picking it up. A mouse has no such ambiguity
  // and keeps dragging from the first few pixels.
  const setup = () => {
    vi.useFakeTimers();
    const opened: string[] = [];
    render(
      <BoardView
        workspace={workspace}
        board={board}
        filters={NO_FILTERS}
        actions={noActions}
        onOpenCard={(id) => opened.push(id)}
      />,
    );
    const tile = document.querySelector('[data-card-id="A1"]') as HTMLElement;
    // While a drag is live the original stays put as a gap and a copy follows the pointer.
    const lifted = () => document.querySelectorAll('[data-card-id="A1"]').length === 2;
    const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
    const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
    // dnd-kit settles a finished drag on a microtask, so letting go has to be awaited.
    const release = (fire: () => void) => act(async () => void fire());
    return { tile, lifted, touch, wait, release, opened };
  };
  afterEach(() => {
    // dnd-kit swallows clicks for a moment after a drag, and lifts that on a timer.
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('lets a swipe that starts on a card scroll instead of dragging', async () => {
    const { tile, lifted, touch, wait, release } = setup();
    fireEvent.touchStart(tile, touch(10, 10));
    wait(50);
    fireEvent.touchMove(tile, touch(10, 40));
    wait(TOUCH_HOLD.delay + 100);
    expect(lifted()).toBe(false);
    // Nothing was armed, so the browser is free to keep scrolling.
    fireEvent.touchMove(tile, touch(10, 200));
    expect(lifted()).toBe(false);
    await release(() => fireEvent.touchEnd(tile, { changedTouches: [{ clientX: 10, clientY: 200 }] }));
    expect(lifted()).toBe(false);
  });

  it('picks the card up after a finger has held still on it', async () => {
    const { tile, lifted, touch, wait, release } = setup();
    fireEvent.touchStart(tile, touch(10, 10));
    // A resting finger is never perfectly still; a wobble under the tolerance must not cancel.
    fireEvent.touchMove(tile, touch(12, 11));
    wait(TOUCH_HOLD.delay - 50);
    expect(lifted()).toBe(false);
    wait(100);
    expect(lifted()).toBe(true);
    fireEvent.touchMove(tile, touch(12, 80));
    expect(lifted()).toBe(true);
    await release(() => fireEvent.touchEnd(tile, { changedTouches: [{ clientX: 12, clientY: 80 }] }));
    expect(lifted()).toBe(false);
  });

  it('does not pick the card up when a swipe is faster than the hold', () => {
    const { tile, lifted, touch, wait } = setup();
    fireEvent.touchStart(tile, touch(10, 10));
    wait(TOUCH_HOLD.delay - 20);
    fireEvent.touchMove(tile, touch(10, 10 + TOUCH_HOLD.tolerance + 1));
    wait(200);
    expect(lifted()).toBe(false);
  });

  it('still drags with a mouse from the first few pixels, without a hold', async () => {
    const { tile, lifted, release } = setup();
    fireEvent.mouseDown(tile, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.mouseMove(tile, { clientX: 30, clientY: 10 });
    expect(lifted()).toBe(true);
    await release(() => fireEvent.mouseUp(tile, { clientX: 30, clientY: 10 }));
    expect(lifted()).toBe(false);
  });

  it('opens the card on a tap', async () => {
    const { tile, lifted, touch, wait, release, opened } = setup();
    fireEvent.touchStart(tile, touch(10, 10));
    wait(80);
    await release(() => fireEvent.touchEnd(tile, { changedTouches: [{ clientX: 10, clientY: 10 }] }));
    fireEvent.click(tile);
    wait(TOUCH_HOLD.delay + 100);
    expect(opened).toEqual(['A1']);
    expect(lifted()).toBe(false);
  });
});

describe('adding a card', () => {
  const renderWith = (create: (column: string, title: string) => void) =>
    render(
      <BoardView
        workspace={workspace}
        board={board}
        filters={NO_FILTERS}
        actions={{ move: () => {}, create }}
        onOpenCard={() => {}}
      />,
    );

  it('creates in the column it was opened from, and stays open for the next one', () => {
    const created: { column: string; title: string }[] = [];
    renderWith((column, title) => created.push({ column, title }));

    const todo = screen.getByRole('region', { name: 'To Do' });
    fireEvent.click(within(todo).getByRole('button', { name: /add a card/i }));
    const input = within(todo).getByLabelText(/new card in To Do/i);
    fireEvent.change(input, { target: { value: '  Write the tests  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(created).toEqual([{ column: 'todo', title: 'Write the tests' }]);
    expect(within(todo).getByLabelText(/new card in To Do/i)).toBeTruthy();
  });

  it('ignores an empty title', () => {
    const created: string[] = [];
    renderWith((_column, title) => created.push(title));
    const todo = screen.getByRole('region', { name: 'To Do' });
    fireEvent.click(within(todo).getByRole('button', { name: /add a card/i }));
    fireEvent.keyDown(within(todo).getByLabelText(/new card in To Do/i), { key: 'Enter' });
    expect(created).toEqual([]);
  });
});

describe('CardDrawer editing', () => {
  const setup = () => {
    const calls: { kind: string; value: unknown }[] = [];
    const editor = {
      update: (patch: unknown) => calls.push({ kind: 'update', value: patch }),
      move: (input: unknown) => calls.push({ kind: 'move', value: input }),
      archive: () => calls.push({ kind: 'archive', value: null }),
    };
    const card = workspace.cards.find((c) => c.id === 'A1')!;
    render(
      <CardDrawer
        card={card}
        board={board}
        cards={workspace.cards}
        editor={editor as never}
        onClose={() => {}}
        onOpenCard={() => {}}
      />,
    );
    return calls;
  };

  it('renames on Enter', () => {
    const calls = setup();
    fireEvent.click(screen.getByRole('button', { name: /scaffold the web app/i }));
    const input = screen.getByLabelText('Title');
    fireEvent.change(input, { target: { value: 'Scaffold it properly' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(calls).toEqual([{ kind: 'update', value: { title: 'Scaffold it properly' } }]);
  });

  it('abandons a rename on Escape', () => {
    const calls = setup();
    fireEvent.click(screen.getByRole('button', { name: /scaffold the web app/i }));
    const input = screen.getByLabelText('Title');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(calls).toEqual([]);
  });

  // Column changes go through move, not update: the rank has to be recomputed for the new column.
  it('changes column through a move', () => {
    const calls = setup();
    fireEvent.change(screen.getByLabelText('Column'), { target: { value: 'doing' } });
    expect(calls).toEqual([{ kind: 'move', value: { column: 'doing' } }]);
  });

  it('changes priority', () => {
    const calls = setup();
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'P0' } });
    expect(calls).toEqual([{ kind: 'update', value: { priority: 'P0' } }]);
  });

  it('sets an estimate', () => {
    const calls = setup();
    fireEvent.change(screen.getByLabelText('Estimate'), { target: { value: 'M' } });
    expect(calls).toEqual([{ kind: 'update', value: { estimate: 'M' } }]);
  });

  it('toggles a label off when it is already on', () => {
    const calls = setup();
    fireEvent.click(screen.getByRole('button', { name: 'web', pressed: true }));
    expect(calls).toEqual([{ kind: 'update', value: { labels: [] } }]);
  });

  it('saves an edited body', () => {
    const calls = setup();
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: '## New body' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(calls).toEqual([{ kind: 'update', value: { body: '## New body' } }]);
  });

  it('does not archive without a confirmation', () => {
    const calls = setup();
    fireEvent.click(screen.getByRole('button', { name: /archive card/i }));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /^archive$/i }));
    expect(calls).toEqual([{ kind: 'archive', value: null }]);
  });
});

describe('ticking a task in the drawer', () => {
  // Editing the markdown to flip "[ ]" to "[x]" is what the Edit button is for; a box you can see
  // should be a box you can click.
  const tasks = (first: string, second: string, third: string) =>
    ['Acceptance:', '', `- [${first}] first`, `- [${second}] second`, `- [${third}] third`, ''].join('\n');
  const taskWorkspace = parseWorkspace([
    [
      'boards/demo/board.json',
      JSON.stringify({ id: 'demo', name: 'Demo', columns: [{ id: 'todo', name: 'To Do' }], labels: [] }),
    ],
    ['boards/demo/cards/t.md', card('T1', 'Ship it', 'todo', 'a0', '', tasks(' ', 'x', ' '))],
  ]);
  const stored = taskWorkspace.cards[0]!.body;

  const setup = () => {
    const bodies: string[] = [];
    const editor = {
      update: (patch: { body?: string }) => {
        if (patch.body !== undefined) bodies.push(patch.body);
      },
      move: () => {},
      archive: () => {},
    };
    render(
      <CardDrawer
        card={taskWorkspace.cards[0]!}
        board={taskWorkspace.boards[0]!}
        cards={taskWorkspace.cards}
        editor={editor as never}
        onClose={() => {}}
        onOpenCard={() => {}}
      />,
    );
    return bodies;
  };

  it('renders the boxes as live controls', async () => {
    setup();
    const boxes = (await screen.findAllByRole('checkbox')) as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, false]);
    expect(boxes.every((b) => !b.disabled)).toBe(true);
  });

  it('ticks the box that was clicked, and only that one', async () => {
    const bodies = setup();
    const boxes = await screen.findAllByRole('checkbox');
    fireEvent.click(boxes[2]!);
    // The loader trims the body, so build the expectation from what the drawer was given.
    expect(bodies).toEqual([stored.replace('- [ ] third', '- [x] third')]);
  });

  it('clears a ticked box', async () => {
    const bodies = setup();
    const boxes = await screen.findAllByRole('checkbox');
    fireEvent.click(boxes[1]!);
    expect(bodies).toEqual([stored.replace('- [x] second', '- [ ] second')]);
  });
});
