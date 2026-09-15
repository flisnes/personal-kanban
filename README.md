# personal-kanban

Personal kanban boards for project work: a browser UI reachable from anywhere, and an MCP server
so Claude Code sessions can read and change the same boards.

The point of it: open a session in any project folder and say *"let's pick a thing from this
project's kanban board"*.

Board data lives in a separate private repo ([`personal-kanban-data`](../personal-kanban-data)) as
plain Markdown files. Git is the database — no server, no hosting bill, and every change is a
commit you can read.

See [PLAN.md](./PLAN.md) for the architecture and the build phases.

## Layout

| Package | What it is |
|---|---|
| `packages/core` | Schema, card (de)serialisation, ordering, mutations, board resolution. Shared by everything else — no other package implements a board mutation of its own. |
| `packages/mcp` | MCP stdio server over the local data repo: 14 tools, 2 prompts, a board resource. Commits and pushes board changes as it goes. |
| `apps/web` | Vite + React SPA at [flisnes.github.io/personal-kanban](https://flisnes.github.io/personal-kanban/). Reads *and writes* the private data repo from the browser. |

## Commands

```bash
npm test          # run the test suite
npm run typecheck # sources and tests
npm run build     # compile packages
```

## Using it from Claude Code

```bash
claude mcp add kanban --scope user -- node <abs path>/packages/mcp/dist/index.js
```

Then, from inside any project that a board claims via `projectPaths`, no board argument is needed:

> let's pick a thing from this project's kanban board

`KANBAN_DATA_DIR` overrides where the boards live (default: the `personal-kanban-data` checkout
beside this repo); `KANBAN_BOARD` forces a board; `KANBAN_AUTHOR` names who notes are attributed to.

Every write is committed with a descriptive message and pushed on a short delay. Reads pull first
if the local clone is stale. Sync is never a gate: if the network is down the change is already on
disk, and the failure comes back as a warning rather than an error. `KANBAN_AUTOSYNC=0` turns it
off; `KANBAN_PULL_TTL_MS` and `KANBAN_PUSH_DELAY_MS` tune it.

## Using it in a browser

Open <https://flisnes.github.io/personal-kanban/> and paste a fine-grained token scoped to the data
repo (Contents: read and write). It is stored in that browser only; "Sign out" clears it.

Drag a card to move it, or use the keyboard — arrow keys walk between cards, **shift + arrow** moves
the focused card within or across columns. Click a card to rename it, retitle the body, change
priority, estimate and labels, or archive it. "+ Add a card" at the foot of a column captures a new
one.

Every change appears immediately and is committed in the background, one commit per change, with
the same message the MCP server would have written. If the board moved under you — because Claude
pushed from this PC while you were dragging on a phone — the commit is rejected, the app refetches
and *replays* your change against the new state. Placement is expressed relative to neighbouring
cards, so a replayed move still lands where you dropped it. The toolbar shows saving / saved, and
offers Retry and Discard if a change cannot be delivered at all.

## Status

Phases 0–4 are done: core, the MCP server with git sync, and a board UI on Pages you can read and
write from any device. Next is Phase 5 — command palette, dark mode, WIP and staleness warnings,
the archive browser, and PWA install.

## Known npm wrinkle

Any incremental `npm install <pkg>` can drop the platform-specific rollup/rolldown binaries
([npm/cli#4828](https://github.com/npm/cli/issues/4828)), after which `npm test` fails with
"Cannot find native binding". The fix is always the same:

```bash
rm -rf node_modules package-lock.json && npm install
```

CI uses `npm ci` from the committed lockfile and is unaffected.
