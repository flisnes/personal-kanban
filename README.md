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
| `apps/web` | Vite + React SPA deployed to GitHub Pages. *(not built yet)* |

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

## Status

Phases 0–2 are done. `packages/core` and the MCP server are complete, tested and syncing; the
boards are live and the server maintains them itself. Next is the web app (Phase 3).

If `npm test` ever fails with "Cannot find native binding", it is the npm optional-dependency bug:
delete `node_modules` and `package-lock.json` and reinstall.
