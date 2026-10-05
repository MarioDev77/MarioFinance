/** Validadores simples compartilhados. As rotas também validam no servidor antes do Prisma. */
export const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isEmail(value: unknown): value is string { return typeof value === 'string' && value.length <= 254 && emailPattern.test(value) }
export function isPositiveMoney(value: unknown): boolean { const n=Number(value); return Number.isFinite(n) && n > 0 && n < 100_000_000 }
