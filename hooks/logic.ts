// The rules of the change ledger, as plain functions with no access to the machine, so
// they can be tested by themselves. register.tsx records the changes and draws the pane.

import type { Change } from '../types'

const WHY_MAX = 90

/** "D:\Projects\x\src\a.py" inside "D:/Projects/x" -> "src/a.py". Outside it: unchanged. */
export function relativePath(projectFolder: string, file: string): string {
  const slashed = file.replace(/\\/g, '/')
  const root = projectFolder.replace(/\\/g, '/').replace(/\/$/, '')
  // Windows paths differ in letter case between tools ("d:/" and "D:/").
  if (root && slashed.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return slashed.slice(root.length + 1)
  }

  return slashed
}

/** A request shortened to one line: the "why" shown beside each file. */
export function whyFromPrompt(prompt: string): string {
  const line = prompt.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  return line.length > WHY_MAX ? `${line.slice(0, WHY_MAX - 1)}…` : line
}

/** Add one write to the list: a new entry, or one more edit on the file's existing entry. */
export function recordChange(
  changes: readonly Change[],
  change: { file: string; isNew: boolean; why: string; at: number },
): Change[] {
  const before = changes.find(one => one.file === change.file)
  const entry: Change = {
    file: change.file,
    // A file created in this session stays "created" however often it is edited after.
    kind: before ? before.kind : change.isNew ? 'created' : 'edited',
    edits: (before?.edits ?? 0) + 1,
    // Keep the old reason when a later change arrives with none (a prompt-less turn).
    why: change.why || before?.why || '',
    at: change.at,
  }

  return [...changes.filter(one => one.file !== change.file), entry]
}

// ---- Who owns a file -------------------------------------------------------------------
//
// Ownership comes from a CODEOWNERS file: GitHub's format, one rule per line, a path
// pattern followed by its owners:
//
//     src/api/         Ali
//     *.md             docs-team
//
// ponytail: only the two common pattern shapes are understood, a folder or file prefix
// ("src/api/", "/src/config.py") and an extension ("*.md"). Full glob syntax (`**`, `?`)
// is not; add it if a real CODEOWNERS file needs it.

export type OwnerRule = { pattern: string; owner: string }

/** Read the rules out of a CODEOWNERS file's text. Comments and blank lines are skipped. */
export function parseOwners(text: string): OwnerRule[] {
  const rules: OwnerRule[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim()
    const [pattern, ...owners] = line.split(/\s+/)
    if (pattern && owners.length > 0) {
      rules.push({ pattern, owner: owners.join(' ') })
    }
  }

  return rules
}

/** The owner of a file, or null. As on GitHub, the last matching rule wins. */
export function ownerOf(rules: readonly OwnerRule[], file: string): string | null {
  let owner: string | null = null
  for (const rule of rules) {
    const isMatch = rule.pattern.startsWith('*.')
      ? file.endsWith(rule.pattern.slice(1))
      : `${file}/`.startsWith(`${rule.pattern.replace(/^\//, '').replace(/\/$/, '')}/`)
    if (isMatch) {
      owner = rule.owner
    }
  }

  return owner
}

/** The folder a file is filed under when nobody owns it: its first two path parts. */
function folderOf(file: string): string {
  const parts = file.split('/')

  return parts.length <= 1 ? '(project root)' : parts.slice(0, Math.min(2, parts.length - 1)).join('/')
}

export type Group = { title: string; isOwned: boolean; changes: Change[] }

/**
 * Sort the changes into groups: one per owner first (these are the ones to tell someone
 * about), then one per folder for the files nobody owns. Files inside a group are in
 * alphabetical order.
 */
export function groupChanges(changes: readonly Change[], rules: readonly OwnerRule[]): Group[] {
  const groups = new Map<string, Group>()
  for (const change of changes) {
    const owner = ownerOf(rules, change.file)
    const title = owner ?? folderOf(change.file)
    const key = `${owner ? 'owner' : 'folder'}:${title}`
    const group = groups.get(key) ?? { title, isOwned: owner !== null, changes: [] }
    group.changes.push(change)
    groups.set(key, group)
  }

  return [...groups.values()]
    .map(group => ({ ...group, changes: [...group.changes].sort((a, b) => a.file.localeCompare(b.file)) }))
    .sort((a, b) => Number(b.isOwned) - Number(a.isOwned) || a.title.localeCompare(b.title))
}

/** The list as a short markdown note to paste into a standup message. */
export function standupNote(groups: readonly Group[], date: string): string {
  const total = groups.reduce((sum, group) => sum + group.changes.length, 0)
  const lines = [`Files I changed (${date}): ${total}`]
  for (const group of groups) {
    lines.push('', group.isOwned ? `**${group.title}** (touches your area)` : `**${group.title}**`)
    for (const change of group.changes) {
      const kind = change.kind === 'created' ? ' (new)' : ''
      lines.push(`- ${change.file}${kind}${change.why ? `: ${change.why}` : ''}`)
    }
  }

  return lines.join('\n')
}

// ---- How the pane presents things ------------------------------------------------------

/** One request and the files it changed: the pane's default grouping. */
export type RequestGroup = { why: string; at: number; changes: Change[] }

/**
 * Sort the changes into one group per request, newest request first. A file edited by two
 * requests sits under the later one, because each entry keeps only its latest reason.
 */
export function groupByRequest(changes: readonly Change[]): RequestGroup[] {
  const groups = new Map<string, RequestGroup>()
  for (const change of changes) {
    const group = groups.get(change.why) ?? { why: change.why, at: 0, changes: [] }
    group.changes.push(change)
    group.at = Math.max(group.at, change.at)
    groups.set(change.why, group)
  }

  return [...groups.values()]
    .map(group => ({ ...group, changes: [...group.changes].sort((a, b) => a.file.localeCompare(b.file)) }))
    .sort((a, b) => b.at - a.at)
}

/**
 * A path split for display: the file name, and its folder shortened to the last two parts.
 * "src/infrastructure/generation/vendor/utils/hex.py" -> { name: "hex.py", folder: "…/vendor/utils" }
 */
export function splitPath(file: string): { name: string; folder: string } {
  const parts = file.split('/')
  const name = parts.pop() ?? file
  const folder = parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : parts.join('/')

  return { name, folder }
}

/** "just now", "4m ago", "2h ago": how long since a change. */
export function agoText(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) {
    return 'just now'
  }

  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`
}

/** The header's counts: new files, edited files, and how many different owners are affected. */
export function summary(changes: readonly Change[], rules: readonly OwnerRule[]): { created: number; edited: number; owners: number } {
  const created = changes.filter(change => change.kind === 'created').length
  const owners = new Set(changes.map(change => ownerOf(rules, change.file)).filter(owner => owner !== null))

  return { created, edited: changes.length - created, owners: owners.size }
}
