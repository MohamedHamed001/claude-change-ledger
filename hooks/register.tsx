// Change ledger: every file Claude changed in this session, and why.
//
// What you see: a pane (type /changes) with one card per request and the files it changed
// under it; a button switches to one card per owner, and another copies the list as a
// standup note.
//
// Where each piece of information comes from:
//   the file      the Edit / Write / NotebookEdit tool call that changed it
//   the why       the prompt you sent at the start of that turn, cut to one line
//   the owner     a CODEOWNERS file in the project, if there is one
//
// What it cannot see: files changed by a shell command (a formatter, `git checkout`, a
// script). Only the three editing tools are watched.
//
// The rules (grouping, ownership, the note's wording) are in logic.ts.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Change } from '../types'
import {
  agoText,
  groupByRequest,
  groupChanges,
  ownerOf,
  parseOwners,
  recordChange,
  relativePath,
  splitPath,
  standupNote,
  summary,
  whyFromPrompt,
} from './logic'
import type { OwnerRule } from './logic'

const PANE = 'changes'
// Where a CODEOWNERS file may live, first match wins. `.claude/` is for a personal one that
// is not checked in.
const OWNER_FILES = ['.claude/CODEOWNERS', 'CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']

// An atom is a named value the app stores for this mod. Writing to one makes the app redraw
// whatever read it, which is how the pane updates by itself.
const changes = atom({ plugin: 'change-ledger', key: 'changes' } as const, [])

// Plain variables: not drawn directly, and a reload simply reads them again.
let projectFolder = ''
let owners: OwnerRule[] = []
let lastPrompt = ''
// How the pane groups files: under the request that changed them, or under their owner.
let view: 'request' | 'owner' = 'request'

/** Read the project's CODEOWNERS rules; none is fine. */
async function loadOwners($: EngineInterface): Promise<OwnerRule[]> {
  for (const name of OWNER_FILES) {
    try {
      const text = await $.fs.read(`${projectFolder}/${name}`)
      if (typeof text === 'string') {
        return parseOwners(text)
      }
    } catch {
      // Not there: try the next place.
    }
  }

  return []
}

/** Copy the standup note; if there is no clipboard here, put it in the prompt box. */
async function copyNote($: EngineInterface) {
  const groups = groupChanges(await read($, changes), owners)
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const text = standupNote(groups, date)
  const copy = await $.ui.copy({ text }).catch(() => ({ isCopied: false }))
  if (copy.isCopied) {
    $.ui.toast('Standup note copied')
  } else {
    void $.prompt.fill({ text }).catch(() => undefined)
    $.ui.toast('Could not reach the clipboard: the note is in the prompt box')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    projectFolder = e.cwd
    try {
      owners = await loadOwners($)
      await $.command.register({ name: 'changes', description: 'Show the files changed this session, and why' })
    } catch {
      // The ledger still records without owners or the command.
    }

    return next(e)
  })

  on('command.run', { command: 'changes' }, async $ => {
    owners = await loadOwners($) // picked up fresh, in case the file was just written
    await $.ui.open({ id: PANE, title: 'Changes' })

    return { text: 'Changes pane opened.' }
  })

  // The "why": the prompt that started the turn. Slash commands are not reasons.
  on('prompt.submit', ($, e, next) => {
    if (!e.text.trimStart().startsWith('/')) {
      lastPrompt = whyFromPrompt(e.text)
    }

    return next(e)
  })

  // Let each editing tool run, then note the file if the edit went through.
  for (const tool of ['Edit', 'Write', 'NotebookEdit'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
      // Asked before the tool runs: afterwards the file always exists.
      const isNew = e.tool === 'Write' && !(await $.fs.exists(path).catch(() => true))
      const ran = await next(e)

      try {
        if (ran.deny === undefined && ran.isError !== true) {
          const at = await $.clock.now()
          const file = relativePath(projectFolder, path)
          await update($, changes, list => recordChange(list, { file, isNew, why: lastPrompt, at }))
        }
      } catch {
        // Bookkeeping must never affect the edit itself.
      }

      return ran
    })
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, changes)
    const { Box, Button, Text } = $.ui.resolve(e)

    if (list.length === 0) {
      return (
        <Box padding={1}>
          <Text dimColor>No files changed yet in this session.</Text>
        </Box>
      )
    }

    const now = await $.clock.now()
    const counts = summary(list, owners)

    /**
     * One file: a mark (+ new, ~ edited), the name, then its folder dimmed. `showOwner`
     * adds the owner's name at the end; the owner view leaves it out, its heading says it.
     */
    const row = (change: Change, showOwner: boolean) => {
      const { name, folder } = splitPath(change.file)
      const owner = showOwner ? ownerOf(owners, change.file) : null

      return (
        <Box columnGap={1}>
          <Text color={change.kind === 'created' ? 'success' : undefined} dimColor={change.kind !== 'created'}>
            {change.kind === 'created' ? '+' : '~'}
          </Text>
          <Box flexShrink={0}>
            <Text>{name}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text dimColor>{folder}</Text>
          </Box>
          {change.edits > 1 && <Text dimColor>{`×${change.edits}`}</Text>}
          {owner && <Text color="warning">{owner}</Text>}
        </Box>
      )
    }

    /** One outlined card: a heading on the left, a small note on the right, rows beneath. */
    const card = (heading: string, note: string, isWarning: boolean, rows: unknown) => (
      <Box flexDirection="column" rowGap={1} paddingX={1} borderStyle="round" borderDimColor>
        <Box columnGap={2}>
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text bold color={isWarning ? 'warning' : undefined}>
              {heading}
            </Text>
          </Box>
          <Text dimColor>{note}</Text>
        </Box>
        <Box flexDirection="column">{rows}</Box>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap={1} padding={1}>
        {/* The header: the total, then only the counts that are not zero. */}
        <Box columnGap={2}>
          <Text bold>{`${list.length} file${list.length === 1 ? '' : 's'} changed`}</Text>
          {counts.created > 0 && <Text color="success">{`${counts.created} new`}</Text>}
          {counts.edited > 0 && <Text dimColor>{`${counts.edited} edited`}</Text>}
          {counts.owners > 0 && (
            <Text color="warning">{`${counts.owners} owner${counts.owners === 1 ? '' : 's'} to tell`}</Text>
          )}
        </Box>
        <Box columnGap={1}>
          <Button key="copy-note" label="Copy standup note" variant="primary" onPress={() => copyNote($)} />
          <Button
            key="switch-view"
            label={view === 'request' ? 'By owner' : 'By request'}
            onPress={() => {
              view = view === 'request' ? 'owner' : 'request'
              $.ui.invalidate('ui.render')
            }}
          />
          <Button key="clear" label="Clear" onPress={() => update($, changes, () => [])} />
        </Box>

        {view === 'request'
          ? groupByRequest(list).map(group =>
              card(
                group.why || 'No request recorded',
                agoText(group.at, now),
                false,
                group.changes.map(change => row(change, true)),
              ),
            )
          : groupChanges(list, owners).map(group =>
              card(
                group.isOwned ? `Owner: ${group.title}` : group.title,
                `${group.changes.length} file${group.changes.length === 1 ? '' : 's'}`,
                group.isOwned,
                group.changes.map(change => row(change, false)),
              ),
            )}

        <Text dimColor>
          {owners.length === 0
            ? 'No CODEOWNERS file yet. Add .claude/CODEOWNERS to mark files that belong to someone else.'
            : 'Files changed by shell commands are not listed.'}
        </Text>
      </Box>
    )
  })
}
