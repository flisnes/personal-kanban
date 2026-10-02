import { describe, expect, it } from 'vitest';
import { countTasks, toggleTask } from '../src/lib/tasks.js';

const BODY = [
  'Steps:',
  '',
  '- [ ] one',
  '  - [x] nested',
  '* [X] star',
  '1. [ ] ordered',
  '- not a task',
  '',
].join('\n');

describe('countTasks', () => {
  it('counts every flavour of task item and nothing else', () => {
    expect(countTasks(BODY)).toEqual({ done: 2, total: 4 });
  });

  it('is null when there are no tasks, so the tile shows nothing', () => {
    expect(countTasks('Just prose.\n\n- a plain bullet')).toBeNull();
  });
});

describe('toggleTask', () => {
  const line = (body: string | null, n: number) => body?.split('\n')[n - 1];

  it('ticks an open box, keeping indentation and the rest of the line', () => {
    expect(line(toggleTask(BODY, 3), 3)).toBe('- [x] one');
    expect(line(toggleTask(BODY, 4), 4)).toBe('  - [ ] nested');
  });

  it('clears a ticked box whichever case it was written in', () => {
    expect(line(toggleTask(BODY, 5), 5)).toBe('* [ ] star');
  });

  it('handles ordered items', () => {
    expect(line(toggleTask(BODY, 6), 6)).toBe('1. [x] ordered');
  });

  it('changes only the line asked for', () => {
    const before = BODY.split('\n');
    const after = toggleTask(BODY, 3)!.split('\n');
    expect(after.length).toBe(before.length);
    before.forEach((text, i) => {
      if (i !== 2) expect(after[i]).toBe(text);
    });
  });

  it('refuses a line that is not a task item', () => {
    expect(toggleTask(BODY, 1)).toBeNull();
    expect(toggleTask(BODY, 7)).toBeNull();
    expect(toggleTask(BODY, 99)).toBeNull();
  });

  it('keeps CRLF bodies intact', () => {
    expect(toggleTask('- [ ] a\r\n- [ ] b\r\n', 2)).toBe('- [ ] a\r\n- [x] b\r\n');
  });
});
