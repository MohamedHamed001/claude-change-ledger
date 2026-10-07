// The values this mod keeps in the session's state, and their shapes.

/**
 * One file Claude changed in this session.
 * `file` is relative to the project folder, with forward slashes ("src/api/main.py").
 * `edits` counts how many times it was written. `why` is the request that led to the
 * latest change, shortened to one line.
 */
export type Change = {
  file: string
  kind: 'created' | 'edited'
  edits: number
  why: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'change-ledger': {
      /** Every file changed so far, one entry per file. */
      changes: Change[]
    }
  }
}
