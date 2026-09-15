import { useEffect, useState } from 'react';
import { BoardView, type Filters } from './components/BoardView.js';
import { CardDrawer } from './components/CardDrawer.js';
import { SetupScreen } from './components/SetupScreen.js';
import { Toolbar } from './components/Toolbar.js';
import { clearCredentials, loadCredentials, saveCredentials, type Credentials } from './lib/credentials.js';
import { useHashRoute } from './lib/useHashRoute.js';
import { useClient, useWorkspace } from './lib/useWorkspace.js';

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
  const client = useClient(credentials);
  const query = useWorkspace(client);
  const [route, navigate] = useHashRoute();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  const workspace = query.data?.workspace;
  const boards = workspace?.boards ?? [];
  const board = boards.find((b) => b.id === route.boardId) ?? boards[0];

  // Keep the URL honest, so a reload or a shared link lands on the same board.
  useEffect(() => {
    if (board && route.boardId !== board.id) navigate(board.id, route.cardId);
  }, [board, route.boardId, route.cardId, navigate]);

  if (query.isPending) return <Centered>Loading board…</Centered>;

  if (query.isError) {
    const message = query.error instanceof Error ? query.error.message : String(query.error);
    return (
      <Centered>
        <p className="font-medium">Could not load the board.</p>
        <p className="mt-1 text-sm text-[--color-muted]">{message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => void query.refetch()}
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
        <p className="font-medium">No boards in {credentials.owner}/{credentials.repo}.</p>
        <p className="mt-1 text-sm text-[--color-muted]">
          Expected at least one <code>boards/&lt;id&gt;/board.json</code>.
        </p>
      </Centered>
    );
  }

  const openCard = route.cardId
    ? workspace.cards.find((c) => c.id === route.cardId || c.id.toLowerCase().endsWith(route.cardId!.toLowerCase()))
    : undefined;
  const boardIssues = workspace.issues.filter((i) => i.path.includes(`/${board.id}/`));

  return (
    <div className="flex h-dvh flex-col">
      <Toolbar
        boards={boards}
        board={board}
        filters={filters}
        onFilters={setFilters}
        onSelectBoard={(id) => navigate(id)}
        onRefresh={() => void query.refetch()}
        onSignOut={onSignOut}
        refreshing={query.isFetching}
      />

      {boardIssues.length > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900 sm:px-6 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>{boardIssues.length} file(s) need attention.</strong>{' '}
          {boardIssues[0]?.path}: {boardIssues[0]?.message}
          {boardIssues.length > 1 && ` (+${boardIssues.length - 1} more)`}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden pt-2">
        <BoardView
          workspace={workspace}
          board={board}
          filters={filters}
          onOpenCard={(id) => navigate(board.id, id)}
        />
      </main>

      {openCard && (
        <CardDrawer
          card={openCard}
          board={board}
          cards={workspace.cards}
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
