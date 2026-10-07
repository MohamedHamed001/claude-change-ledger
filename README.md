# claude-change-ledger

A plugin for [Claude Code](https://docs.claude.com/en/docs/claude-code): **change-ledger**.

A pane that lists every file Claude changed in this session under the request that caused it, marks the ones someone else owns, and has a button that copies the list as a standup note.

Part of [claude-mods](https://github.com/MohamedHamed001/claude-mods), which lists this plugin and its siblings.

## Install

```
/plugin marketplace add MohamedHamed001/claude-change-ledger
/plugin install change-ledger@claude-change-ledger
```

Then start a new session: a session reads its plugins once, when it starts. Update later with `/plugin marketplace update claude-change-ledger`.

## Requirements

- **Claude Code 2.1.28x or newer.** The plugin uses function hooks (TypeScript modules the app loads), which older versions do not run.
- **Windows, macOS or Linux.** Developed on Windows; macOS has not been tested yet.

## What it does

Type `/changes` to open the pane.

```
6 files changed   2 new   4 edited   1 owner to tell
[Copy standup note] [By owner] [Clear]

add the exports endpoint                         4m ago
  + exports.py        src/api/routers               Ali
  ~ dependencies.py   src/api                       Ali
  ~ export_cases.py   src/application/services       ×3
```

| You see | Where it comes from |
| --- | --- |
| a card's heading | the prompt you sent at the start of that turn, cut to one line; newest first |
| `+` or `~` | the file is new in this session, or was edited |
| the name, then the folder | the Edit, Write or NotebookEdit tool call that changed it; long folders are cut to their last two parts |
| `×3` | how many times it was written |
| a name at the end of a row | the file's owner, from CODEOWNERS |

**By owner** switches to one card per owner (then per folder for files nobody owns), and **By request** switches back.

**Copy standup note** puts a short markdown list on the clipboard: owned groups first, marked "touches your area", so you know who to tell.

### Owners

Ownership is read from a `CODEOWNERS` file, GitHub's format: one rule per line, a path pattern followed by its owners. The last matching rule wins.

```
src/api/         Ali
*.md             docs-team
/src/config.py   Hamed
```

The plugin looks in `.claude/CODEOWNERS`, `CODEOWNERS`, `.github/CODEOWNERS` and `docs/CODEOWNERS`, in that order. Use `.claude/CODEOWNERS` for a personal list you do not want to check in. Without any of them, files are grouped by folder.

Only two pattern shapes are understood: a folder or file prefix (`src/api/`) and an extension (`*.md`). Full glob syntax (`**`, `?`) is not.

### What it cannot see

Files changed by a shell command (a formatter, `git checkout`, a script). Only the three editing tools are watched.

## Developing

```
claude plugin validate .
claude plugin test .
```

`hooks/logic.ts` holds the rules as plain functions; `hooks/register.tsx` records the changes and draws the pane.

## Licence

MIT. See [LICENSE](LICENSE).
