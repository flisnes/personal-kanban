import { stringify as yamlStringify } from 'yaml';

/**
 * A deliberately small, deterministic YAML emitter for card frontmatter.
 *
 * Parsing uses the real `yaml` library (files get hand-edited, so reads must be permissive), but
 * writing goes through here instead. When git is the database, byte-stable output matters: the
 * same card must always serialise identically, or every save produces spurious diff noise and
 * avoidable merge conflicts. A general-purpose emitter gives no such guarantee across versions.
 */

const NEEDS_QUOTING =
  /^$|^[-?:,[\]{}#&*!|>'"%@`]|: |\s#|^\s|\s$|^(?:true|false|null|yes|no|on|off|~)$/i;
const LOOKS_NUMERIC = /^[+-]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const LOOKS_TEMPORAL = /^\d{4}-\d{2}-\d{2}/;

export function quoteScalar(value: string): string {
  const needsQuotes =
    NEEDS_QUOTING.test(value) || LOOKS_NUMERIC.test(value) || LOOKS_TEMPORAL.test(value);
  if (!needsQuotes) return value;
  // Single-quoted YAML scalars only need '' doubling — no backslash escapes to get wrong.
  return `'${value.replace(/'/g, "''")}'`;
}

/** `key: [a, b]` — for short lists like labels, where a one-line diff is the readable one. */
export function emitFlowList(key: string, items: readonly string[]): string {
  return `${key}: [${items.map(quoteScalar).join(', ')}]`;
}

/** `key:\n  - a\n  - b` — for long values like URLs, where per-item diffs are the readable ones. */
export function emitBlockList(key: string, items: readonly string[]): string {
  return [`${key}:`, ...items.map((item) => `  - ${quoteScalar(item)}`)].join('\n');
}

export function emitScalar(key: string, value: string): string {
  return `${key}: ${quoteScalar(value)}`;
}

/**
 * Always-quoted scalar, for opaque machine-generated values such as the sort rank. Quoting
 * unconditionally keeps output stable no matter what the generator emits, and signals to anyone
 * reading the file by hand that the value is a string to leave alone.
 */
export function emitQuoted(key: string, value: string): string {
  return `${key}: '${value.replace(/'/g, "''")}'`;
}

/** Fallback for unrecognised frontmatter keys we are preserving but do not model. */
export function emitUnknown(key: string, value: unknown): string {
  const rendered = yamlStringify({ [key]: value }, { lineWidth: 0 }).trimEnd();
  return rendered;
}
