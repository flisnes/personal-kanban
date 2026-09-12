# Personal Kanban — Build Plan

A kanban system for personal projects that runs on free infrastructure, with a browser UI reachable
from any PC and an MCP server so Claude Code sessions can read and modify the boards.

**Primary goal:** open a Claude session in any project folder and say
*"let's pick a thing from this project's kanban board"* — and it just works.

---

## 1. Architecture at a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│  GitHub                                                             │
│                                                                     │
│   personal-kanban  (PUBLIC)          personal-kanban-data (PRIVATE) │
│   ├── apps/web      → GitHub Pages   └── boards/                    │
│   ├── packages/core                        ├── mtg-app/             │
│   └── packages/mcp                         │   ├── board.json       │
│                                            │   └── cards/*.md       │
│        code, no data                       └── geofencer/…          │
│                                                 data, no code       │
└───────────┬──────────────────────────────────────────┬──────────────┘
            │ static site                              │ GitHub API
            ▼                                          │ (read + write)
   ┌────────────────────┐                              │
   │ Browser (any PC,   │──────────────────────────────┘
   │ phone, tablet)     │   fine-grained PAT in localStorage
   └────────────────────┘
                                                       ▲
   ┌────────────────────┐   git pull / commit / push   │
   │ This PC            │──────────────────────────────┘
   │  MCP server ───────▶ local clone of the data repo
   │  Claude Code       │  C:/Users/Haakon/develop/personal-kanban-data
   └────────────────────┘
```

**The core idea: git is the database.** No server, no hosting bill, no auth system to build. Cards
are Markdown files. The web app is a static SPA talking to the GitHub API. The MCP server talks to a
local clone. Git handles sync, history, and (rarely needed) conflict resolution.

### Why this shape

| Requirement | How it is met |
|---|---|
| Free hosting | GitHub Pages (static) + GitHub API. $0 forever. |
| Reachable from any PC | It is a URL. Paste a token once per browser. |
| Claude can read/write boards | MCP server over a local clone — plain file I/O, fast, works offline. |
| Board content stays private | Data lives in a private repo; only the app code is public. |
| History / undo | Every change is a git commit with a real message. |
| No lock-in | Boards are plain Markdown. Worst case you read them in Notepad. |

### The one real trade-off

A free-plan Pages site is world-readable, so the *data* cannot be baked into the site — the browser
must authenticate to the private data repo at runtime with a **fine-grained personal access token**
(scoped to that one repo, Contents: read & write) held in `localStorage`. That means:

- Anyone with access to a browser profile where you pasted the token can reach the data repo.
- Mitigations: scope the token to exactly one repo, set a 90-day expiry, add a "Sign out / forget
  token" button that clears storage, and do not paste it on machines you do not trust.
- Upgrade path if that ever bothers you: a Cloudflare Worker (free tier) as an OAuth broker and API
  proxy, so the browser holds a short-lived session cookie instead of a PAT. Phase 6, optional — and
  cheap to add later *because* all GitHub access goes through one module (§4).

---

## 2. Repositories

### `personal-kanban` (public) — the code

npm workspaces monorepo (npm 11 is already installed; no need for pnpm).

```
personal-kanban/
├── package.json              # workspaces: ["apps/*", "packages/*"]
├── tsconfig.base.json
├── PLAN.md
├── packages/
│   ├── core/                 # shared domain logic — used by BOTH web and mcp
│   │   ├── src/schema.ts     # zod: Card, Board, Column, Priority
│   │   ├── src/card.ts       # parse/serialize markdown + frontmatter
│   │   ├── src/rank.ts       # fractional-index ordering helpers
│   │   ├── src/ops.ts        # pure ops: move, reorder, create, archive → FileChange[]
│   │   ├── src/github.ts     # thin fetch-based GitHub client (runs in Node AND browser)
│   │   └── src/resolve.ts    # cwd / git-remote → board id
│   └── mcp/                  # MCP stdio server (Node)
│       └── src/index.ts
└── apps/
    └── web/                  # Vite + React SPA → GitHub Pages
```

`packages/core` is the keystone. One zod schema, one set of mutation operations, one GitHub client —
shared by the MCP server and the web app. Divergence between "what Claude does" and "what the UI
does" is the main way a project like this rots; a shared core prevents it structurally.

### `personal-kanban-data` (private) — the boards

```
personal-kanban-data/
├── boards/
│   ├── mtg-app/
│   │   ├── board.json
│   │   └── cards/
│   │       ├── add-dark-mode--k3f9x2.md
│   │       └── fix-scryfall-timeout--m8p1qa.md
│   └── geofencer/
│       ├── board.json
│       └── cards/
└── archive/
    └── mtg-app/cards/…       # done/dropped cards, moved out of the hot path
```

---

## 3. Data model

### `board.json`

```json
{
  "id": "mtg-app",
  "name": "MTG App",
  "projectPaths": ["C:/Users/Haakon/develop/mtg_app"],
  "gitRemotes": ["github.com/hflisnes/mtg-app"],
  "columns": [
    { "id": "backlog", "name": "Backlog" },
    { "id": "todo",    "name": "To Do",       "wipLimit": 8 },
    { "id": "doing",   "name": "In Progress", "wipLimit": 2 },
    { "id": "review",  "name": "Review" },
    { "id": "done",    "name": "Done",        "autoArchiveAfterDays": 14 }
  ],
  "labels": [
    { "id": "bug",       "color": "#ef4444" },
    { "id": "feature",   "color": "#3b82f6" },
    { "id": "chore",     "color": "#a3a3a3" },
    { "id": "quick-win", "color": "#22c55e" }
  ]
}
```

`projectPaths` and `gitRemotes` are what make *"this project's board"* work: the MCP server matches
the session's working directory or git remote against every board and picks the right one with no
argument from you.

### Card file — `boards/mtg-app/cards/add-dark-mode--k3f9x2.md`

```markdown
---
id: 01K3F9X2QW7B8N4TVZ
title: Add dark mode toggle
column: todo
rank: "a0V"
priority: P2
labels: [feature, quick-win]
estimate: S
created: 2026-09-11T10:12:00Z
updated: 2026-09-11T10:12:00Z
blockedBy: []
links:
  - https://github.com/hflisnes/mtg-app/issues/42
---

## Context
System theme is ignored; the card images wash out at night.

## Acceptance criteria
- [ ] Respects `prefers-color-scheme` by default
- [ ] Manual override persisted
- [ ] No flash of light theme on load

## Notes
- 2026-09-11 (claude): existing colors are hardcoded in `theme.dart:14-88`.
```

**Decisions baked into that file, and why:**

- **One file per card, not one JSON per board.** Two cards edited on two machines merge cleanly
  instead of colliding on one big file. Git diffs become readable ("moved card X to doing"), and
  Claude can read one card without loading the whole board.
- **ID is a ULID** (`ulid` package) — sortable, collision-free, generated identically by the web app
  and the MCP server with no coordination.
- **Filename is `slug--<id suffix>.md`** so the data repo is pleasant to browse, but the filename is
  *cosmetic*: renaming a card title does **not** rename the file. No churn, no broken references.
- **`rank` is a fractional index** (`fractional-indexing` package, the Figma/Rocicorp approach).
  Dropping a card between two others computes a string strictly between their ranks, so a reorder
  rewrites **one file**, never the whole column. This is what keeps drag-and-drop from producing
  20-file commits and merge conflicts.
- **Body is free Markdown.** Acceptance criteria as checkboxes, plus a running `## Notes` log that
  Claude appends session findings to. This is the part that makes the board useful *to an agent*
  rather than just a pretty list of titles.

---

## 4. Reading and writing from the browser

Both are worth getting right up front, because the naive approach is either painfully slow or
silently lossy.

**Reading — one GraphQL request for the entire board set.** The REST Contents API would need one
request per card file. GitHub's GraphQL API can return a directory tree *with blob contents inline*:

```graphql
query($owner:String!, $repo:String!) {
  repository(owner:$owner, name:$repo) {
    defaultBranchRef { target { oid } }
    object(expression: "HEAD:boards") {
      ... on Tree { entries { name object {
        ... on Tree { entries { name object {
          ... on Blob { text }
          ... on Tree { entries { name object { ... on Blob { text } } } }
        } } }
      } } }
    }
  }
}
```

One round trip, whole board set, roughly 50–200 KB. Fall back to the repo zipball
(`GET /repos/{owner}/{repo}/zipball`, unzipped with `fflate`) if a board ever grows past a few
hundred cards.

**Writing — always a real commit, never a blind overwrite.** Every mutation goes through one helper
in `core/github.ts`:

```ts
commitFiles({
  parentSha,                      // the commit the UI was looking at
  message: 'move "Add dark mode" → doing',
  changes: [ { path, content }, { path, delete: true } ],
})
// → create blobs → build tree → create commit → update ref  (atomic, multi-file)
```

Passing `parentSha` is the concurrency control. If the ref has moved since you loaded — because you
edited from your laptop, or Claude pushed from this PC — the ref update is rejected, the app
refetches, replays your operation against fresh state, and shows a quiet "board updated elsewhere"
toast. Because operations are file-scoped and ranks are fractional, replay essentially always
succeeds without you noticing.

**Staying fresh:** poll `GET /repos/{owner}/{repo}/commits?per_page=1` every 45s with an `ETag`.
Conditional requests that return `304` do not count against the 5,000/hour authenticated rate limit,
so this is effectively free. If the sha changed, refetch.

**Feel:** all mutations are optimistic — local state updates instantly and the commit happens in a
background queue (serialized, so two fast drags cannot race). A small indicator shows
syncing / synced / conflict. The UI must never block on a network round trip.

---

## 5. Stack choices

### Web app (`apps/web`)

| Concern | Choice | Why |
|---|---|---|
| Build | **Vite 7** | Instant HMR, trivial static output, first-class Pages story via `base`. |
| UI | **React 19 + TypeScript** | Shares zod types with core; the drag-and-drop ecosystem lives here. |
| Drag & drop | **@dnd-kit/core + /sortable** | The library React consolidated around after react-beautiful-dnd went unmaintained. Headless, and — importantly — keyboard and screen-reader accessible out of the box, so cards are movable without a mouse. |
| Styling | **Tailwind CSS v4** | Fast to iterate on; a kanban board is 90% layout. |
| Components | **shadcn/ui** (selective) | Just the dialog / dropdown / command-palette primitives. Copy-in, not a dependency. |
| Server state | **TanStack Query v5** | Polling, caching, background refetch, optimistic mutations — exactly this problem. |
| Local state | **zustand** | Small store for drag state, filters, the write queue. |
| Markdown | **react-markdown + remark-gfm** | Card bodies, with working task checkboxes. |
| Search | **Fuse.js** | Fuzzy search over titles, labels, bodies. ~5 KB. |
| Routing | **hash-based (`#/board/mtg-app`)** | GitHub Pages 404s on SPA deep links; hash routing sidesteps it with zero config. |
| Mobile | **vite-plugin-pwa** | Installable on your phone, caches the last board for offline reading. |
| GitHub access | **hand-rolled `fetch` client in core** | ~150 lines, zero deps, runs in both Node and the browser. Octokit is ~100 KB for features we do not need. |

### MCP server (`packages/mcp`)

Built on the current TypeScript SDK (checked against the SDK docs rather than recalled — the package
and entry point changed from the older `@modelcontextprotocol/sdk` shape):

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

function createServer(): McpServer {
  const server = new McpServer({ name: 'kanban', version: '1.0.0' });

  server.registerTool('get_board', {
    description: 'List cards on a board, grouped by column',
    inputSchema: z.object({
      board:  z.string().optional().describe('Board id; defaults to the board matching cwd'),
      column: z.string().optional(),
    }),
  }, async ({ board, column }) => { /* … */ });

  return server;
}

void serveStdio(createServer);
console.error('kanban MCP server on stdio');   // stdout is the protocol channel — never log there
```

Install once, globally, so every project gets it:

```bash
claude mcp add kanban --scope user -- node C:/Users/Haakon/develop/personal-kanban/packages/mcp/dist/index.js
```

---

## 6. MCP tool surface

Designed around *token economy* — Claude should be able to survey a board in a few hundred tokens
and pull full card bodies only for what it is actually working on.

**Read**

| Tool | Notes |
|---|---|
| `list_boards()` | All boards plus card counts. |
| `get_board({ board?, column?, label? })` | Compact: id, title, column, priority, labels, blocked. **No bodies.** |
| `get_card({ id })` | Full markdown, including the notes log. |
| `search_cards({ query, board? })` | Fuzzy across all boards. |
| `board_stats({ board })` | Counts per column, WIP-limit breaches, stale cards. |
| `suggest_next({ board?, count = 3 })` | Returns candidates **with their raw signals** (priority, age, blocked-by state, estimate, WIP headroom) and lets Claude do the judging. The tool ranks; the model reasons. |

**Write** — each one auto-commits with a descriptive message.

| Tool | Notes |
|---|---|
| `create_card({ board?, title, body?, column?, priority?, labels? })` | |
| `update_card({ id, ...patch })` | Partial; bumps `updated`. |
| `move_card({ id, column, before?, after? })` | Computes the fractional rank. One file touched. |
| `reorder_cards({ board, column, orderedIds })` | Bulk re-prioritisation in one commit — the "help me prioritize" path. |
| `add_note({ id, text })` | Appends a timestamped line to `## Notes`. **The session-journal tool**: Claude records what it found, the next session picks it up. |
| `archive_card({ id })` / `delete_card({ id })` | Archive moves the file under `archive/`. |
| `sync({ push? })` | `git pull --rebase`, commit, push. |

**Resources** — `kanban://boards/{id}` renders a board as readable markdown, so you can `@`-mention a
whole board into context.

**Prompts** — `plan-session` ("survey the board, propose what to work on, justify the pick") and
`groom-backlog` ("find stale, duplicate, vague, or mis-prioritized cards").

**Automatic board detection.** On any call with no `board` argument: match `cwd` against every
board's `projectPaths`, then the session's `git remote get-url origin` against `gitRemotes`, then
fall back to `$KANBAN_BOARD`. If nothing matches, return the board list and ask which — rather than
guessing wrong.

**Sync policy.** `git pull --rebase` before any read older than ~60s; commit immediately on every
write; push debounced (~10s) so a burst of edits becomes a few commits instead of thirty. Conflicts
are rare by construction (one file per card) and rebase resolves the rest.

---

## 7. Build phases

Deliberately ordered so your **primary goal ships first**. After Phase 2 — roughly two days in —
"pick a thing from this project's board" works end to end, and the web UI is a bonus on top of a
system that already earns its keep.

### Phase 0 — Foundations (~half a day)
- Create both repos (`gh repo create`), npm workspaces, shared tsconfig, ESLint + Prettier.
- `packages/core`: zod schema, card parse/serialize (`gray-matter`), rank helpers, pure ops.
- Vitest unit tests for rank math and card round-tripping — the two places subtle bugs hide.
- Seed `personal-kanban-data` with two real boards (this project plus an existing one, e.g. `mtg_app`).

*Done when:* `npm test` is green and core can load a board from disk and emit a valid file change set.

### Phase 1 — MCP server, filesystem only (~1 day)
- All tools from §6 against the local clone. No git yet.
- Board auto-detection from cwd / git remote.
- Register with `claude mcp add --scope user`.

*Done when:* in `~/develop/mtg_app`, "what's on my board?" and "create a card for X, put it after Y"
both work without you naming the board.

### Phase 2 — Git sync (~half a day)
- Auto pull/commit/push in the MCP server (`simple-git`), debounced push, rebase on conflict.
- Data repo pushed to GitHub, private.

*Done when:* a card created by Claude shows up in the GitHub web view within seconds, with a sensible
commit message.

### Phase 3 — Web app, read-only (~1 day)
- Vite + React scaffold, token setup screen, GraphQL board loader, board switcher.
- Column layout, card rendering, card detail drawer with rendered markdown.
- Filters (label, priority) and fuzzy search.
- GitHub Actions workflow deploying to Pages on push to `main`.

*Done when:* `https://<you>.github.io/personal-kanban` shows your real boards from your phone.

### Phase 4 — Web app, writes (~1 day)
- dnd-kit drag between and within columns; keyboard move as a first-class path, not an afterthought.
- Optimistic updates, serialized commit queue, conflict replay.
- Create / edit / archive cards; inline title edit; markdown body editor.
- ETag polling so the board updates when Claude changes it from this PC.

*Done when:* you drag a card on your phone and the MCP server sees it on the next pull.

### Phase 5 — Polish (~1 day)
- Command palette (`Ctrl-K`), keyboard shortcuts, dark mode.
- WIP-limit warnings, stale-card highlighting, auto-archive of old `done` cards.
- Archive browser, board settings UI, activity feed rendered from `git log`.
- PWA install and offline read.

### Phase 6 — Optional extras, pick as wanted
- **`/kanban` slash command** plus a CLAUDE.md snippet per project, so even non-MCP sessions know the board exists.
- **GitHub Issues two-way sync** for projects that have public issue trackers.
- **Cloudflare Worker token broker** — removes the PAT from browsers entirely (see §1).
- **Metrics**: cycle time and throughput computed from git history. Free, because every move is a commit.
- **Recurring cards**, per-board card templates, a one-command "add a board for this project".

---

## 8. Risks and how each is handled

| Risk | Severity | Handling |
|---|---|---|
| PAT sitting in `localStorage` on a borrowed PC | Medium | Single-repo fine-grained scope, 90-day expiry, explicit sign-out, Worker broker as the Phase-6 fix. |
| Two devices editing simultaneously | Low | `parentSha` check plus replay; one file per card makes true conflicts vanishingly rare. |
| GitHub API rate limit | Very low | 5,000/hr authenticated; ETag polling returns 304s that do not count. |
| Board grows to hundreds of cards, load slows | Low | Auto-archive `done`; zipball loader as the fallback path. |
| MCP server and web app drift apart | **Medium — the real one** | All domain logic lives in `packages/core`. Neither surface may implement a mutation of its own. |
| Losing interest before it is useful | Medium | Phase ordering: the thing you actually asked for works after two days, before any UI polish. |
| GitHub outage | Low | The local clone keeps working offline; the MCP server is fully functional without network. |

---

## 9. Alternatives considered

- **GitHub Projects v2** — free, hosted, has a GraphQL API and a `gh project` CLI. Genuinely the
  "don't build anything" answer, and worth naming honestly. Rejected because card bodies cannot hold
  a structured agent-readable notes log, the API is awkward for reordering, and you would end up
  building an MCP wrapper around someone else's data model anyway. If you would rather not maintain
  this, that is the fallback.
- **Cloudflare Pages + Workers + D1** — a real backend on a free tier, proper auth, no PAT in the
  browser. Better long-term architecture, but it introduces a database, migrations, and a deploy
  target, and it makes the boards *not* plain files — which is precisely what makes them good for
  Claude and for git history. Kept as an upgrade path behind the single `core/github.ts` seam.
- **Supabase / Neon + Vercel** — same objection, plus free tiers that sleep or expire.
- **Obsidian plus a kanban plugin** — excellent local UX, no browser-from-anywhere story, and sync
  costs money.
- **Local-only SQLite plus a tiny server** — simplest to build, fails the "reach it from any PC"
  requirement, which was explicit.

---

## 10. Costs and prerequisites

**Cost: $0.** GitHub Free covers a public code repo, a private data repo, Pages, and Actions.

**Prerequisites:** Node 24 ✓, npm 11 ✓, git ✓, `gh` 2.96 ✓ — all already present. You will need to
mint one fine-grained PAT (scoped to `personal-kanban-data`, Contents: read & write) during Phase 3.

**Estimated effort:** roughly 4–5 focused days total; about 2 days to the first genuinely useful
milestone.
