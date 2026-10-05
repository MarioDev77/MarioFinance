import { cookies } from 'next/headers'
import type { Session, User } from '@prisma/client'
import { prisma } from './prisma'
import { ApiError } from './http'
import { hashToken, randomToken, signValue, verifyValue } from './crypto'

export const SESSION_COOKIE = 'mariofin_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 dias

type SessionWithUser = Session & { user: User }

export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomToken(32)
  const csrfToken = randomToken(24)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfToken,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt,
    },
  })
  return { token, csrfToken, expiresAt }
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, `${token}.${signValue(token)}`, {
    httpOnly: true,
    // frontend e backend ficam em subdominios diferentes (railway.app) => cookie cross-site precisa de SameSite=None + Secure
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

export async function getSessionWithUser(): Promise<SessionWithUser | null> {
  const jar = await cookies()
  const raw = jar.get(SESSION_COOKIE)?.value
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const token = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (!verifyValue(token, sig)) return null

  const session = await prisma.session.findFirst({
    where: { tokenHash: hashToken(token), revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  })
  return session
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } })
}

/** Exige sessao valida. Lanca ApiError 401 caso contrario. */
export async function requireAuth(): Promise<SessionWithUser> {
  const session = await getSessionWithUser()
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Acesso nao autorizado.')
  return session
}

/** IDOR: todo acesso a registro deve confirmar propriedade (userId) e existencia. */
export function assertOwnership(
  record: { userId: string; deletedAt?: Date | null } | null,
  userId: string,
): asserts record is { userId: string; deletedAt?: Date | null } {
  if (!record || record.userId !== userId || record.deletedAt) {
    // 404 proposital: nao revelar existencia de recurso alheio
    throw new ApiError(404, 'NOT_FOUND', 'Registro nao encontrado.')
  }
}

/** CSRF para operacoes mutaveis com cookie de sessao. */
export function assertCsrf(session: Session, req: Request): void {
  const header = req.headers.get('x-csrf-token')
  if (!header || header !== session.csrfToken) {
    throw new ApiError(403, 'CSRF_INVALID', 'Token CSRF ausente ou invalido.')
  }
}

export function assertMutable(session: Session, req: Request): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') assertCsrf(session, req)
}
