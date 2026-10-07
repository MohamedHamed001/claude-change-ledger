# claude-change-ledger

A plugin for [Claude Code](https://docs.claude.com/en/docs/claude-code): **change-ledger**.

A pane that lists every file Claude changed in this session, grouped by who owns it, each with the request that caused the change, and a button that copies the list as a standup note.

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

| You see | Where it comes from |
| --- | --- |
| the file | the Edit, Write or NotebookEdit tool call that changed it |
| `new` | the file did not exist before this session |
| `×3` | how many times it was written |
| the line under the file | the prompt you sent at the start of that turn, cut to one line |
| the group heading | the file's owner, or its folder when nobody owns it |

**Copy as standup note** puts a short markdown list on the clipboard: owned groups first, marked "touches your area", so you know who to tell.

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
