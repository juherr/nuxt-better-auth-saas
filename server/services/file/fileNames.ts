/**
 * Storage and display names of uploaded files. Pure helpers: the client
 * filename never reaches a storage path.
 */

/**
 * Longest original filename kept as display metadata. The `original_name`
 * column is unbounded `text`; 255 matches common filesystem limits.
 */
export const MAX_DISPLAY_NAME_LENGTH = 255

/** `yyyy-MM-dd/<id>.<extension>`, the date in UTC. */
export const buildStorageName = (now: Date, id: string, extension: string) =>
  `${now.toISOString().slice(0, 10)}/${id}.${extension}`

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g

/**
 * Client filename reduced to a display name: no directory part, no control
 * characters, at most `MAX_DISPLAY_NAME_LENGTH` characters, `file` when
 * nothing is left.
 */
export const sanitizeDisplayName = (name: string) => {
  const base = name.replace(CONTROL_CHARACTERS, '').split(/[/\\]/).pop()!.trim()
  const display = /^\.*$/.test(base) ? 'file' : base
  return display.slice(0, MAX_DISPLAY_NAME_LENGTH)
}
