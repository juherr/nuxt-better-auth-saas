import type { H3Event } from 'h3'
import type { User } from '~~/shared/utils/types'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, getOAuthState, getSessionFromCtx } from 'better-auth/api'
import { admin as adminPlugin, apiKey, openAPI, organization } from 'better-auth/plugins'
import { and, eq } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'
import * as schema from '~~/server/db/schema'
import { ac, admin, member, owner } from '~~/shared/utils/permissions'
import { createdApiKeyId, isApiKeyManagerRole, parseLegacyOrganizationId } from './apiKeyMetadata'
import { logAuditEvent } from './auditLogger'
import { getDB } from './db'
import { cacheClient, getResendClient } from './drivers'
import { renderDeleteAccount, renderResetPassword, renderTeamInvite, renderVerifyEmail } from './email'
import { runtimeConfig } from './runtimeConfig'
import { createStripeClient, isStripeConfigured, setupStripe } from './stripe'

console.log(`Base URL is ${runtimeConfig.public.baseURL}`)
console.log('Schema keys:', Object.keys(schema))

// Used by npm run auth:schema only.
const isAuthSchemaCommand = process.argv.some(arg => arg.includes('server/db/schema/auth.ts'))

const emailSender = () => `${runtimeConfig.public.appName} <${runtimeConfig.public.appNotifyEmail}>`

/**
 * Auth endpoints the app does not serve. Subscriptions are cancelled and
 * resumed through /api/stripe/cancel and /api/stripe/resume, which check
 * that the subscription belongs to the caller's organization; the billing
 * plugin's own endpoints for the same actions do not, so they are off.
 * Organization API keys are listed and revoked through
 * /api/organization/api-keys, which check the caller's role in the key's
 * organization; the API key plugin's get, list, update and delete
 * endpoints only check that the caller created the key, so they are off.
 * Paths are relative to the /api/auth base path.
 */
export const DISABLED_AUTH_PATHS: readonly string[] = [
  '/subscription/cancel',
  '/subscription/restore',
  '/api-key/get',
  '/api-key/list',
  '/api-key/update',
  '/api-key/delete'
]

/**
 * Answers 404 for a disabled endpoint. `disabledPaths` compares the raw
 * request path; this check runs as a before hook on the endpoint the
 * router resolved, so it holds whatever form the request path took.
 */
export function refuseDisabledEndpoint(endpointPath: string) {
  if (DISABLED_AUTH_PATHS.includes(endpointPath)) {
    throw new APIError('NOT_FOUND')
  }
}

type AuthMiddlewareContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]

/**
 * Whether the subscription rows found for a subscription id all belong to
 * the reference (user or organization) the request acts for. No row means
 * no subscription to act on.
 */
export function isSubscriptionOwnedByReference(rows: readonly { referenceId: string }[], referenceId: string) {
  return rows.length > 0 && rows.every(row => row.referenceId === referenceId)
}

/**
 * The billing plugin's upgrade endpoint authorizes the reference it acts
 * for, but loads a subscription named in the body by its id alone. Before
 * the endpoint runs, check that the subscription it will load belongs to
 * that reference, matching rows exactly as the plugin does, and answer the
 * same generic 404 otherwise. Requests that name no subscription and
 * anonymous requests are left to the endpoint.
 */
async function refuseForeignSubscriptionUpgrade(ctx: AuthMiddlewareContext) {
  const subscriptionId = ctx.body?.subscriptionId
  if (!subscriptionId) {
    return
  }
  const session = await getSessionFromCtx(ctx)
  if (!session) {
    return
  }
  if (typeof subscriptionId !== 'string') {
    throw new APIError('NOT_FOUND')
  }
  const referenceId = ctx.body.referenceId || session.user.id
  const rows = await ctx.context.adapter.findMany<{ referenceId: string }>({
    model: 'subscription',
    where: [
      { field: 'id', value: subscriptionId, connector: 'OR' },
      { field: 'stripeSubscriptionId', value: subscriptionId, connector: 'OR' }
    ]
  })
  if (!isSubscriptionOwnedByReference(rows, referenceId)) {
    throw new APIError('NOT_FOUND')
  }
}

/**
 * An API key belongs to the organization its metadata names, so only an
 * owner or admin of that organization may create it. Runs before the
 * endpoint validates its body. Anonymous callers get 401; a missing
 * organization, a non-member and a member with another role all get the
 * same 403. Server-side calls without a session are refused as well.
 */
async function requireApiKeyCreationRights(ctx: AuthMiddlewareContext) {
  const session = await getSessionFromCtx(ctx)
  if (!session) {
    throw new APIError('UNAUTHORIZED')
  }
  const forbidden = () => new APIError('FORBIDDEN', { message: 'You cannot create API keys for this organization' })
  const organizationId = parseLegacyOrganizationId(ctx.body?.metadata)
  if (!organizationId) {
    throw forbidden()
  }
  const membership = await ctx.context.adapter.findOne<{ role: string }>({
    model: 'member',
    where: [
      { field: 'organizationId', value: organizationId },
      { field: 'userId', value: session.user.id }
    ]
  })
  if (!isApiKeyManagerRole(membership?.role)) {
    throw forbidden()
  }
}

/**
 * Records the organization of a key the endpoint just created. The
 * creation and this insert are not one transaction. When the insert
 * fails, the answer becomes an error so the plaintext key never reaches
 * the client: the key row stays unlisted and no one holds its plaintext, which
 * fails closed. `returned` carries the plaintext key: read its id only,
 * and never log or serialize it.
 */
async function linkCreatedApiKey(ctx: AuthMiddlewareContext) {
  const apiKeyId = createdApiKeyId(ctx.context.returned)
  const organizationId = parseLegacyOrganizationId(ctx.body?.metadata)
  if (!apiKeyId || !organizationId) {
    return
  }
  try {
    await getDB().insert(schema.apiKeyOrganization).values({ apiKeyId, organizationId })
  } catch (error) {
    // The insert holds ids only, so its error cannot carry the plaintext.
    console.error(`Failed to link API key ${apiKeyId} to its organization:`, error)
    throw new APIError('INTERNAL_SERVER_ERROR', { message: 'The API key could not be created' })
  }
}

export const createBetterAuth = () => betterAuth({
  baseURL: runtimeConfig.public.baseURL,
  trustedOrigins: [
    'http://localhost:8787',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:4000',
    'http://127.0.0.1:8787',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4000',
    runtimeConfig.public.baseURL
  ],
  secret: runtimeConfig.betterAuthSecret,
  disabledPaths: [...DISABLED_AUTH_PATHS],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60 // Cache for 5 minutes
    }
  },
  database: drizzleAdapter(
    getDB(),
    {
      provider: 'pg',
      schema
    }
  ),
  advanced: {
    database: {
      generateId: () => {
        return uuidv7()
      }
    }
  },
  user: {
    changeEmail: {
      enabled: true
    },
    deleteUser: {
      enabled: true,
      async sendDeleteAccountVerification({ user, url }) {
        const resend = getResendClient()
        if (!resend) {
          console.warn('Resend is not configured: account deletion email not sent')
          return
        }
        const name = user.name || user.email.split('@')[0]
        const html = await renderDeleteAccount(name, url)
        const response = await resend.emails.send({
          from: emailSender(),
          to: user.email,
          subject: 'Confirm account deletion',
          html
        })
        if (response.error) {
          console.error(`Failed to send account deletion email: ${response.error.message}`)
          throw createError({
            statusCode: 500,
            statusMessage: 'Internal Server Error'
          })
        }
      }
    },
    additionalFields: {
      lastActiveOrganizationId: {
        type: 'string',
        required: false,
        defaultValue: null
      },
      referralCode: {
        type: 'string',
        required: false
      }
    }
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          if (ctx.path.startsWith('/callback')) {
            try {
              const additionalData = await getOAuthState(ctx)
              if (additionalData?.referralCode) {
                return {
                  data: {
                    ...user,
                    referralCode: additionalData.referralCode
                  }
                }
              }
            } catch {
              // ignore
            }
          }
        }
      },
      update: {
        after: async (user) => {
          // When user email changes, update Stripe customer email for orgs they own
          console.log('[Auth] User update hook triggered:', { userId: user.id, email: user.email, emailVerified: user.emailVerified })

          // Always sync email to Stripe when user is updated (email is verified by the change-email flow)
          if (user.email) {
            try {
              const db = getDB()
              // Find all orgs where this user is owner and has a Stripe customer
              const ownedOrgs = await db
                .select()
                .from(schema.member)
                .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
                .where(and(
                  eq(schema.member.userId, user.id),
                  eq(schema.member.role, 'owner')
                ))

              console.log('[Auth] Found owned orgs:', ownedOrgs.length)

              if (ownedOrgs.length > 0 && isStripeConfigured()) {
                const stripe = createStripeClient()
                for (const row of ownedOrgs) {
                  const org = row.organization
                  if (org.stripeCustomerId) {
                    // Update customer email (used for receipts and communications)
                    // Also ensure customer name stays as org name (not cardholder name)
                    await stripe.customers.update(org.stripeCustomerId, {
                      email: user.email,
                      name: org.name
                    })
                    console.log(`[Auth] Updated Stripe customer ${org.stripeCustomerId} email to ${user.email}, name to "${org.name}"`)
                  } else {
                    console.log(`[Auth] Org ${org.id} has no stripeCustomerId`)
                  }
                }
              }
            } catch (e) {
              console.error('[Auth] Failed to update Stripe customer email:', e)
            }
          }
        }
      }
    },
    session: {
      create: {
        before: async (session) => {
          const db = getDB()

          // 1. Try to get user's last active org
          const users = await db
            .select()
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1)

          let activeOrgId = users[0]?.lastActiveOrganizationId

          // 2. Verify user is still a member of that org
          if (activeOrgId) {
            const member = await db
              .select()
              .from(schema.member)
              .where(and(
                eq(schema.member.userId, session.userId),
                eq(schema.member.organizationId, activeOrgId)
              ))
              .limit(1)

            if (member.length === 0)
              activeOrgId = null
          }

          // 3. Fallback to first organization
          if (!activeOrgId) {
            const members = await db
              .select()
              .from(schema.member)
              .where(eq(schema.member.userId, session.userId))
              .limit(1)

            if (members.length > 0)
              activeOrgId = members[0].organizationId
          }

          if (activeOrgId) {
            return {
              data: {
                ...session,
                activeOrganizationId: activeOrgId
              }
            }
          }
        }
      },
      update: {
        after: async (session) => {
          const activeOrgId = (session as any).activeOrganizationId
          if (activeOrgId) {
            await getDB()
              .update(schema.user)
              .set({ lastActiveOrganizationId: activeOrgId })
              .where(eq(schema.user.id, session.userId))
          }
        }
      }
    },
    organization: {
      create: {
        before: async (org, ctx) => {
          const session = ctx.session || ctx.context?.session
          if (session?.user?.id) {
            const db = getDB()
            const user = await db.query.user.findFirst({
              where: eq(schema.user.id, session.user.id)
            })
            if (user?.referralCode) {
              return {
                data: {
                  ...org,
                  referralCode: user.referralCode
                }
              }
            }
          }
        }
      },
      update: {
        before: async (org: any) => {
          console.log('[Auth Hook] Organization Update Payload:', JSON.stringify(org, null, 2))
        }
      }
    },
    member: {
      create: {
        after: async (_member: any) => {
          // await syncSubscriptionQuantity(member.organizationId)
        }
      },
      delete: {
        after: async (_member: any) => {
          // await syncSubscriptionQuantity(member.organizationId)
        }
      }
    },
    invitation: {
      create: {
        after: async (_invitation: any) => {
          // await syncSubscriptionQuantity(invitation.organizationId)
        }
      },
      delete: {
        after: async (_invitation: any) => {
          // await syncSubscriptionQuantity(invitation.organizationId)
        }
      }
    }
  },
  secondaryStorage: cacheClient,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const name = user.name || user.email.split('@')[0]
      const html = await renderResetPassword(name, url)
      const resend = getResendClient()
      if (!resend) {
        console.error('Resend is not configured: reset password email not sent')
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error'
        })
      }
      const response = await resend.emails.send({
        from: emailSender(),
        to: user.email,
        subject: 'Reset your password',
        html
      })
      await logAuditEvent({
        userId: user.id,
        category: 'email',
        action: 'reset_password',
        targetType: 'email',
        targetId: user.email,
        status: response.error ? 'failure' : 'success',
        details: response.error?.message
      })
      if (response.error) {
        console.error(`Failed to send reset password email: ${response.error.message}`)
        throw createError({
          statusCode: 500,
          statusMessage: 'Internal Server Error'
        })
      }
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      // The URL carries the verification token: only print it in development,
      // where it lets sign-up work without an email provider.
      const isDevelopment = runtimeConfig.public.appEnv === 'development'
      if (isDevelopment) {
        console.log('>>> EMAIL VERIFICATION LINK <<<')
        console.log(`To: ${user.email}`)
        console.log(url)
        console.log('>>> ------------------------ <<<')
      }
      try {
        const resend = getResendClient()
        if (!resend) {
          throw new Error('Resend is not configured')
        }
        const name = user.name || user.email.split('@')[0]
        const html = await renderVerifyEmail(name, url)
        const response = await resend.emails.send({
          from: emailSender(),
          to: user.email,
          subject: 'Verify your email address',
          html
        })
        await logAuditEvent({
          userId: user.id,
          category: 'email',
          action: 'verification',
          targetType: 'email',
          targetId: user.email,
          status: response.error ? 'failure' : 'success',
          details: response.error?.message
        })
        if (response.error) {
          throw new Error(response.error.message)
        }
      } catch (e) {
        console.warn('Failed to send verification email:', e)
      }
    }
  },
  socialProviders: {
    github: {
      clientId: runtimeConfig.githubClientId!,
      clientSecret: runtimeConfig.githubClientSecret!
    },
    google: {
      clientId: runtimeConfig.googleClientId!,
      clientSecret: runtimeConfig.googleClientSecret!
    }
  },
  account: {
    accountLinking: {
      enabled: true
    }
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      refuseDisabledEndpoint(ctx.path)
      if (ctx.path === '/subscription/upgrade') {
        await refuseForeignSubscriptionUpgrade(ctx)
      }
      if (ctx.path === '/api-key/create') {
        await requireApiKeyCreationRights(ctx)
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      const ipAddress = ctx.getHeader('x-forwarded-for')
        || ctx.getHeader('remoteAddress') || undefined
      const userAgent = ctx.getHeader('user-agent') || undefined

      let targetType
      let targetId
      if (ctx.context.session || ctx.context.newSession) {
        targetType = 'user'
        targetId = ctx.context.session?.user.id || ctx.context.newSession?.user.id
      } else if (['/sign-in/email', '/sign-up/email', 'forget-password'].includes(ctx.path)) {
        targetType = 'email'
        targetId = ctx.body.email || ''
      }
      const returned = ctx.context.returned
      if (returned && returned instanceof APIError) {
        const userId = ctx.context.newSession?.user.id
        if (ctx.path == '/callback/:id' && returned.status == 'FOUND' && userId) {
          const provider = ctx.params.id
          await logAuditEvent({
            userId,
            category: 'auth',
            action: ctx.path.replace(':id', provider),
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'success'
          })
        } else {
          await logAuditEvent({
            userId: ctx.context.session?.user.id,
            category: 'auth',
            action: ctx.path,
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'failure',
            details: returned.body?.message
          })
        }
      } else {
        if (['/sign-in/email', '/sign-up/email', '/forget-password', '/reset-password'].includes(ctx.path)) {
          let userId: string | undefined
          if (['/sign-in/email', '/sign-up/email'].includes(ctx.path)) {
            userId = ctx.context.newSession?.user.id
          } else {
            userId = ctx.context.session?.user.id
          }
          await logAuditEvent({
            userId,
            category: 'auth',
            action: ctx.path,
            targetType,
            targetId,
            ipAddress,
            userAgent,
            status: 'success'
          })
        }
      }
      if (ctx.path === '/api-key/create') {
        await linkCreatedApiKey(ctx)
      }
    })
  },
  plugins: [
    ...(runtimeConfig.public.appEnv === 'development' ? [openAPI()] : []),
    adminPlugin(),
    organization({
      ac,
      roles: {
        owner,
        admin,
        member
      },
      enableMetadata: true,
      async sendInvitationEmail({ email, inviter, organization, invitation }) {
        const resend = getResendClient()
        if (resend) {
          const inviterName = inviter.user.name || inviter.user.email.split('@')[0]
          const inviteUrl = `${runtimeConfig.public.baseURL}/invite/${invitation.id}`
          const html = await renderTeamInvite(inviterName, organization.name, inviteUrl)
          await resend.emails.send({
            from: emailSender(),
            to: email,
            subject: `You're invited to join ${organization.name}`,
            html
          })
        }
      }
    }),
    apiKey({
      enableMetadata: true,
      schema: {
        apikey: {
          modelName: 'apiKey'
        }
      }
    }),
    // Billing is optional: without a Stripe secret key the app runs without it.
    // auth:schema keeps the plugin so the generated schema stays complete.
    ...(isStripeConfigured() || isAuthSchemaCommand ? [setupStripe()] : [])
  ]
})

let _auth: ReturnType<typeof betterAuth>

if (isAuthSchemaCommand) {
  _auth = createBetterAuth()
}
export const auth = _auth!

export const useServerAuth = () => {
  if (runtimeConfig.preset == 'node-server') {
    if (!_auth) {
      _auth = createBetterAuth()
    }
    return _auth
  } else {
    return createBetterAuth()
  }
}

export const getAuthSession = async (event: H3Event) => {
  const reqHeaders = getRequestHeaders(event)
  const headers = new Headers()
  for (const [key, value] of Object.entries(reqHeaders)) {
    if (value)
      headers.append(key, value)
  }

  const serverAuth = useServerAuth()
  const session = await serverAuth.api.getSession({
    headers
  })
  return session
}

export const requireAuth = async (event: H3Event) => {
  const session = await getAuthSession(event)
  if (!session || !session.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized'
    })
  }
  // Save the session to the event context for later use
  event.context.user = session.user
  return session.user as User
}
