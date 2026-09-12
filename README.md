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
| `packages/mcp` | MCP stdio server over a local clone of the data repo. *(not built yet)* |
| `apps/web` | Vite + React SPA deployed to GitHub Pages. *(not built yet)* |

## Commands

```bash
npm test          # run the test suite
npm run typecheck # sources and tests
npm run build     # compile packages
```

## Status

Phase 0 is done: `packages/core` is complete and tested, and the data repo is seeded with real
boards. Phase 1 — the MCP server — is next; the board tracks it.
