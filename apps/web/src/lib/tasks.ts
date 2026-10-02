/**
 * GFM task-list items, as they appear in a card body: a bullet or ordered marker, then `[ ]` or
 * `[x]`. The same pattern decides what the tile counts and what a click in the drawer flips, so
 * the "2/5 done" on a card can never disagree with the boxes that toggle.
 */
const TASK_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/;

export function countTasks(body: string): { done: number; total: number } | null {
  let done = 0;
  let total = 0;
  for (const line of body.split('\n')) {
    const match = TASK_ITEM.exec(line);
    if (!match) continue;
    total += 1;
    if (match[2] !== ' ') done += 1;
  }
  return total === 0 ? null : { done, total };
}

/**
 * Flip the task on a 1-based line of `body`, or return null if that line is not a task item —
 * the renderer's idea of where the box sits is trusted, but never acted on blindly.
 */
export function toggleTask(body: string, line: number): string | null {
  const lines = body.split('\n');
  const text = lines[line - 1];
  if (text === undefined) return null;
  const match = TASK_ITEM.exec(text);
  if (!match) return null;
  const box = match[2] === ' ' ? '[x]' : '[ ]';
  lines[line - 1] = `${match[1]}${box}${text.slice(match[0].length)}`;
  return lines.join('\n');
}
