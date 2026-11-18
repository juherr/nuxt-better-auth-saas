import type { file, organization, user } from '~~/server/db/schema'

export type User = typeof user.$inferSelect
export type FileRecord = typeof file.$inferSelect
export type Organization = typeof organization.$inferSelect
