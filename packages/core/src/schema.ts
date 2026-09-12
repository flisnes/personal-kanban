import { z } from 'zod';

export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'] as const;
export const ESTIMATES = ['XS', 'S', 'M', 'L', 'XL'] as const;

export const PrioritySchema = z.enum(PRIORITIES);
export const EstimateSchema = z.enum(ESTIMATES);

export type Priority = z.infer<typeof PrioritySchema>;
export type Estimate = z.infer<typeof EstimateSchema>;

/**
 * Card frontmatter. Parsing is deliberately permissive about unknown keys: these files get
 * hand-edited, and silently dropping someone's custom key on the next write would be rude.
 * Unknown keys are captured into `extra` and written back out (see card.ts).
 */
export const CardMetaSchema = z.looseObject({
  id: z.string().min(1),
  title: z.string().min(1),
  column: z.string().min(1),
  rank: z.string().min(1),
  priority: PrioritySchema.default('P2'),
  labels: z.array(z.string()).default([]),
  estimate: EstimateSchema.optional(),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
  blockedBy: z.array(z.string()).default([]),
  links: z.array(z.string()).default([]),
});

export interface CardMeta {
  id: string;
  title: string;
  column: string;
  rank: string;
  priority: Priority;
  labels: string[];
  estimate?: Estimate;
  created: string;
  updated: string;
  blockedBy: string[];
  links: string[];
}

/** Frontmatter keys we know about, in the order they are written to disk. */
export const CARD_META_KEYS = [
  'id',
  'title',
  'column',
  'rank',
  'priority',
  'labels',
  'estimate',
  'created',
  'updated',
  'blockedBy',
  'links',
] as const;

export interface Card extends CardMeta {
  /** Markdown body below the frontmatter. */
  body: string;
  /** Unrecognised frontmatter keys, preserved verbatim across a read/write cycle. */
  extra?: Record<string, unknown>;
}

/** A card plus where it lives. Ops need both to emit file changes. */
export interface LoadedCard extends Card {
  boardId: string;
  /** Repo-relative path, e.g. `boards/mtg-app/cards/add-dark-mode--k3f9x2.md`. */
  path: string;
}

export const ColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  wipLimit: z.number().int().positive().optional(),
  autoArchiveAfterDays: z.number().int().positive().optional(),
});

export const LabelSchema = z.object({
  id: z.string().min(1),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'expected a hex colour like #3b82f6')
    .default('#a3a3a3'),
});

export const BoardSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'board ids are lowercase kebab-case'),
  name: z.string().min(1),
  /** Absolute filesystem paths of projects this board belongs to (for cwd auto-detection). */
  projectPaths: z.array(z.string()).default([]),
  /** Git remotes of projects this board belongs to, any format; normalised on comparison. */
  gitRemotes: z.array(z.string()).default([]),
  columns: z.array(ColumnSchema).min(1),
  labels: z.array(LabelSchema).default([]),
});

export type Column = z.infer<typeof ColumnSchema>;
export type Label = z.infer<typeof LabelSchema>;
export type Board = z.infer<typeof BoardSchema>;

export const DEFAULT_COLUMNS: Column[] = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'doing', name: 'In Progress', wipLimit: 2 },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done', autoArchiveAfterDays: 30 },
];
