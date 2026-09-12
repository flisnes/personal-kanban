import { describe, expect, it } from 'vitest';
import { normalizePath, normalizeRemote, resolveBoard } from '../src/resolve.js';
import type { Board } from '../src/schema.js';

const board = (id: string, projectPaths: string[] = [], gitRemotes: string[] = []): Board => ({
  id,
  name: id,
  projectPaths,
  gitRemotes,
  columns: [{ id: 'todo', name: 'To Do' }],
  labels: [],
});

const boards = [
  board('mtg-app', ['C:/Users/Haakon/develop/mtg_app'], ['git@github.com:haakon/mtg-app.git']),
  board('geofencer', ['C:/Users/Haakon/develop/geofencer']),
  board('inner', ['C:/Users/Haakon/develop/mtg_app/packages/inner']),
];

describe('normalizePath', () => {
  it('folds separator style, trailing slashes and case', () => {
    expect(normalizePath('C:\\Users\\Haakon\\develop\\Mtg_App\\')).toBe(
      'c:/users/haakon/develop/mtg_app',
    );
  });
});

describe('normalizeRemote', () => {
  it('treats every spelling of the same repo as equal', () => {
    const expected = 'github.com/haakon/mtg-app';
    for (const url of [
      'git@github.com:haakon/mtg-app.git',
      'https://github.com/haakon/mtg-app',
      'https://github.com/haakon/mtg-app.git',
      'ssh://git@github.com/haakon/mtg-app.git',
      'https://haakon@github.com/Haakon/MTG-App.git/',
    ]) {
      expect(normalizeRemote(url)).toBe(expected);
    }
  });
});

describe('resolveBoard', () => {
  it('matches the working directory', () => {
    const result = resolveBoard(boards, { cwd: 'C:\\Users\\Haakon\\develop\\mtg_app' });
    expect(result).toMatchObject({ boardId: 'mtg-app', via: 'cwd' });
  });

  it('matches a subdirectory of a project', () => {
    const result = resolveBoard(boards, { cwd: 'C:/Users/Haakon/develop/mtg_app/lib/ui' });
    expect(result.boardId).toBe('mtg-app');
  });

  it('prefers the most specific project path', () => {
    const result = resolveBoard(boards, {
      cwd: 'C:/Users/Haakon/develop/mtg_app/packages/inner/src',
    });
    expect(result.boardId).toBe('inner');
  });

  it('does not match a sibling directory with a shared prefix', () => {
    const result = resolveBoard(boards, { cwd: 'C:/Users/Haakon/develop/mtg_app_old' });
    expect(result.boardId).toBeUndefined();
  });

  it('falls back to the git remote', () => {
    const result = resolveBoard(boards, {
      cwd: 'C:/Users/Haakon/somewhere/else',
      gitRemote: 'https://github.com/haakon/mtg-app.git',
    });
    expect(result).toMatchObject({ boardId: 'mtg-app', via: 'remote' });
  });

  it('honours an explicit id above everything else', () => {
    const result = resolveBoard(boards, {
      explicit: 'geofencer',
      envBoard: 'mtg-app',
      cwd: 'C:/Users/Haakon/develop/mtg_app',
    });
    expect(result).toMatchObject({ boardId: 'geofencer', via: 'explicit' });
  });

  it('reports an explicit id that does not exist rather than guessing', () => {
    const result = resolveBoard(boards, { explicit: 'typo', cwd: 'C:/Users/Haakon/develop/mtg_app' });
    expect(result.boardId).toBeUndefined();
    expect(result.via).toBe('unresolved');
    expect(result.candidates).toContain('mtg-app');
  });

  it('honours $KANBAN_BOARD above directory matching', () => {
    const result = resolveBoard(boards, {
      envBoard: 'geofencer',
      cwd: 'C:/Users/Haakon/develop/mtg_app',
    });
    expect(result).toMatchObject({ boardId: 'geofencer', via: 'env' });
  });

  it('ignores $KANBAN_BOARD when it names a board that is gone', () => {
    const result = resolveBoard(boards, {
      envBoard: 'deleted',
      cwd: 'C:/Users/Haakon/develop/mtg_app',
    });
    expect(result).toMatchObject({ boardId: 'mtg-app', via: 'cwd' });
  });

  it('uses the only board there is', () => {
    const result = resolveBoard([board('solo')], { cwd: 'C:/anywhere' });
    expect(result).toMatchObject({ boardId: 'solo', via: 'only-board' });
  });

  it('offers the candidates when it cannot tell', () => {
    const result = resolveBoard(boards, { cwd: 'C:/Users/Haakon/develop/unrelated' });
    expect(result.boardId).toBeUndefined();
    expect(result.candidates).toEqual(['mtg-app', 'geofencer', 'inner']);
  });
});
