import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

/**
 * SEED SEGURO - cria a UNICA conta do sistema.
 * NUNCA ha rota publica de cadastro. As credenciais vêm exclusivamente
 * de variaveis de ambiente e o hash NUNCA fica hardcoded.
 */
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD

  if (!email || !password) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env antes de rodar o seed.')
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD deve ter no minimo 8 caracteres.')
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const user = await prisma.user.upsert({
    where: { email },
    update: {}, // nunca sobrescreve a senha existente sem querer
    create: { email, passwordHash, name: 'Mario' },
  })

  const defaultCategories = [
    { name: 'Salario', kind: 'RECEIPT' as const, color: '#22c55e' },
    { name: 'Extra', kind: 'RECEIPT' as const, color: '#84cc16' },
    { name: 'Moradia', kind: 'EXPENSE' as const, color: '#f59e0b' },
    { name: 'Alimentacao', kind: 'EXPENSE' as const, color: '#ef4444' },
    { name: 'Transporte', kind: 'EXPENSE' as const, color: '#3b82f6' },
    { name: 'Saude', kind: 'EXPENSE' as const, color: '#a855f7' },
    { name: 'Lazer', kind: 'EXPENSE' as const, color: '#ec4899' },
  ]
  for (const c of defaultCategories) {
    await prisma.category.upsert({
      where: { userId_name_kind: { userId: user.id, name: c.name, kind: c.kind } },
      update: {},
      create: { userId: user.id, ...c },
    })
  }

  console.log(`Seed concluido. Usuario unico: ${user.email}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
