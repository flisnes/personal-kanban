export const BOARDS_DIR = 'boards';
export const ARCHIVE_DIR = 'archive';

export const boardDir = (boardId: string): string => `${BOARDS_DIR}/${boardId}`;
export const boardConfigPath = (boardId: string): string => `${boardDir(boardId)}/board.json`;
export const cardsDir = (boardId: string): string => `${boardDir(boardId)}/cards`;
export const cardPath = (boardId: string, fileName: string): string =>
  `${cardsDir(boardId)}/${fileName}`;
export const archiveCardPath = (boardId: string, fileName: string): string =>
  `${ARCHIVE_DIR}/${boardId}/cards/${fileName}`;

/**
 * Filenames are cosmetic — they make the data repo pleasant to browse, nothing resolves by them.
 * Renaming a card's title therefore does NOT rename its file; the id in the frontmatter is truth.
 */
export function slugify(title: string, maxLength = 48): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'card';
}

export function cardFileName(title: string, id: string): string {
  return `${slugify(title)}--${id.slice(-6).toLowerCase()}.md`;
}

/** Split a repo-relative path into its segments, tolerating either slash style. */
export function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((s) => s.length > 0);
}
