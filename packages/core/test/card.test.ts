import { describe, expect, it } from 'vitest';
import { appendNote, CardParseError, parseCard, serializeCard } from '../src/card.js';
import { cardFileName, slugify } from '../src/paths.js';
import { T0, cardFile } from './fixture.js';

describe('parseCard', () => {
  it('parses frontmatter and body', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'First', column: 'todo', rank: 'a0' }));
    expect(card.id).toBe('C1');
    expect(card.title).toBe('First');
    expect(card.column).toBe('todo');
    expect(card.rank).toBe('a0');
    expect(card.body).toBe('Body text.');
  });

  it('applies defaults for omitted optional keys', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'T', column: 'todo', rank: 'a0' }));
    expect(card.priority).toBe('P2');
    expect(card.labels).toEqual([]);
    expect(card.blockedBy).toEqual([]);
    expect(card.estimate).toBeUndefined();
  });

  it('accepts CRLF line endings', () => {
    const text = cardFile({ id: 'C1', title: 'T', column: 'todo', rank: 'a0' }).replace(
      /\n/g,
      '\r\n',
    );
    const card = parseCard(text);
    expect(card.title).toBe('T');
    expect(card.body).toBe('Body text.');
    expect(card.body).not.toContain('\r');
  });

  it('accepts an unquoted ISO timestamp', () => {
    const text = [
      '---',
      'id: C1',
      'title: T',
      'column: todo',
      "rank: 'a0'",
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-01-01T00:00:00.000Z',
      '---',
      '',
      'Body.',
      '',
    ].join('\n');
    expect(parseCard(text).created).toBe('2026-01-01T00:00:00.000Z');
  });

  it('reports the file path and the offending field on invalid frontmatter', () => {
    const text = ['---', 'id: C1', 'title: T', '---', '', 'Body.'].join('\n');
    expect(() => parseCard(text, 'boards/demo/cards/x.md')).toThrow(CardParseError);
    expect(() => parseCard(text, 'boards/demo/cards/x.md')).toThrow(/boards\/demo\/cards\/x\.md/);
    expect(() => parseCard(text, 'boards/demo/cards/x.md')).toThrow(/column/);
  });

  it('rejects a file with no frontmatter', () => {
    expect(() => parseCard('# Just markdown')).toThrow(/missing YAML frontmatter/);
  });
});

describe('serializeCard', () => {
  it('round-trips without loss', () => {
    const original = parseCard(cardFile({ id: 'C1', title: 'First', column: 'todo', rank: 'a0' }));
    const roundTripped = parseCard(serializeCard(original));
    expect(roundTripped).toEqual(original);
  });

  it('is byte-stable across repeated serialisation', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'First', column: 'todo', rank: 'a0' }));
    const once = serializeCard(card);
    expect(serializeCard(parseCard(once))).toBe(once);
  });

  it('preserves unknown frontmatter keys added by hand', () => {
    const text = cardFile({
      id: 'C1',
      title: 'T',
      column: 'todo',
      rank: 'a0',
      extra: 'myCustomField: hello',
    });
    const card = parseCard(text);
    expect(card.extra).toEqual({ myCustomField: 'hello' });
    expect(serializeCard(card)).toContain('myCustomField: hello');
  });

  it('quotes values that YAML would otherwise reinterpret', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'T', column: 'todo', rank: 'a0' }));
    const text = serializeCard({ ...card, title: 'yes', rank: 'a0' });
    expect(text).toContain("title: 'yes'");
    expect(text).toContain("rank: 'a0'");
    expect(parseCard(text).title).toBe('yes');
  });

  it('quotes a title containing a colon', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'T', column: 'todo', rank: 'a0' }));
    const text = serializeCard({ ...card, title: 'fix: the thing' });
    expect(parseCard(text).title).toBe('fix: the thing');
  });

  it('omits empty collections rather than writing empty lists', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'T', column: 'todo', rank: 'a0' }));
    const text = serializeCard(card);
    expect(text).not.toContain('labels:');
    expect(text).not.toContain('links:');
  });

  it('writes labels inline and links one per line', () => {
    const card = parseCard(cardFile({ id: 'C1', title: 'T', column: 'todo', rank: 'a0' }));
    const text = serializeCard({
      ...card,
      labels: ['bug', 'quick-win'],
      links: ['https://example.com/a', 'https://example.com/b'],
    });
    expect(text).toContain('labels: [bug, quick-win]');
    expect(text).toContain('links:\n  - https://example.com/a\n  - https://example.com/b');
  });
});

describe('appendNote', () => {
  it('creates the Notes section when absent', () => {
    const body = appendNote('## Context\nSomething.', 'found the bug', 'claude', T0);
    expect(body).toContain('## Notes');
    expect(body).toContain('- 2026-01-01 (claude): found the bug');
  });

  it('appends to an existing Notes section', () => {
    const body = appendNote(
      '## Notes\n- 2025-12-31 (haakon): earlier note',
      'later note',
      'claude',
      T0,
    );
    const lines = body.trim().split('\n');
    expect(lines.at(-1)).toBe('- 2026-01-01 (claude): later note');
    expect(body).toContain('earlier note');
  });

  it('inserts inside Notes rather than after a following section', () => {
    const body = appendNote(
      '## Notes\n- old note\n\n## Acceptance criteria\n- [ ] thing',
      'new note',
      'claude',
      T0,
    );
    const noteIndex = body.indexOf('new note');
    const headingIndex = body.indexOf('## Acceptance criteria');
    expect(noteIndex).toBeGreaterThan(0);
    expect(noteIndex).toBeLessThan(headingIndex);
  });

  it('flattens multi-line text into a single bullet', () => {
    const body = appendNote('', 'line one\n  line two', 'claude', T0);
    expect(body).toContain('- 2026-01-01 (claude): line one line two');
  });
});

describe('file naming', () => {
  it('slugifies titles', () => {
    expect(slugify('Add dark mode toggle')).toBe('add-dark-mode-toggle');
    expect(slugify('  Fix: Scryfall  timeout!! ')).toBe('fix-scryfall-timeout');
  });

  it('strips accents and drops characters it cannot transliterate', () => {
    expect(slugify('Håndter æøå')).toBe('handter-a');
  });

  it('truncates without leaving a trailing hyphen', () => {
    const slug = slugify('a'.repeat(40) + ' ' + 'b'.repeat(40));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back when a title has no usable characters', () => {
    expect(slugify('???')).toBe('card');
  });

  it('suffixes the filename with the tail of the id', () => {
    expect(cardFileName('Add dark mode', '01K3F9X2QW7B8N4TVZK3F9X2')).toBe(
      'add-dark-mode--k3f9x2.md',
    );
  });
});
