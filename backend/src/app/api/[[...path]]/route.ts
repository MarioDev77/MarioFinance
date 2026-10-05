import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ApiError, errorResponse, json, readJson, requiredDate, requiredNumber, requiredString, optionalString } from '@/lib/http'
import { audit } from '@/lib/audit'
import { hashPassword, verifyPassword } from '@/lib/password'
import { rateLimit } from '@/lib/rate-limit'
import { assertCsrf, assertOwnership, getSessionWithUser, requireAuth, revokeSession, setSessionCookie, clearSessionCookie } from '@/lib/session'
import { generateInstallmentPlan, generateMultiPlan, toDecimal, toMoneyString, monthBoundsUTC, incomeOccursInMonth } from '@/lib/finance'
import { markOverdue } from '@/lib/overdue'
import { Prisma } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ path?: string[] }> }
const publicPaths = new Set(['auth/login'])
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const serialize = (v: any): any => {
  if (v instanceof Prisma.Decimal) return v.toFixed(2)
  if (v instanceof Date) return v.toISOString()
  if (Array.isArray(v)) return v.map(serialize)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serialize(x)]))
  return v
}
const bodyId = (body: Record<string, unknown>) => { const id = body.id; if (typeof id !== 'string' || !id) throw new ApiError(400, 'VALIDATION_ERROR', 'id inválido.'); return id }
const paramsId = (parts: string[]) => { const id = parts[1]; if (!id) throw new ApiError(400, 'VALIDATION_ERROR', 'id obrigatório.'); return id }

async function handle(req: NextRequest, parts: string[]) {
  const path = parts.join('/')
  const method = req.method

  if (path === 'health' && method === 'GET') return json({ ok: true, build: 'my-share-2026-10-05', routes: ['dashboard', 'incoming', 'calendar', 'income', 'receipts', 'expenses', 'debts', 'installments', 'payments', 'categories', 'audit'] })

  if (path === 'auth/login' && method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    if (!rateLimit(`login:${ip ?? 'unknown'}`, 8, 60_000)) throw new ApiError(429, 'RATE_LIMITED', 'Muitas tentativas. Tente novamente em instantes.')
    const body = await readJson(req)
    const email = requiredString(body, 'email', 254).toLowerCase()
    const password = requiredString(body, 'password', 200)
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new ApiError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.')
    const old = await getSessionWithUser(); if (old) await revokeSession(old.id)
    const { createSession } = await import('@/lib/session')
    const session = await createSession(user.id, { ipAddress: ip, userAgent: req.headers.get('user-agent') })
    await setSessionCookie(session.token, session.expiresAt)
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await audit({ userId: user.id, action: 'LOGIN', tableName: 'users', recordId: user.id, ipAddress: ip })
    return json({ user: { id: user.id, name: user.name, email: user.email }, csrfToken: session.csrfToken })
  }
  if (path === 'auth/logout' && method === 'POST') {
    const session = await getSessionWithUser(); if (session) { assertCsrf(session, req); await revokeSession(session.id); await audit({ userId: session.userId, action: 'LOGOUT', tableName: 'sessions', recordId: session.id }) }
    await clearSessionCookie(); return json({ ok: true })
  }
  if (path === 'auth/me' && method === 'GET') {
    const session = await getSessionWithUser(); if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Acesso não autorizado.')
    return json({ user: { id: session.user.id, name: session.user.name, email: session.user.email }, csrfToken: session.csrfToken })
  }

  const session = await requireAuth()
  if (method !== 'GET' && method !== 'HEAD') assertCsrf(session, req)
  const userId = session.userId
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null

  if (parts[0] === 'categories') {
    if (method === 'GET' && parts.length === 1) return json({ data: serialize(await prisma.category.findMany({ where: { userId, deletedAt: null }, orderBy: { name: 'asc' } })) })
    if (method === 'POST' && parts.length === 1) { const b=await readJson(req); const name=requiredString(b,'name',80); const kind=b.kind==='RECEIPT'?'RECEIPT':'EXPENSE'; const c=await prisma.category.create({data:{userId,name,kind,color:optionalString(b,'color',30)}}); await audit({userId,action:'CREATE',tableName:'categories',recordId:c.id,newData:c,ipAddress:ip}); return json({data:serialize(c)},{status:201}) }
    if (method === 'DELETE') { const id=paramsId(parts); const c=await prisma.category.findFirst({where:{id,userId,deletedAt:null}}); assertOwnership(c,userId); await prisma.category.update({where:{id},data:{deletedAt:new Date(),deletedBy:userId}}); return json({ok:true}) }
  }

  const simpleMap: Record<string, 'monthlyIncome'|'receipt'|'expense'> = { income:'monthlyIncome', receipts:'receipt', expenses:'expense' }
  if (simpleMap[parts[0]]) {
    const model = simpleMap[parts[0]]
    if (method === 'GET') {
      const rows = await (prisma[model] as any).findMany({where:{userId,deletedAt:null},include:model==='expense'?{category:true}:model==='receipt'?{category:true}:undefined,orderBy:model==='monthlyIncome'?{createdAt:'desc'}:model==='expense'?{expenseDate:'desc'}:{receivedAt:'desc'}})
      return json({data:serialize(rows)})
    }
    if (method === 'POST') {
      const b=await readJson(req)
      let row:any
      if(model==='monthlyIncome') row=await prisma.monthlyIncome.create({data:{userId,description:requiredString(b,'description'),amount:toMoneyString(toDecimal(requiredNumber(b,'amount',0.01))),expectedDay:Math.min(31,Math.max(1,Math.floor(requiredNumber(b,'expectedDay',1)))),status:'ACTIVE',recurrence:['MONTHLY','QUARTERLY','YEARLY'].includes(String(b.recurrence))?b.recurrence as any:'MONTHLY',startDate:requiredDate(b,'startDate'),endDate:b.endDate?requiredDate(b,'endDate'):null,notes:optionalString(b,'notes')}})
      if(model==='receipt') row=await prisma.receipt.create({data:{userId,description:requiredString(b,'description'),amount:toMoneyString(toDecimal(requiredNumber(b,'amount',0.01))),receivedAt:requiredDate(b,'receivedAt'),categoryId:typeof b.categoryId==='string'?b.categoryId:null,notes:optionalString(b,'notes')}})
      if(model==='expense') row=await prisma.expense.create({data:{userId,description:requiredString(b,'description'),amount:toMoneyString(toDecimal(requiredNumber(b,'amount',0.01))),expenseDate:requiredDate(b,'expenseDate'),dueDate:b.dueDate?requiredDate(b,'dueDate'):null,categoryId:typeof b.categoryId==='string'?b.categoryId:null,status:'PENDING',notes:optionalString(b,'notes')}})
      await audit({userId,action:'CREATE',tableName:model,recordId:row.id,newData:row,ipAddress:ip}); return json({data:serialize(row)},{status:201})
    }
    if(method==='PATCH'){const id=paramsId(parts); const old:any=await (prisma[model] as any).findFirst({where:{id,userId,deletedAt:null}}); assertOwnership(old,userId); const b=await readJson(req); const data:any={}
      if(b.description!==undefined)data.description=requiredString(b,'description'); if(b.amount!==undefined)data.amount=toMoneyString(toDecimal(requiredNumber(b,'amount',0.01))); if(b.notes!==undefined)data.notes=optionalString(b,'notes'); if(model==='monthlyIncome'){if(b.expectedDay!==undefined)data.expectedDay=Math.min(31,Math.max(1,Math.floor(requiredNumber(b,'expectedDay',1))));if(b.recurrence!==undefined)data.recurrence=b.recurrence;if(b.status!==undefined)data.status=b.status;if(b.startDate!==undefined)data.startDate=requiredDate(b,'startDate');if(b.endDate!==undefined)data.endDate=b.endDate?requiredDate(b,'endDate'):null} if(model==='receipt'&&b.receivedAt!==undefined)data.receivedAt=requiredDate(b,'receivedAt'); if(model==='expense'){if(b.expenseDate!==undefined)data.expenseDate=requiredDate(b,'expenseDate');if(b.dueDate!==undefined)data.dueDate=b.dueDate?requiredDate(b,'dueDate'):null;if(b.status!==undefined)data.status=b.status;if(b.categoryId!==undefined)data.categoryId=b.categoryId||null}
      const row=await (prisma[model] as any).update({where:{id},data}); await audit({userId,action:'UPDATE',tableName:model,recordId:id,oldData:old,newData:row,ipAddress:ip}); return json({data:serialize(row)}) }
    if(method==='DELETE'){const id=paramsId(parts); const old:any=await (prisma[model] as any).findFirst({where:{id,userId,deletedAt:null}});assertOwnership(old,userId);await (prisma[model] as any).update({where:{id},data:{deletedAt:new Date(),deletedBy:userId}});await audit({userId,action:'DELETE',tableName:model,recordId:id,oldData:old,ipAddress:ip});return json({ok:true})}
  }

  if (parts[0] === 'debts') {
    if(method==='GET'&&parts.length===1){const debts=await prisma.debt.findMany({where:{userId,deletedAt:null},include:{installments:{orderBy:{installmentNumber:'asc'}},},orderBy:{firstDueDate:'asc'}});return json({data:serialize(debts)})}
    if(method==='POST'&&parts.length===1){
      const b=await readJson(req)
      if(Array.isArray(b.schedules)){
      const raw=b.schedules as any[]
      if(raw.length<1||raw.length>6)throw new ApiError(400,'VALIDATION_ERROR','Informe de 1 a 6 planos de parcelas.')
      const schedules=raw.map((x:any)=>{const amount=Number(x?.amount),count=Math.floor(Number(x?.count)),day=Math.floor(Number(x?.day));if(!(amount>=0.01)||!(count>=1&&count<=120)||!(day>=1&&day<=31))throw new ApiError(400,'VALIDATION_ERROR','Plano de parcelas inválido (valor, quantidade ou dia).');return{amount,count,day}})
      const m=/^(\d{4})-(\d{2})$/.exec(String(b.startMonth??''));if(!m||Number(m[2])<1||Number(m[2])>12)throw new ApiError(400,'VALIDATION_ERROR','Mês de início inválido.')
      const paidMonths=Math.max(0,Math.floor(Number(b.paidMonths??0)));if(!Number.isFinite(paidMonths))throw new ApiError(400,'VALIDATION_ERROR','Meses já pagos inválido.')
      const plan=generateMultiPlan(schedules,Number(m[1]),Number(m[2])-1)
      const total=plan.reduce((a,p)=>a.plus(p.amount),toDecimal(0))
      const paidItems=plan.filter(p=>p.monthOffset<paidMonths)
      const paidTotal=paidItems.reduce((a,p)=>a.plus(p.amount),toDecimal(0))
      const description=requiredString(b,'description')
      const debt=await prisma.$transaction(async tx=>{
        const d=await tx.debt.create({data:{userId,description,originalAmount:total.toFixed(2),interestAmount:'0.00',totalAmount:total.toFixed(2),installmentCount:plan.length,installmentAmount:plan[0].amount.toFixed(2),firstDueDate:plan[0].dueDate,paidAmount:paidTotal.toFixed(2),status:paidTotal.gte(total)?'PAID':'ACTIVE',notes:optionalString(b,'notes')}})
        await tx.debtInstallment.createMany({data:plan.map(p=>({debtId:d.id,installmentNumber:p.installmentNumber,amount:p.amount.toFixed(2),dueDate:p.dueDate,status:p.monthOffset<paidMonths?'PAID' as const:'PENDING' as const,paidAt:p.monthOffset<paidMonths?p.dueDate:null}))})
        if(paidItems.length){
          const created=await tx.debtInstallment.findMany({where:{debtId:d.id,status:'PAID'}})
          const byNum=new Map(created.map(i=>[i.installmentNumber,i.id]))
          await tx.payment.createMany({data:paidItems.map(p=>({userId,amount:p.amount.toFixed(2),paidAt:p.dueDate,description:`${description} — parcela ${p.installmentNumber}/${plan.length}`,source:'INSTALLMENT' as const,method:'OUTRO' as const,installmentId:byNum.get(p.installmentNumber)!,debtId:d.id}))})
        }
        return d})
      await audit({userId,action:'CREATE',tableName:'debts',recordId:debt.id,newData:debt,ipAddress:ip})
      return json({data:serialize(await prisma.debt.findUnique({where:{id:debt.id},include:{installments:true}}))},{status:201})
      }
      const original=toDecimal(requiredNumber(b,'originalAmount',0.01));const interest=toDecimal(Number(b.interestAmount??0));const total=original.plus(interest);const count=Math.floor(requiredNumber(b,'installmentCount',1));const first=requiredDate(b,'firstDueDate');const plan=generateInstallmentPlan(total,count,first);const debt=await prisma.$transaction(async tx=>{const d=await tx.debt.create({data:{userId,description:requiredString(b,'description'),originalAmount:original.toFixed(2),interestAmount:interest.toFixed(2),totalAmount:total.toFixed(2),installmentCount:count,installmentAmount:plan[0].amount.toFixed(2),firstDueDate:first,notes:optionalString(b,'notes')}});await tx.debtInstallment.createMany({data:plan.map(p=>({debtId:d.id,installmentNumber:p.installmentNumber,amount:p.amount.toFixed(2),dueDate:p.dueDate}))});return d});await audit({userId,action:'CREATE',tableName:'debts',recordId:debt.id,newData:debt,ipAddress:ip});return json({data:serialize(await prisma.debt.findUnique({where:{id:debt.id},include:{installments:true}}))},{status:201})}
    if(method==='PATCH'){const id=paramsId(parts);const old=await prisma.debt.findFirst({where:{id,userId,deletedAt:null},include:{installments:true}});assertOwnership(old,userId);const b=await readJson(req)
      if(b.applyShare&&typeof b.applyShare==='object'){
        const a=b.applyShare as any;const mode=a.mode==='FIXED'?'FIXED':a.mode==='CLEAR'?'CLEAR':'PERCENT';const value=Number(a.value);const scope=a.scope==='PENDING'?'PENDING':'ALL'
        if(mode==='PERCENT'&&!(value>0&&value<=100))throw new ApiError(400,'VALIDATION_ERROR','Percentual inválido (1 a 100).')
        if(mode==='FIXED'&&!(value>=0.01))throw new ApiError(400,'VALIDATION_ERROR','Valor da minha parte inválido.')
        const targets=((old as any).installments as any[]).filter((i:any)=>i.status!=='CANCELLED'&&(scope==='ALL'||i.status!=='PAID'))
        await prisma.$transaction(async tx=>{
          for(const i of targets){
            const amt=toDecimal(i.amount.toString())
            let my:any=null
            if(mode!=='CLEAR'){let m=mode==='PERCENT'?amt.times(value).dividedBy(100):toDecimal(value);if(m.gt(amt))m=amt;my=m.toDecimalPlaces(2).toFixed(2)}
            await tx.debtInstallment.update({where:{id:i.id},data:{myAmount:my}})
            if(i.status==='PAID')await tx.payment.updateMany({where:{installmentId:i.id,userId,deletedAt:null},data:{amount:my??amt.toFixed(2)}})
          }})
        await audit({userId,action:'UPDATE',tableName:'debts',recordId:id,oldData:{applyShare:null},newData:{applyShare:a},ipAddress:ip})
        return json({data:serialize(await prisma.debt.findUnique({where:{id},include:{installments:{orderBy:{installmentNumber:'asc'}}}}))})
      }
      const data:any={};if(b.description!==undefined)data.description=requiredString(b,'description');if(b.notes!==undefined)data.notes=optionalString(b,'notes');if(b.status!==undefined)data.status=b.status;const d=await prisma.debt.update({where:{id},data});await audit({userId,action:'UPDATE',tableName:'debts',recordId:id,oldData:old,newData:d,ipAddress:ip});return json({data:serialize(d)})}
    if(method==='DELETE'){const id=paramsId(parts);const old=await prisma.debt.findFirst({where:{id,userId,deletedAt:null}});assertOwnership(old,userId);await prisma.$transaction([prisma.debt.update({where:{id},data:{deletedAt:new Date(),deletedBy:userId,status:'CANCELLED'}}),prisma.payment.updateMany({where:{debtId:id,userId,deletedAt:null},data:{deletedAt:new Date(),deletedBy:userId}})]);await audit({userId,action:'DELETE',tableName:'debts',recordId:id,oldData:old,ipAddress:ip});return json({ok:true})}
  }

  if (parts[0] === 'installments' && parts.length === 2 && method === 'PATCH') {
    const id = parts[1]
    const b = await readJson(req)
    const old = await prisma.debtInstallment.findFirst({ where: { id, debt: { userId, deletedAt: null } }, include: { debt: true } })
    if (!old) throw new ApiError(404, 'NOT_FOUND', 'Parcela não encontrada.')
    if (old.status === 'CANCELLED') throw new ApiError(400, 'VALIDATION_ERROR', 'Parcela cancelada não pode ser editada.')
    const data: any = {}
    if (b.amount !== undefined) data.amount = toMoneyString(toDecimal(requiredNumber(b, 'amount', 0.01)))
    if (b.notes !== undefined) data.notes = optionalString(b, 'notes', 500)
    if (b.myAmount !== undefined) data.myAmount = (b.myAmount === null || b.myAmount === '') ? null : toMoneyString(toDecimal(requiredNumber(b, 'myAmount', 0.01)))
    {
      const newAmount = data.amount ?? old.amount.toString()
      const newMy = data.myAmount !== undefined ? data.myAmount : old.myAmount
      if (newMy != null && toDecimal(newMy.toString()).gt(toDecimal(newAmount.toString()))) throw new ApiError(400, 'VALIDATION_ERROR', 'Minha parte não pode ser maior que a parcela.')
    }
    if (b.status !== undefined) {
      if (b.status !== 'PAID' && b.status !== 'PENDING') throw new ApiError(400, 'VALIDATION_ERROR', 'status inválido.')
      if (b.status === 'PAID') { data.status = 'PAID'; data.paidAt = b.paidAt ? requiredDate(b, 'paidAt') : (old.paidAt ?? new Date()) }
      else { data.status = 'PENDING'; data.paidAt = null }
    }
    const method2 = ['PIX', 'DINHEIRO', 'CARTAO', 'TRANSFERENCIA', 'OUTRO'].includes(String(b.method)) ? (b.method as any) : 'OUTRO'
    const updated = await prisma.$transaction(async (tx) => {
      const inst = await tx.debtInstallment.update({ where: { id }, data })
      const payments = await tx.payment.findMany({ where: { installmentId: id, userId, deletedAt: null } })
      if (inst.status === 'PAID') {
        const paidAt = inst.paidAt ?? new Date()
        if (payments.length === 0) await tx.payment.create({ data: { userId, amount: inst.myAmount ?? inst.amount, paidAt, description: `${old.debt.description} — parcela ${inst.installmentNumber}/${old.debt.installmentCount}`, source: 'INSTALLMENT', method: method2, installmentId: id, debtId: inst.debtId } })
        else await tx.payment.update({ where: { id: payments[0].id }, data: { amount: inst.myAmount ?? inst.amount, paidAt } })
      } else if (payments.length) {
        await tx.payment.updateMany({ where: { installmentId: id, userId, deletedAt: null }, data: { deletedAt: new Date(), deletedBy: userId } })
      }
      // recalcula a dívida a partir das parcelas (o servidor é a fonte da verdade)
      const all = (await tx.debtInstallment.findMany({ where: { debtId: inst.debtId } })).filter((x) => x.status !== 'CANCELLED')
      const total = all.reduce((a, x) => a.plus(x.amount), new Prisma.Decimal(0))
      const paid = all.filter((x) => x.status === 'PAID').reduce((a, x) => a.plus(x.amount), new Prisma.Decimal(0))
      await tx.debt.update({ where: { id: inst.debtId }, data: { totalAmount: total, interestAmount: total.minus(old.debt.originalAmount), paidAmount: paid, status: old.debt.status === 'CANCELLED' ? 'CANCELLED' : paid.gte(total) ? 'PAID' : 'ACTIVE' } })
      return inst
    })
    await audit({ userId, action: 'UPDATE', tableName: 'debt_installments', recordId: id, oldData: old, newData: updated, ipAddress: ip })
    return json({ data: serialize(updated) })
  }

  if(path==='installments'&&method==='GET'){const rows=await prisma.debtInstallment.findMany({where:{debt:{userId,deletedAt:null}},include:{debt:true},orderBy:{dueDate:'asc'}});return json({data:serialize(rows)})}

  if(path==='payments'){
    if(method==='GET'){const rows=await prisma.payment.findMany({where:{userId,deletedAt:null},include:{expense:true,installment:true,debt:true},orderBy:{paidAt:'desc'}});return json({data:serialize(rows)})}
    if(method==='POST'){const b=await readJson(req);const amount=toDecimal(requiredNumber(b,'amount',0.01));const source=String(b.source) as any;const methodP=String(b.method) as any;let expenseId:string|undefined,installmentId:string|undefined,debtId:string|undefined;if(source==='EXPENSE'){expenseId=requiredString(b,'expenseId');const e=await prisma.expense.findFirst({where:{id:expenseId,userId,deletedAt:null}});if(!e)throw new ApiError(404,'NOT_FOUND','Despesa não encontrada.')}if(source==='INSTALLMENT'){installmentId=requiredString(b,'installmentId');const inst=await prisma.debtInstallment.findFirst({where:{id:installmentId,debt:{userId,deletedAt:null}}});if(!inst)throw new ApiError(404,'NOT_FOUND','Parcela não encontrada.');debtId=inst.debtId}
      const p=await prisma.$transaction(async tx=>{const payment=await tx.payment.create({data:{userId,amount:amount.toFixed(2),paidAt:b.paidAt?requiredDate(b,'paidAt'):new Date(),description:requiredString(b,'description'),source,method:methodP,expenseId,installmentId,debtId,notes:optionalString(b,'notes')}});if(expenseId)await tx.expense.update({where:{id:expenseId},data:{status:'PAID',paidAt:payment.paidAt}});if(installmentId){const inst=await tx.debtInstallment.update({where:{id:installmentId},data:{status:'PAID',paidAt:payment.paidAt}});const agg=await tx.debtInstallment.aggregate({where:{debtId:inst.debtId,status:'PAID'},_sum:{amount:true}});const debt=await tx.debt.findUnique({where:{id:inst.debtId}});const paid=agg._sum.amount??new Prisma.Decimal(0);if(debt)await tx.debt.update({where:{id:inst.debtId},data:{paidAmount:paid,status:paid.gte(debt.totalAmount)?'PAID':'ACTIVE'}})}return payment});await audit({userId,action:'PAYMENT',tableName:'payments',recordId:p.id,newData:p,ipAddress:ip});return json({data:serialize(p)},{status:201})}
  }

  if(path==='calendar'&&method==='GET'){const u=new URL(req.url);const year=Number(u.searchParams.get('year')??new Date().getUTCFullYear());const month=Number(u.searchParams.get('month')??new Date().getUTCMonth()+1);const {start,end}=monthBoundsUTC(year,month);const [incomes,receipts,expenses,installments]=await Promise.all([prisma.monthlyIncome.findMany({where:{userId,deletedAt:null,status:'ACTIVE'}}),prisma.receipt.findMany({where:{userId,deletedAt:null,receivedAt:{gte:start,lt:end}}}),prisma.expense.findMany({where:{userId,deletedAt:null,OR:[{expenseDate:{gte:start,lt:end}},{dueDate:{gte:start,lt:end}}]}}),prisma.debtInstallment.findMany({where:{debt:{userId,deletedAt:null},dueDate:{gte:start,lt:end}},include:{debt:true}})]);const events:any[]=[];for(const i of incomes){const x=incomeOccursInMonth(i,year,month);if(x.occurs)events.push({type:'INCOME',date:x.date,description:i.description,amount:i.amount,status:i.status})}for(const r of receipts)events.push({type:'RECEIPT',date:r.receivedAt,description:r.description,amount:r.amount,status:'RECEIVED'});for(const e of expenses)events.push({type:'EXPENSE',date:e.dueDate??e.expenseDate,description:e.description,amount:e.amount,status:e.status,id:e.id});for(const i of installments)events.push({type:'INSTALLMENT',date:i.dueDate,description:`${i.debt.description} — parcela ${i.installmentNumber}/${i.debt.installmentCount}`,amount:i.myAmount??i.amount,fullAmount:i.amount,status:i.status,id:i.id});return json({data:serialize(events.sort((a,b)=>new Date(a.date).getTime()-new Date(b.date).getTime()))})}

  if(path==='dashboard'&&method==='GET'){
    await markOverdue(userId)
    const u=new URL(req.url);const now=new Date()
    const year=Number(u.searchParams.get('year')??now.getUTCFullYear());const month=Number(u.searchParams.get('month')??now.getUTCMonth()+1)
    if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12||year<2000||year>2100)throw new ApiError(400,'VALIDATION_ERROR','Período inválido.')
    const {start,end}=monthBoundsUTC(year,month)
    const [incomes,receipts,expenses,installments]=await Promise.all([
      prisma.monthlyIncome.findMany({where:{userId,deletedAt:null,status:'ACTIVE'}}),
      prisma.receipt.findMany({where:{userId,deletedAt:null,receivedAt:{gte:start,lt:end}}}),
      prisma.expense.findMany({where:{userId,deletedAt:null,OR:[{expenseDate:{gte:start,lt:end}},{dueDate:{gte:start,lt:end}}]},include:{category:true},orderBy:{expenseDate:'asc'}}),
      prisma.debtInstallment.findMany({where:{debt:{userId,deletedAt:null},dueDate:{gte:start,lt:end}},include:{debt:true},orderBy:{dueDate:'asc'}})
    ])
    const zero=()=>new Prisma.Decimal(0)
    let recurring=zero();for(const i of incomes){const x=incomeOccursInMonth(i,year,month);if(x.occurs)recurring=recurring.plus(i.amount)}
    const sum=(rows:{amount:Prisma.Decimal}[])=>rows.reduce((a,r)=>a.plus(r.amount),zero())
    const extra=sum(receipts)
    const expActive=expenses.filter(x=>x.status!=='CANCELLED')
    const instActive=installments.filter(x=>x.status!=='CANCELLED').map(x=>({...x,amount:x.myAmount??x.amount}))
    const exp=sum(expActive)
    const inst=sum(instActive.filter(x=>x.status!=='PAID'))
    const paid=sum(expActive.filter(x=>x.status==='PAID')).plus(sum(instActive.filter(x=>x.status==='PAID')))
    const overdueExp=expActive.filter(x=>x.status==='OVERDUE');const overdueInst=instActive.filter(x=>x.status==='OVERDUE')
    const pendingExp=expActive.filter(x=>x.status==='PENDING');const pendingInst=instActive.filter(x=>x.status==='PENDING')
    const cat=new Map<string,{name:string;color:string|null;total:Prisma.Decimal}>()
    for(const e of expActive){const key=e.category?.id??'none';const cur=cat.get(key)??{name:e.category?.name??'Sem categoria',color:e.category?.color??null,total:zero()};cur.total=cur.total.plus(e.amount);cat.set(key,cur)}
    const totalIncome=recurring.plus(extra)
    return json({data:serialize({
      month:{year,month},
      income:{recurring,extra,total:totalIncome},
      outflow:{expenses:exp,installments:inst,total:exp.plus(inst)},
      balance:totalIncome.minus(exp).minus(inst),
      paid,
      pending:{count:pendingExp.length+pendingInst.length,total:sum(pendingExp).plus(sum(pendingInst))},
      overdue:{count:overdueExp.length+overdueInst.length,total:sum(overdueExp).plus(sum(overdueInst))},
      byCategory:[...cat.values()].sort((a,b)=>b.total.comparedTo(a.total)),
      upcomingInstallments:installments.filter(x=>x.status!=='PAID'&&x.status!=='CANCELLED').slice(0,8),
      upcomingExpenses:expenses.filter(x=>x.status!=='PAID'&&x.status!=='CANCELLED').slice(0,8)
    })})
  }

  if (path === 'incoming' && method === 'GET') {
    const u = new URL(req.url); const now = new Date()
    const year = Number(u.searchParams.get('year') ?? now.getUTCFullYear()); const month = Number(u.searchParams.get('month') ?? now.getUTCMonth() + 1)
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2000 || year > 2100) throw new ApiError(400, 'VALIDATION_ERROR', 'Período inválido.')
    const { start, end } = monthBoundsUTC(year, month)
    const [incomes, receipts] = await Promise.all([
      prisma.monthlyIncome.findMany({ where: { userId, deletedAt: null, status: 'ACTIVE' }, orderBy: { expectedDay: 'asc' } }),
      prisma.receipt.findMany({ where: { userId, deletedAt: null, receivedAt: { gte: start, lt: end } }, include: { category: true }, orderBy: { receivedAt: 'asc' } }),
    ])
    const recurring = incomes.flatMap((i) => { const x = incomeOccursInMonth(i, year, month); return x.occurs ? [{ ...i, occursOn: x.date }] : [] })
    const sumRec = recurring.reduce((a, r) => a.plus(r.amount), new Prisma.Decimal(0))
    const sumExtra = receipts.reduce((a, r) => a.plus(r.amount), new Prisma.Decimal(0))
    return json({ data: serialize({ month: { year, month }, recurring, extras: receipts, totals: { recurring: sumRec, extra: sumExtra, total: sumRec.plus(sumExtra) } }) })
  }

  if(path==='audit'&&method==='GET'){const rows=await prisma.auditLog.findMany({where:{userId},orderBy:{createdAt:'desc'},take:100});return json({data:serialize(rows)})}
  throw new ApiError(404,'NOT_FOUND','Rota não encontrada.')
}

export async function GET(req:NextRequest,ctx:Ctx){try{return await handle(req,await (await ctx.params).path??[])}catch(e){return errorResponse(e)}}
export async function POST(req:NextRequest,ctx:Ctx){try{return await handle(req,await (await ctx.params).path??[])}catch(e){return errorResponse(e)}}
export async function PATCH(req:NextRequest,ctx:Ctx){try{return await handle(req,await (await ctx.params).path??[])}catch(e){return errorResponse(e)}}
export async function DELETE(req:NextRequest,ctx:Ctx){try{return await handle(req,await (await ctx.params).path??[])}catch(e){return errorResponse(e)}}
