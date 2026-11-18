/**
 * Link to the page that accepts an organization invitation
 * (`app/pages/accept-invite/[id].vue`). The path carries no locale prefix:
 * i18n uses `prefix_except_default`, so it is the default-locale route.
 */
export function buildInvitationUrl(baseURL: string, invitationId: string): string {
  return `${baseURL.replace(/\/+$/, '')}/accept-invite/${invitationId}`
}
