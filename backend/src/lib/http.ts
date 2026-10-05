export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message) }
}

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init)
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status })
  console.error(error)
  return Response.json({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor.' } }, { status: 500 })
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json() as Record<string, unknown> } catch { throw new ApiError(400, 'INVALID_JSON', 'JSON inválido.') }
}

export function requiredString(body: Record<string, unknown>, key: string, max = 255) {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'VALIDATION_ERROR', `${key} inválido.`)
  return value.trim()
}

export function optionalString(body: Record<string, unknown>, key: string, max = 2000) {
  const value = body[key]
  if (value == null || value === '') return null
  if (typeof value !== 'string' || value.length > max) throw new ApiError(400, 'VALIDATION_ERROR', `${key} inválido.`)
  return value.trim()
}

export function requiredDate(body: Record<string, unknown>, key: string) {
  const value = body[key]
  const date = typeof value === 'string' ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) throw new ApiError(400, 'VALIDATION_ERROR', `${key} inválido.`)
  return date
}

export function requiredNumber(body: Record<string, unknown>, key: string, min = 0) {
  const n = Number(body[key])
  if (!Number.isFinite(n) || n < min) throw new ApiError(400, 'VALIDATION_ERROR', `${key} inválido.`)
  return n
}
