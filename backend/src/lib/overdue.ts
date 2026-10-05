import { prisma } from './prisma'

/** Atualiza status atrasados sem alterar valores financeiros. */
export async function markOverdue(userId: string, nowRaw = new Date()) {
  // vence hoje ainda nao e atraso: compara com o inicio do dia (UTC)
  const now = new Date(Date.UTC(nowRaw.getUTCFullYear(), nowRaw.getUTCMonth(), nowRaw.getUTCDate()))
  await prisma.expense.updateMany({ where: { userId, deletedAt: null, status: 'PENDING', dueDate: { lt: now } }, data: { status: 'OVERDUE' } })
  const debts = await prisma.debt.findMany({ where: { userId, deletedAt: null, status: 'ACTIVE' }, select: { id: true } })
  if (debts.length) await prisma.debtInstallment.updateMany({ where: { debtId: { in: debts.map(d=>d.id) }, status: 'PENDING', dueDate: { lt: now } }, data: { status: 'OVERDUE' } })
}
