import { GitHubClient } from '@kanban/core';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { BoardStore, type BoardSnapshot } from './boardStore.js';
import type { Credentials } from './credentials.js';

export interface Board {
  store: BoardStore;
  state: BoardSnapshot;
}

/**
 * One store per credential set, loaded on mount and polled while the tab is open. `GitHubClient`
 * already has the shape the store wants, so it is passed straight in as the backend.
 */
export function useBoard(credentials: Credentials): Board {
  const store = useMemo(
    () => new BoardStore(new GitHubClient(credentials)),
    [credentials.owner, credentials.repo, credentials.token],
  );

  useEffect(() => {
    void store.load();
    const stop = store.start();
    // A tab left open on a phone misses every poll while backgrounded; catch up on return.
    const onFocus = (): void => void store.poll();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      stop();
    };
  }, [store]);

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { store, state };
}
