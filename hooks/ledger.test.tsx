import { expect, test } from 'claude-code/testing'

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

test('files are grouped under their request, the newest request first', () => {
  let list = recordChange([], { file: 'b.py', isNew: false, why: 'first ask', at: 1 })
  list = recordChange(list, { file: 'a.py', isNew: false, why: 'second ask', at: 5 })
  list = recordChange(list, { file: 'c.py', isNew: false, why: 'second ask', at: 9 })
  const groups = groupByRequest(list)
  expect(groups.map(group => group.why)).toEqual(['second ask', 'first ask'])
  expect(groups[0].changes.map(change => change.file)).toEqual(['a.py', 'c.py'])
  expect(groups[0].at).toBe(9)
})

test('a path shows as a name and a short folder', () => {
  expect(splitPath('src/api/main.py')).toEqual({ name: 'main.py', folder: 'src/api' })
  expect(splitPath('src/infrastructure/generation/vendor/utils/hex.py')).toEqual({ name: 'hex.py', folder: '…/vendor/utils' })
  expect(splitPath('README.md')).toEqual({ name: 'README.md', folder: '' })
})

test('time since a change reads in minutes, then hours', () => {
  expect(agoText(1000, 1000 + 20_000)).toBe('just now')
  expect(agoText(0, 4 * 60_000)).toBe('4m ago')
  expect(agoText(0, 125 * 60_000)).toBe('2h ago')
})

test('the header counts new files, edited files and distinct owners', () => {
  const rules = parseOwners('src/api/ Ali')
  let list = recordChange([], { file: 'src/api/a.py', isNew: true, why: '', at: 1 })
  list = recordChange(list, { file: 'src/api/b.py', isNew: false, why: '', at: 1 })
  list = recordChange(list, { file: 'src/domain/c.py', isNew: false, why: '', at: 1 })
  expect(summary(list, rules)).toEqual({ created: 1, edited: 2, owners: 1 })
})

const OWNERS = `# who to tell
src/api/        Ali
*.md            docs
/src/config.py  Hamed
`

test('paths become relative to the project, whatever the slashes or letter case', () => {
  expect(relativePath('D:/Projects/x', 'D:\\Projects\\x\\src\\a.py')).toBe('src/a.py')
  expect(relativePath('D:\\Projects\\x', 'd:/Projects/x/src/a.py')).toBe('src/a.py')
  expect(relativePath('D:/Projects/x', 'C:/elsewhere/b.py')).toBe('C:/elsewhere/b.py')
})

test('a prompt is cut to one line, without pasted blocks', () => {
  expect(whyFromPrompt('fix the  hex\nvalidation')).toBe('fix the hex validation')
  expect(whyFromPrompt('look <pasted_content id="1">junk</pasted_content> here')).toBe('look here')
  expect(whyFromPrompt('x'.repeat(200)).length).toBe(90)
})

test('editing a file twice is one entry with two edits; a created file stays created', () => {
  let list = recordChange([], { file: 'a.py', isNew: true, why: 'add a', at: 1 })
  list = recordChange(list, { file: 'a.py', isNew: false, why: '', at: 2 })
  expect(list).toEqual([{ file: 'a.py', kind: 'created', edits: 2, why: 'add a', at: 2 }])
})

test('CODEOWNERS rules: folders, extensions, exact files, last match wins', () => {
  const rules = parseOwners(OWNERS)
  expect(ownerOf(rules, 'src/api/routers/exports.py')).toBe('Ali')
  expect(ownerOf(rules, 'src/api/README.md')).toBe('docs') // the later rule wins
  expect(ownerOf(rules, 'src/config.py')).toBe('Hamed')
  expect(ownerOf(rules, 'src/apiary/x.py')).toBe(null) // "src/api" is not a prefix of "src/apiary"
})

test('owned groups come first, the rest are grouped by folder; the note lists them', () => {
  const rules = parseOwners(OWNERS)
  let list = recordChange([], { file: 'src/domain/model.py', isNew: false, why: 'add field', at: 1 })
  list = recordChange(list, { file: 'src/api/main.py', isNew: true, why: 'new endpoint', at: 2 })
  const groups = groupChanges(list, rules)
  expect(groups.map(group => group.title)).toEqual(['Ali', 'src/domain'])

  const note = standupNote(groups, '2026-10-07')
  expect(note).toContain('Files I changed (2026-10-07): 2')
  expect(note).toContain('**Ali** (touches your area)')
  expect(note).toContain('- src/api/main.py (new): new endpoint')
})

// ---- The real hooks ---------------------------------------------------------------------

/** A project at D:/p whose only CODEOWNERS rule gives src/api to Ali. Records copies. */
function fakeProject(on: any, copied: string[], toolAnswer: object = { result: { text: 'ok' } }) {
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 7) }))
  on('command.register', () => ({ value: undefined }))
  on('fs.read', (_: unknown, e: { path: string }) => {
    return { value: /\.claude[\\/]CODEOWNERS$/.test(e.path) ? 'src/api/ Ali' : '' }
  })
  on('fs.exists', () => ({ value: false }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', (_: unknown, e: { text: string }) => {
    copied.push(e.text)

    return { value: { isCopied: true } }
  })
  on('session.start', (_: unknown, e: object) => ({ ...e, cwd: 'D:/p' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('tool.call', () => toolAnswer as never)
}

const PANE = { plugin: 'change-ledger', surface: 'desktop', component: 'Pane', requestId: 'changes', props: {} as never } as const

test('an edit shows up under its request, with its owner; By owner regroups it', async ($, on) => {
  const copied: string[] = []
  fakeProject(on, copied)
  on('ui.invalidate', () => ({ value: undefined }))
  await $.session.start({ cwd: 'D:/p' } as never)
  await $.prompt.submit({ text: 'add the exports endpoint' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'D:\\p\\src\\api\\exports.py', content: 'x' } as never)

  // The default view: one card per request, the file name and folder apart, the owner named.
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ text: /1 file changed/ })) !== undefined).toBe(true)
  expect((await ui.find({ text: /1 owner to tell/ })) !== undefined).toBe(true)
  expect((await ui.find({ text: /add the exports endpoint/ })) !== undefined).toBe(true)
  expect((await ui.find({ text: /^exports\.py$/ })) !== undefined).toBe(true)
  expect((await ui.find({ text: /^src\/api$/ })) !== undefined).toBe(true)
  expect((await ui.find({ text: /^Ali$/ })) !== undefined).toBe(true)
  expect((await ui.find({ text: /Owner: Ali/ })) === undefined).toBe(true)

  await ui.press({ key: 'switch-view' })
  await ui.unmount()
  const byOwner = await $.ui.mount(PANE)
  expect((await byOwner.find({ text: /Owner: Ali/ })) !== undefined).toBe(true)
  await byOwner.press({ key: 'copy-note' })
  expect(copied.length).toBe(1)
  expect(copied[0]).toContain('- src/api/exports.py (new): add the exports endpoint')
})

test('a refused edit is not recorded', async ($, on) => {
  fakeProject(on, [], { deny: 'no' })
  await $.session.start({ cwd: 'D:/p' } as never)
  await $.tool.call({ tool: 'Edit', file_path: 'D:/p/a.py', old_string: 'a', new_string: 'b' } as never)

  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ text: /No files changed yet/ })) !== undefined).toBe(true)
})
