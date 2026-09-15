import type { LoadedCard, MoveCardInput, UpdateCardPatch } from '@kanban/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BoardView, type BoardActions, type Filters } from './components/BoardView.js';
import { CardDrawer, type CardEditor } from './components/CardDrawer.js';
import { MOVE_HINT_ID } from './components/CardTile.js';
import { SetupScreen } from './components/SetupScreen.js';
import { Toolbar } from './components/Toolbar.js';
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  type Credentials,
} from './lib/credentials.js';
import {
  archiveCardIntent,
  createCardIntent,
  moveCardIntent,
  updateCardIntent,
} from './lib/intents.js';
import { useBoard } from './lib/useBoard.js';
import { useHashRoute } from './lib/useHashRoute.js';

const NO_FILTERS: Filters = { query: '', label: null, priority: null };

export function App(): React.ReactElement {
  const [credentials, setCredentials] = useState<Credentials | null>(() => loadCredentials());

  if (!credentials) {
    return (
      <SetupScreen
        onConnect={(next) => {
          saveCredentials(next);
          setCredentials(next);
        }}
      />
    );
  }

  return (
    <Board
      credentials={credentials}
      onSignOut={() => {
        clearCredentials();
        setCredentials(null);
      }}
    />
  );
}

function Board({
  credentials,
  onSignOut,
}: {
  credentials: Credentials;
  onSignOut: () => void;
}): React.ReactElement {
  const { store, state } = useBoard(credentials);
  const [route, navigate] = useHashRoute();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const workspace = state.workspace;
  const boards = workspace?.boards ?? [];
  const board = boards.find((b) => b.id === route.boardId) ?? boards[0];
  const boardId = board?.id;

  // Keep the URL honest, so a reload or a shared link lands on the same board.
  useEffect(() => {
    if (boardId !== undefined && route.boardId !== boardId) navigate(boardId, route.cardId);
  }, [boardId, route.boardId, route.cardId, navigate]);

  const actions = useMemo<BoardActions>(
    () => ({
      move: (card: LoadedCard, input: MoveCardInput) =>
        store.enqueue(moveCardIntent(card.id, card.title, input)),
      create: (columnId: string, title: string) => {
        if (boardId === undefined) return;
        store.enqueue(createCardIntent({ boardId, title, column: columnId }));
      },
    }),
    [store, boardId],
  );

  const openCard = route.cardId
    ? workspace?.cards.find(
        (c) => c.id === route.cardId || c.id.toLowerCase().endsWith(route.cardId!.toLowerCase()),
      )
    : undefined;

  const editor = useMemo<CardEditor>(
    () => ({
      update: (patch: UpdateCardPatch) => {
        if (openCard) store.enqueue(updateCardIntent(openCard.id, openCard.title, patch));
      },
      move: (input: MoveCardInput) => {
        if (openCard) store.enqueue(moveCardIntent(openCard.id, openCard.title, input));
      },
      archive: () => {
        if (openCard) store.enqueue(archiveCardIntent(openCard.id, openCard.title));
      },
    }),
    [store, openCard],
  );

  const refresh = useCallback(() => void store.load(), [store]);

  if (state.loading) return <Centered>Loading board…</Centered>;

  if (state.loadError) {
    return (
      <Centered>
        <p className="font-medium">Could not load the board.</p>
        <p className="mt-1 text-sm text-[--color-muted]">{state.loadError.message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-lg border border-[--color-line] px-3 py-1.5 text-sm"
          >
            Use a different token
          </button>
        </div>
      </Centered>
    );
  }

  if (!workspace || !board) {
    return (
      <Centered>
        <p className="font-medium">
          No boards in {credentials.owner}/{credentials.repo}.
        </p>
        <p className="mt-1 text-sm text-[--color-muted]">
          Expected at least one <code>boards/&lt;id&gt;/board.json</code>.
        </p>
      </Centered>
    );
  }

  const boardIssues = workspace.issues.filter((i) => i.path.includes(`/${board.id}/`));

  return (
    <div className="flex h-dvh flex-col">
      <Toolbar
        boards={boards}
        board={board}
        filters={filters}
        state={state}
        onFilters={setFilters}
        onSelectBoard={(id) => navigate(id)}
        onRefresh={refresh}
        onRetry={() => store.retry()}
        onDiscard={() => store.discardPending()}
        onSignOut={onSignOut}
      />

      {boardIssues.length > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>{boardIssues.length} file(s) need attention.</strong> {boardIssues[0]?.path}:{' '}
          {boardIssues[0]?.message}
          {boardIssues.length > 1 && ` (+${boardIssues.length - 1} more)`}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden pt-2">
        <BoardView
          workspace={workspace}
          board={board}
          filters={filters}
          actions={actions}
          onOpenCard={(id) => navigate(board.id, id)}
        />
      </main>

      {/* Referenced by every card, so the move keys are discoverable to a screen reader. */}
      <p id={MOVE_HINT_ID} className="sr-only">
        Arrow keys move between cards. Hold shift to move this card. Enter opens it.
      </p>

      {openCard && (
        <CardDrawer
          key={openCard.id}
          card={openCard}
          board={board}
          cards={workspace.cards}
          editor={editor}
          onClose={() => navigate(board.id)}
          onOpenCard={(id) => navigate(board.id, id)}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}
