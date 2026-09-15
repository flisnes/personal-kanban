import { useCallback, useEffect, useState } from 'react';

export interface Route {
  boardId?: string;
  cardId?: string;
}

/**
 * Hash routing, not history routing. GitHub Pages serves static files, so a deep link like
 * /personal-kanban/board/mtg-app would 404 on reload; `#/board/mtg-app` never reaches the server.
 */
function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const route: Route = {};
  if (parts[0] === 'board' && parts[1]) route.boardId = decodeURIComponent(parts[1]);
  if (parts[2] === 'card' && parts[3]) route.cardId = decodeURIComponent(parts[3]);
  return route;
}

export function buildHash(boardId?: string, cardId?: string): string {
  if (!boardId) return '#/';
  const base = `#/board/${encodeURIComponent(boardId)}`;
  return cardId ? `${base}/card/${encodeURIComponent(cardId)}` : base;
}

export function useHashRoute(): [Route, (boardId?: string, cardId?: string) => void] {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = (): void => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((boardId?: string, cardId?: string) => {
    window.location.hash = buildHash(boardId, cardId);
  }, []);

  return [route, navigate];
}
