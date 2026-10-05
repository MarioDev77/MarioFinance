import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

export function toDecimal(v: Decimal | number | string): Decimal {
  return new Decimal(v)
}

/** Converte Decimal para string fixa com 2 casas (pronto para persistir em Numeric). */
export function toMoneyString(v: Decimal): string {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

export type InstallmentPlanItem = {
  installmentNumber: number
  amount: Decimal
  dueDate: Date
}

/**
 * Gera o plano de parcelas com distribuicao exata (o backend calcula, nunca o frontend):
 * - valor base = total/count arredondado para 2 casas (meio para cima);
 * - a ULTIMA parcela absorve o resto (centavos), garantindo soma exata do total.
 */
export function generateInstallmentPlan(
  total: Decimal | number | string,
  count: number,
  firstDueDate: Date,
): InstallmentPlanItem[] {
  if (!Number.isInteger(count) || count < 1 || count > 480) {
    throw new Error('Quantidade de parcelas invalida.')
  }
  const totalD = toDecimal(total)
  if (!totalD.isPositive()) throw new Error('Valor total deve ser positivo.')

  const base = totalD.dividedBy(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const plan: InstallmentPlanItem[] = []
  for (let i = 1; i <= count; i++) {
    const amount = i === count ? totalD.minus(base.times(count - 1)) : base
    plan.push({
      installmentNumber: i,
      amount: amount.toDecimalPlaces(2),
      dueDate: addMonthsClamped(firstDueDate, i - 1),
    })
  }
  return plan
}

/** Soma mensal mantendo o dia, ajustado para o ultimo dia do mes quando necessario. */
export function addMonthsClamped(date: Date, months: number): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
  d.setUTCMonth(d.getUTCMonth() + months)
  const day = Math.min(date.getUTCDate(), daysInMonth(d.getUTCFullYear(), d.getUTCMonth()))
  d.setUTCDate(day)
  return d
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function monthBoundsUTC(year: number, month1to12: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month1to12 - 1, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, month1to12, 1, 0, 0, 0))
  return { start, end }
}

/** Verifica se uma renda recorrente ocorre num mes/ano dados. */
export function incomeOccursInMonth(
  income: { startDate: Date; endDate: Date | null; recurrence: string; expectedDay: number },
  year: number,
  month1to12: number,
): { occurs: boolean; date: Date | null } {
  const { start, end } = monthBoundsUTC(year, month1to12)
  if (income.startDate >= end) return { occurs: false, date: null }
  if (income.endDate && income.endDate < start) return { occurs: false, date: null }

  const diffMonths =
    (year - income.startDate.getUTCFullYear()) * 12 +
    (month1to12 - 1 - income.startDate.getUTCMonth())

  if (income.recurrence === 'MONTHLY' && diffMonths >= 0) {
    // ocorre todo mes a partir do inicio
  } else if (income.recurrence === 'QUARTERLY') {
    if (diffMonths < 0 || diffMonths % 3 !== 0) return { occurs: false, date: null }
  } else if (income.recurrence === 'YEARLY') {
    if (diffMonths < 0 || diffMonths % 12 !== 0) return { occurs: false, date: null }
  } else {
    return { occurs: false, date: null }
  }

  const day = Math.min(income.expectedDay, daysInMonth(year, month1to12 - 1))
  return { occurs: true, date: new Date(Date.UTC(year, month1to12 - 1, day)) }
}

export function remainingOf(total: Decimal | number | string, paid: Decimal | number | string): Decimal {
  return toDecimal(total).minus(toDecimal(paid))
}

/** Percentual = parte / base * 100 (retorna Decimal, ex.: 42.50 = 42.5%). */
export function percentage(part: Decimal | number | string, base: Decimal | number | string): Decimal {
  const b = toDecimal(base)
  if (b.isZero()) return new Decimal(0)
  return toDecimal(part).dividedBy(b).times(100).toDecimalPlaces(2)
}
