import { prisma } from './prisma'
import type { AuditAction } from '@prisma/client'

function safeJson(value: any): any {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value?.toFixed === 'function' && value?.constructor?.name === 'Decimal') return value.toFixed(2)
  if (Array.isArray(value)) return value.map(safeJson)
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,safeJson(v)]))
  return String(value)
}

export async function audit(data: { userId?: string; action: AuditAction; tableName: string; recordId: string; oldData?: unknown; newData?: unknown; ipAddress?: string | null }) {
  try {
    await prisma.auditLog.create({ data: { userId: data.userId, action: data.action, tableName: data.tableName, recordId: data.recordId, oldData: safeJson(data.oldData), newData: safeJson(data.newData), ipAddress: data.ipAddress ?? null } })
  } catch (e) { console.error('audit log failed', e) }
}
