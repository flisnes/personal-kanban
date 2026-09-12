import { parse as yamlParse } from 'yaml';
import { CARD_META_KEYS, CardMetaSchema, type Card } from './schema.js';
import { emitBlockList, emitFlowList, emitQuoted, emitScalar, emitUnknown } from './yaml-emit.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

export class CardParseError extends Error {
  constructor(
    message: string,
    readonly path?: string,
    options?: ErrorOptions,
  ) {
    super(path ? `${path}: ${message}` : message, options);
    this.name = 'CardParseError';
  }
}

/**
 * Parse a card file. Tolerates CRLF (these files are written on Windows and by a browser),
 * missing optional keys, and unknown keys — the latter are preserved for the round trip.
 */
export function parseCard(text: string, path?: string): Card {
  const match = FRONTMATTER.exec(text.replace(/^﻿/, ''));
  if (!match?.[1]) {
    throw new CardParseError('missing YAML frontmatter delimited by --- lines', path);
  }

  let raw: unknown;
  try {
    raw = yamlParse(match[1]);
  } catch (cause) {
    throw new CardParseError('frontmatter is not valid YAML', path, { cause });
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CardParseError('frontmatter must be a YAML mapping', path);
  }

  // YAML may hand back Date objects for unquoted timestamps depending on the schema in play;
  // normalise before validation so both quoted and unquoted forms are accepted.
  const normalised: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    normalised[key] = value instanceof Date ? value.toISOString() : value;
  }

  const result = CardMetaSchema.safeParse(normalised);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new CardParseError(`invalid frontmatter — ${issues}`, path);
  }

  const known = new Set<string>(CARD_META_KEYS);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result.data)) {
    if (!known.has(key)) extra[key] = value;
  }

  const meta = result.data;
  const card: Card = {
    id: meta.id,
    title: meta.title,
    column: meta.column,
    rank: meta.rank,
    priority: meta.priority,
    labels: meta.labels,
    ...(meta.estimate !== undefined ? { estimate: meta.estimate } : {}),
    created: meta.created,
    updated: meta.updated,
    blockedBy: meta.blockedBy,
    links: meta.links,
    body: (match[2] ?? '').replace(/\r\n/g, '\n').replace(/^\n+/, '').trimEnd(),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
  return card;
}

/** Serialise a card. Always LF, always the same key order, always the same quoting. */
export function serializeCard(card: Card): string {
  const lines: string[] = [
    emitScalar('id', card.id),
    emitScalar('title', card.title),
    emitScalar('column', card.column),
    emitQuoted('rank', card.rank),
    emitScalar('priority', card.priority),
  ];

  if (card.labels.length > 0) lines.push(emitFlowList('labels', card.labels));
  if (card.estimate !== undefined) lines.push(emitScalar('estimate', card.estimate));
  lines.push(emitScalar('created', card.created), emitScalar('updated', card.updated));
  if (card.blockedBy.length > 0) lines.push(emitFlowList('blockedBy', card.blockedBy));
  if (card.links.length > 0) lines.push(emitBlockList('links', card.links));

  for (const [key, value] of Object.entries(card.extra ?? {})) {
    lines.push(emitUnknown(key, value));
  }

  const body = card.body.replace(/\r\n/g, '\n').trim();
  return `---\n${lines.join('\n')}\n---\n\n${body}${body.length > 0 ? '\n' : ''}`;
}

const NOTES_HEADING = '## Notes';

/**
 * Append a dated line to the card's `## Notes` section, creating the section if absent.
 *
 * This is the bit that makes a board useful to an agent rather than to a human alone: a session
 * records what it learned, and the next session — days later, fresh context — reads it back.
 */
export function appendNote(body: string, text: string, author: string, when: Date): string {
  const day = when.toISOString().slice(0, 10);
  const entry = `- ${day} (${author}): ${text.trim().replace(/\s*\n\s*/g, ' ')}`;
  const trimmed = body.trimEnd();

  if (!trimmed.includes(NOTES_HEADING)) {
    return `${trimmed}${trimmed.length > 0 ? '\n\n' : ''}${NOTES_HEADING}\n${entry}\n`;
  }

  const lines = trimmed.split('\n');
  const headingIndex = lines.findIndex((line) => line.trim() === NOTES_HEADING);
  // Insert at the end of the Notes section: just before the next heading, or at the end.
  let insertAt = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i] ?? '')) {
      insertAt = i;
      break;
    }
  }
  while (insertAt > headingIndex + 1 && (lines[insertAt - 1] ?? '').trim() === '') insertAt--;
  lines.splice(insertAt, 0, entry);
  return `${lines.join('\n')}\n`;
}
