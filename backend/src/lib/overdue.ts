import { prisma } from './prisma'

/** Atualiza status atrasados sem alterar valores financeiros. */
export async function markOverdue(userId: string, now = new Date()) {
  await prisma.expense.updateMany({ where: { userId, deletedAt: null, status: 'PENDING', dueDate: { lt: now } }, data: { status: 'OVERDUE' } })
  const debts = await prisma.debt.findMany({ where: { userId, deletedAt: null, status: 'ACTIVE' }, select: { id: true } })
  if (debts.length) await prisma.debtInstallment.updateMany({ where: { debtId: { in: debts.map(d=>d.id) }, status: 'PENDING', dueDate: { lt: now } }, data: { status: 'OVERDUE' } })
}
