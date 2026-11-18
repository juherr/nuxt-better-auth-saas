/**
 * The name to greet a user with in emails: their name, else the local part
 * of their email, else the whole email.
 */
export function userDisplayName(user: { name?: string | null, email: string }): string {
  return user.name || user.email.split('@')[0] || user.email
}
