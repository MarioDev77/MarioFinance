'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, login, logout } from '../lib/api'
import {
  Banknote, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CreditCard,
  Download, Eye, EyeOff, HandCoins, History, LayoutDashboard, LockKeyhole, LogOut, Mail, Pencil, Plus,
  Receipt, RefreshCw, Search, Tags, Trash2, TrendingDown, Wallet,
} from 'lucide-react'

/* ======================================================================
   Tipos e constantes
   ====================================================================== */
type User = { id: string; name: string; email: string }
type Section = 'dashboard' | 'calendar' | 'income' | 'receipts' | 'expenses' | 'debts' | 'payments' | 'categories' | 'audit'
type FormType = 'income' | 'receipts' | 'expenses' | 'debts' | 'categories'
type Row = any

const SECTIONS: { id: Section; label: string; title: string; icon: any }[] = [
  { id: 'dashboard', label: 'Visão geral', title: 'Visão geral', icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendário', title: 'Calendário financeiro', icon: CalendarDays },
  { id: 'income', label: 'Rendas', title: 'Rendas mensais', icon: Wallet },
  { id: 'receipts', label: 'Entradas extras', title: 'Entradas extras', icon: HandCoins },
  { id: 'expenses', label: 'Despesas', title: 'Despesas', icon: Receipt },
  { id: 'debts', label: 'Dívidas e parcelas', title: 'Dívidas e parcelas', icon: CreditCard },
  { id: 'payments', label: 'Pagamentos', title: 'Histórico de pagamentos', icon: Banknote },
  { id: 'categories', label: 'Categorias', title: 'Categorias', icon: Tags },
  { id: 'audit', label: 'Atividades', title: 'Atividades recentes', icon: History },
]

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente', PAID: 'Pago', OVERDUE: 'Atrasado', CANCELLED: 'Cancelado',
  ACTIVE: 'Ativa', PAUSED: 'Pausada', ENDED: 'Encerrada', RECEIVED: 'Recebido',
}
const RECURRENCE_LABEL: Record<string, string> = { MONTHLY: 'Mensal', QUARTERLY: 'Trimestral', YEARLY: 'Anual' }
const METHOD_LABEL: Record<string, string> = { PIX: 'Pix', DINHEIRO: 'Dinheiro', CARTAO: 'Cartão', TRANSFERENCIA: 'Transferência', OUTRO: 'Outro' }
const ACTION_LABEL: Record<string, string> = { CREATE: 'Criou', UPDATE: 'Editou', DELETE: 'Excluiu', RESTORE: 'Restaurou', LOGIN: 'Entrou no sistema', LOGOUT: 'Saiu do sistema', PAYMENT: 'Registrou pagamento' }
const TABLE_LABEL: Record<string, string> = {
  monthlyIncome: 'renda', receipt: 'entrada extra', expense: 'despesa', debts: 'dívida',
  payments: 'pagamento', categories: 'categoria', users: 'usuário', sessions: 'sessão',
}
const EVENT_LABEL: Record<string, string> = { INCOME: 'Renda', RECEIPT: 'Entrada', EXPENSE: 'Despesa', INSTALLMENT: 'Parcela' }
const WEEKDAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

/* ======================================================================
   Funções utilitárias
   ====================================================================== */
const money = (v: any) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v || 0))
const today = () => new Date().toISOString().slice(0, 10)
// As datas são guardadas em UTC (meia-noite); exibir em UTC evita mostrar "um dia antes" no Brasil.
const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—')
const fmtDateTime = (v: string) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const isoDay = (v?: string | null) => (v ? String(v).slice(0, 10) : '')
const monthTitle = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const badgeClass = (s: string) => (s === 'PAID' || s === 'RECEIVED' ? 'paid' : s === 'OVERDUE' ? 'overdue' : s === 'PENDING' ? 'pending' : '')
const rowName = (x: Row) => x.description ?? x.name ?? ''

function exportCsv(name: string, lines: string[][]) {
  const esc = (v: any) => {
    let t = String(v ?? '')
    if (/^[=+\-@]/.test(t)) t = `'${t}` // evita injeção de fórmulas ao abrir no Excel
    return `"${t.replace(/"/g, '""')}"`
  }
  const csv = '\uFEFF' + lines.map((l) => l.map(esc).join(';')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `${name}-${today()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function blankForm(type: FormType): Row {
  const base = { description: '', amount: '', notes: '', categoryId: '' }
  if (type === 'income') return { ...base, expectedDay: '5', startDate: today(), recurrence: 'MONTHLY' }
  if (type === 'receipts') return { ...base, receivedAt: today() }
  if (type === 'expenses') return { ...base, expenseDate: today(), dueDate: today() }
  if (type === 'debts') return { description: '', originalAmount: '', interestAmount: '0', installmentCount: '2', firstDueDate: today(), notes: '' }
  return { name: '', kind: 'EXPENSE', color: '#2f7bff' }
}

function formFromRow(type: FormType, x: Row): Row {
  const common = { description: x.description ?? '', notes: x.notes ?? '', categoryId: x.categoryId ?? '' }
  if (type === 'income') return { ...common, amount: x.amount, expectedDay: String(x.expectedDay), startDate: isoDay(x.startDate), recurrence: x.recurrence }
  if (type === 'receipts') return { ...common, amount: x.amount, receivedAt: isoDay(x.receivedAt) }
  if (type === 'expenses') return { ...common, amount: x.amount, expenseDate: isoDay(x.expenseDate), dueDate: isoDay(x.dueDate) }
  return { description: x.description ?? '', notes: x.notes ?? '' }
}

function buildPayload(type: FormType, f: Row, editing: boolean): Row {
  if (type === 'income') return { description: f.description, amount: Number(f.amount), expectedDay: Number(f.expectedDay), startDate: f.startDate, recurrence: f.recurrence, notes: f.notes }
  if (type === 'receipts') return { description: f.description, amount: Number(f.amount), receivedAt: f.receivedAt, notes: f.notes, ...(editing ? { categoryId: f.categoryId || null } : f.categoryId ? { categoryId: f.categoryId } : {}) }
  if (type === 'expenses') return { description: f.description, amount: Number(f.amount), expenseDate: f.expenseDate, dueDate: f.dueDate || null, notes: f.notes, ...(editing ? { categoryId: f.categoryId || null } : f.categoryId ? { categoryId: f.categoryId } : {}) }
  if (type === 'debts') {
    if (editing) return { description: f.description, notes: f.notes }
    return { description: f.description, originalAmount: Number(f.originalAmount), interestAmount: Number(f.interestAmount || 0), installmentCount: Number(f.installmentCount), firstDueDate: f.firstDueDate, notes: f.notes }
  }
  return { name: f.name, kind: f.kind, color: f.color }
}

const MODAL_TITLE: Record<FormType, string> = { income: 'Renda mensal', receipts: 'Entrada extra', expenses: 'Despesa', debts: 'Dívida', categories: 'Categoria' }
const ENDPOINT: Record<FormType, string> = { income: 'income', receipts: 'receipts', expenses: 'expenses', debts: 'debts', categories: 'categories' }

/* ======================================================================
   Página
   ====================================================================== */
export default function Page() {
  const now = new Date()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const [section, setSection] = useState<Section>('dashboard')
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [dash, setDash] = useState<Row | null>(null)
  const [events, setEvents] = useState<Row[]>([])
  const [list, setList] = useState<{ section: string; data: Row[] }>({ section: '', data: [] })
  const [cats, setCats] = useState<Row[]>([])
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [openDebt, setOpenDebt] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const [modal, setModal] = useState<{ type: FormType; editing?: Row } | null>(null)
  const [form, setForm] = useState<Row>({})
  const [pay, setPay] = useState<{ kind: 'expense' | 'installment'; id: string; description: string } | null>(null)
  const [payForm, setPayForm] = useState({ amount: '', method: 'PIX', paidAt: today() })
  const [confirmDel, setConfirmDel] = useState<{ type: FormType; id: string; label: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const fail = useCallback((e: any) => {
    if (e?.status === 401) { setUser(null); setError('Sua sessão expirou. Entre novamente.') }
    else setError(e?.message || 'Não foi possível concluir a operação.')
  }, [])

  const notify = (msg: string) => setToast(msg)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) }, [toast])

  const loadCats = useCallback(async () => {
    try { setCats((await api<any>('categories')).data) } catch (e) { fail(e) }
  }, [fail])

  const fetchData = useCallback(async () => {
    if (!user) return
    try {
      if (section === 'dashboard') setDash((await api<any>(`dashboard?year=${ym.year}&month=${ym.month}`)).data)
      else if (section === 'calendar') setEvents((await api<any>(`calendar?year=${ym.year}&month=${ym.month}`)).data)
      else setList({ section, data: (await api<any>(section)).data })
    } catch (e) { fail(e) }
  }, [user, section, ym.year, ym.month, fail])

  useEffect(() => { api<any>('auth/me').then((r) => setUser(r.user)).catch(() => {}).finally(() => setLoading(false)) }, [])
  useEffect(() => { if (user) loadCats() }, [user, loadCats])
  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setSearch(''); setStatusFilter('ALL'); setSelectedDay(null) }, [section])

  const refreshAll = async () => { await Promise.all([fetchData(), loadCats()]) }

  async function doLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(''); setLoading(true)
    const f = new FormData(e.currentTarget)
    try { const r = await login(String(f.get('email')), String(f.get('password'))); setUser(r.user) }
    catch (err: any) { setError(err.message) }
    finally { setLoading(false) }
  }

  function openModal(type: FormType, editing?: Row) {
    setError(''); setForm(editing ? formFromRow(type, editing) : blankForm(type)); setModal({ type, editing })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!modal) return
    setSaving(true); setError('')
    try {
      const body = JSON.stringify(buildPayload(modal.type, form, !!modal.editing))
      if (modal.editing) await api(`${ENDPOINT[modal.type]}/${modal.editing.id}`, { method: 'PATCH', body })
      else await api(ENDPOINT[modal.type], { method: 'POST', body })
      setModal(null); notify(modal.editing ? 'Registro atualizado.' : 'Registro salvo.'); await refreshAll()
    } catch (err: any) { fail(err) } finally { setSaving(false) }
  }

  async function doDelete() {
    if (!confirmDel) return
    setSaving(true)
    try {
      await api(`${ENDPOINT[confirmDel.type]}/${confirmDel.id}`, { method: 'DELETE' })
      setConfirmDel(null); notify('Registro excluído.'); await refreshAll()
    } catch (err: any) { setConfirmDel(null); fail(err) } finally { setSaving(false) }
  }

  function openPay(kind: 'expense' | 'installment', id: string, description: string, amount: any) {
    setError(''); setPay({ kind, id, description }); setPayForm({ amount: String(amount), method: 'PIX', paidAt: today() })
  }

  async function doPay(e: FormEvent) {
    e.preventDefault()
    if (!pay) return
    setSaving(true)
    try {
      await api('payments', { method: 'POST', body: JSON.stringify({
        source: pay.kind === 'expense' ? 'EXPENSE' : 'INSTALLMENT',
        ...(pay.kind === 'expense' ? { expenseId: pay.id } : { installmentId: pay.id }),
        amount: Number(payForm.amount), method: payForm.method, paidAt: payForm.paidAt, description: pay.description,
      }) })
      setPay(null); notify('Pagamento registrado.'); await refreshAll()
    } catch (err: any) { setPay(null); fail(err) } finally { setSaving(false) }
  }

  const shiftMonth = (d: number) => setYm((p) => { const t = new Date(Date.UTC(p.year, p.month - 1 + d, 1)); return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 } })

  /* ---------- dados derivados ---------- */
  const rows = list.section === section ? list.data : []
  const listLoading = section !== 'dashboard' && section !== 'calendar' && list.section !== section
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((x) => (!q || rowName(x).toLowerCase().includes(q)) && (statusFilter === 'ALL' || x.status === statusFilter))
  }, [rows, search, statusFilter])
  const filteredTotal = filtered.reduce((a, x) => a + Number(x.amount ?? x.totalAmount ?? 0), 0)
  const hasStatusFilter = section === 'expenses' || section === 'debts' || section === 'income'

  const calendar = useMemo(() => {
    const byDay = new Map<number, Row[]>()
    for (const ev of events) { const d = new Date(ev.date).getUTCDate(); byDay.set(d, [...(byDay.get(d) ?? []), ev]) }
    const first = new Date(Date.UTC(ym.year, ym.month - 1, 1)).getUTCDay()
    const days = new Date(Date.UTC(ym.year, ym.month, 0)).getUTCDate()
    const inflow = events.filter((e) => e.type === 'INCOME' || e.type === 'RECEIPT').reduce((a, e) => a + Number(e.amount), 0)
    const outflow = events.filter((e) => e.type === 'EXPENSE' || e.type === 'INSTALLMENT').reduce((a, e) => a + Number(e.amount), 0)
    return { byDay, first, days, inflow, outflow }
  }, [events, ym])

  /* ======================================================================
     Tela de login / carregamento
     ====================================================================== */
  if (loading && !user) return <main className="center-screen"><div className="spinner" /></main>

  if (!user) return (
    <main className="login-page">
      <section className="login-card">
        <div className="mariofin-logo">MF</div>
        <div className="form-heading"><p className="form-eyebrow">MARIOFIN</p><h1>Login</h1><p>Seu controle financeiro, em um só lugar.</p></div>
        <form className="login-form" onSubmit={doLogin}>
          <div className="field-group"><label>E-mail</label><div className="input-with-icon"><Mail size={18} /><input name="email" type="email" placeholder="seuemail@exemplo.com" required /></div></div>
          <div className="field-group"><label>Senha</label><div className="input-with-icon"><LockKeyhole size={18} /><input name="password" type={showPassword ? 'text' : 'password'} placeholder="Sua senha" required /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></div>
          {error && <div className="error-box">{error}</div>}
          <button className="login-button" disabled={loading}>{loading ? 'Entrando...' : 'Entrar'}</button>
        </form>
      </section>
    </main>
  )

  /* ======================================================================
     Blocos de renderização
     ====================================================================== */
  const current = SECTIONS.find((s) => s.id === section)!
  const canAdd = (['income', 'receipts', 'expenses', 'debts', 'categories'] as string[]).includes(section)
  const monthNav = (
    <div className="month-nav">
      <button onClick={() => shiftMonth(-1)} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
      <span>{monthTitle(ym.year, ym.month)}</span>
      <button onClick={() => shiftMonth(1)} aria-label="Próximo mês"><ChevronRight size={18} /></button>
    </div>
  )

  const payButton = (kind: 'expense' | 'installment', id: string, description: string, amount: any) => (
    <button className="btn small white" onClick={() => openPay(kind, id, description, amount)}><CheckCircle2 size={14} /> Pagar</button>
  )

  const renderDashboard = () => {
    const income = Number(dash?.income?.total ?? 0)
    const outflow = Number(dash?.outflow?.total ?? 0)
    const max = Math.max(income, outflow, 1)
    const balance = Number(dash?.balance ?? 0)
    const catTotal = (dash?.byCategory ?? []).reduce((a: number, c: Row) => a + Number(c.total), 0) || 1
    return (
      <>
        <div className="cards">
          <article className="metric highlight"><span>SALDO PREVISTO</span><strong className={balance < 0 ? 'danger' : 'balance'}>{money(dash?.balance)}</strong><small>Entradas − despesas − parcelas</small></article>
          <article className="metric"><span>ENTRADAS</span><strong className="income">{money(dash?.income?.total)}</strong><small>Renda {money(dash?.income?.recurring)} • Extras {money(dash?.income?.extra)}</small></article>
          <article className="metric"><span>DESPESAS</span><strong className="expense">{money(dash?.outflow?.expenses)}</strong></article>
          <article className="metric"><span>PARCELAS EM ABERTO</span><strong className="debt">{money(dash?.outflow?.installments)}</strong></article>
        </div>
        <div className="cards three">
          <article className="metric"><span>JÁ PAGO NO MÊS</span><strong className="ok">{money(dash?.paid)}</strong></article>
          <article className="metric"><span>PENDENTES</span><strong>{money(dash?.pending?.total)}</strong><small>{dash?.pending?.count ?? 0} conta(s) a vencer</small></article>
          <article className="metric"><span>ATRASADAS</span><strong className={Number(dash?.overdue?.count) ? 'danger' : ''}>{money(dash?.overdue?.total)}</strong><small>{dash?.overdue?.count ?? 0} conta(s) vencida(s)</small></article>
        </div>

        <div className="grid-two">
          <article className="panel">
            <div className="panel-title"><div><span>RESUMO DO MÊS</span><h3>Entradas × saídas</h3></div><TrendingDown size={20} /></div>
            <div className="bars">
              <div className="bar-line"><div className="bar-label"><span>Entradas</span><b>{money(income)}</b></div><div className="bar-track"><i style={{ width: `${(income / max) * 100}%` }} /></div></div>
              <div className="bar-line"><div className="bar-label"><span>Saídas</span><b>{money(outflow)}</b></div><div className="bar-track"><i className="neg" style={{ width: `${(outflow / max) * 100}%` }} /></div></div>
              <div className="bar-line"><div className="bar-label"><span>{balance >= 0 ? 'Sobra prevista' : 'Falta prevista'}</span><b>{money(Math.abs(balance))}</b></div><div className="bar-track"><i className={balance < 0 ? 'neg' : ''} style={{ width: `${Math.min(100, (Math.abs(balance) / max) * 100)}%` }} /></div></div>
            </div>
          </article>
          <article className="panel">
            <div className="panel-title"><div><span>ONDE O DINHEIRO VAI</span><h3>Despesas por categoria</h3></div><Tags size={20} /></div>
            {dash?.byCategory?.length ? (
              <div className="bars">
                {dash.byCategory.map((c: Row, i: number) => (
                  <div className="bar-line" key={i}>
                    <div className="bar-label"><span><i className="dot" style={c.color ? { background: c.color } : undefined} />{c.name}</span><b>{money(c.total)} · {Math.round((Number(c.total) / catTotal) * 100)}%</b></div>
                    <div className="bar-track"><i style={{ width: `${(Number(c.total) / catTotal) * 100}%`, ...(c.color ? { background: c.color } : {}) }} /></div>
                  </div>
                ))}
              </div>
            ) : <p className="empty">Nenhuma despesa neste mês.</p>}
          </article>
        </div>

        <div className="grid-two">
          <article className="panel">
            <div className="panel-title"><div><span>PRÓXIMOS COMPROMISSOS</span><h3>Parcelas</h3></div><CalendarDays size={20} /></div>
            {dash?.upcomingInstallments?.length ? dash.upcomingInstallments.map((x: Row) => (
              <div className="list-row" key={x.id}>
                <div><strong>{x.debt?.description}</strong><small>Parcela {x.installmentNumber}/{x.debt?.installmentCount} • {fmtDate(x.dueDate)} • <span className={`badge ${badgeClass(x.status)}`}>{STATUS_LABEL[x.status]}</span></small></div>
                <div className="row-right"><b>{money(x.amount)}</b>{payButton('installment', x.id, `${x.debt?.description} — parcela ${x.installmentNumber}/${x.debt?.installmentCount}`, x.amount)}</div>
              </div>
            )) : <p className="empty">Nenhuma parcela em aberto neste mês.</p>}
          </article>
          <article className="panel">
            <div className="panel-title"><div><span>SAÍDAS</span><h3>Despesas</h3></div><TrendingDown size={20} /></div>
            {dash?.upcomingExpenses?.length ? dash.upcomingExpenses.map((x: Row) => (
              <div className="list-row" key={x.id}>
                <div><strong>{x.description}</strong><small>{fmtDate(x.dueDate || x.expenseDate)} • <span className={`badge ${badgeClass(x.status)}`}>{STATUS_LABEL[x.status]}</span></small></div>
                <div className="row-right"><b>{money(x.amount)}</b>{payButton('expense', x.id, x.description, x.amount)}</div>
              </div>
            )) : <p className="empty">Nenhuma despesa em aberto neste mês.</p>}
          </article>
        </div>
      </>
    )
  }

  const renderCalendar = () => {
    const shown = selectedDay ? calendar.byDay.get(selectedDay) ?? [] : events
    const cells: (number | null)[] = [...Array(calendar.first).fill(null), ...Array.from({ length: calendar.days }, (_, i) => i + 1)]
    const isCurrentMonth = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1
    return (
      <>
        <div className="cards three" style={{ marginTop: 0 }}>
          <article className="metric"><span>ENTRADAS DO MÊS</span><strong className="income">{money(calendar.inflow)}</strong></article>
          <article className="metric"><span>SAÍDAS DO MÊS</span><strong className="expense">{money(calendar.outflow)}</strong></article>
          <article className="metric"><span>RESULTADO</span><strong className={calendar.inflow - calendar.outflow < 0 ? 'danger' : 'balance'}>{money(calendar.inflow - calendar.outflow)}</strong></article>
        </div>
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="cal-grid">
            {WEEKDAYS.map((d) => <div className="cal-head" key={d}>{d}</div>)}
            {cells.map((d, i) => d === null ? <div className="cal-cell empty-cell" key={`e${i}`} /> : (
              <button key={d} className={`cal-cell${selectedDay === d ? ' selected' : ''}${isCurrentMonth && d === now.getDate() ? ' today' : ''}`} onClick={() => setSelectedDay(selectedDay === d ? null : d)}>
                <span>{d}</span>
                <div className="cal-dots">{(calendar.byDay.get(d) ?? []).slice(0, 6).map((ev, k) => <i key={k} className={ev.type === 'EXPENSE' || ev.type === 'INSTALLMENT' ? (ev.status === 'PAID' ? 'due' : 'out') : ''} />)}</div>
              </button>
            ))}
          </div>
        </article>
        <article className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title"><div><span>{selectedDay ? `DIA ${selectedDay}` : 'TODO O MÊS'}</span><h3>Eventos</h3></div>{selectedDay && <button className="btn small" onClick={() => setSelectedDay(null)}>Ver mês inteiro</button>}</div>
          {shown.length ? shown.map((ev, i) => {
            const out = ev.type === 'EXPENSE' || ev.type === 'INSTALLMENT'
            return (
              <div className="list-row" key={i}>
                <div><strong>{ev.description}</strong><small>{fmtDate(ev.date)} • <span className="badge income">{EVENT_LABEL[ev.type]}</span> <span className={`badge ${badgeClass(ev.status)}`}>{STATUS_LABEL[ev.status] ?? ev.status}</span></small></div>
                <div className="row-right"><b>{out ? '−' : '+'} {money(ev.amount)}</b>{out && ev.id && ev.status !== 'PAID' && ev.status !== 'CANCELLED' && payButton(ev.type === 'EXPENSE' ? 'expense' : 'installment', ev.id, ev.description, ev.amount)}</div>
              </div>
            )
          }) : <p className="empty">Nenhum evento {selectedDay ? 'neste dia' : 'neste mês'}.</p>}
        </article>
      </>
    )
  }

  const editDelete = (type: FormType, x: Row) => (
    <>
      {type !== 'categories' && <button className="icon-btn" title="Editar" onClick={() => openModal(type, x)}><Pencil size={16} /></button>}
      <button className="icon-btn danger" title="Excluir" onClick={() => setConfirmDel({ type, id: x.id, label: rowName(x) })}><Trash2 size={16} /></button>
    </>
  )

  const renderDebt = (x: Row) => {
    const total = Number(x.totalAmount), paid = Number(x.paidAmount)
    const pct = total ? Math.min(100, (paid / total) * 100) : 0
    const open = openDebt === x.id
    return (
      <div className="debt-card" key={x.id}>
        <div className="debt-head">
          <div onClick={() => setOpenDebt(open ? null : x.id)}>
            <strong>{x.description}</strong>
            <small>{x.installmentCount}x de {money(x.installmentAmount)} • 1º vencimento {fmtDate(x.firstDueDate)} • <span className={`badge ${badgeClass(x.status)}`}>{STATUS_LABEL[x.status]}</span></small>
          </div>
          <div className="row-right"><b>{money(x.totalAmount)}</b><button className="icon-btn" title="Ver parcelas" onClick={() => setOpenDebt(open ? null : x.id)}>{open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>{editDelete('debts', x)}</div>
        </div>
        <div className="progress"><i style={{ width: `${pct}%` }} /></div>
        <small style={{ color: 'var(--muted)', fontSize: 12 }}>Pago {money(paid)} de {money(total)} • restam {money(total - paid)}</small>
        {open && (
          <div className="installments">
            {(x.installments ?? []).map((i: Row) => (
              <div className="inst-row" key={i.id}>
                <span>Parcela {i.installmentNumber}/{x.installmentCount} <small>• vence {fmtDate(i.dueDate)}</small></span>
                <span className="row-right"><b>{money(i.amount)}</b><span className={`badge ${badgeClass(i.status)}`}>{STATUS_LABEL[i.status]}</span>{i.status !== 'PAID' && i.status !== 'CANCELLED' && payButton('installment', i.id, `${x.description} — parcela ${i.installmentNumber}/${x.installmentCount}`, i.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderRow = (x: Row) => {
    if (section === 'debts') return renderDebt(x)
    if (section === 'income') return (
      <div className="data-row" key={x.id}>
        <div><strong>{x.description}</strong><small>Recebe dia {x.expectedDay} • {RECURRENCE_LABEL[x.recurrence] ?? x.recurrence} • desde {fmtDate(x.startDate)} • <span className={`badge ${badgeClass(x.status)}`}>{STATUS_LABEL[x.status]}</span></small></div>
        <div className="row-right"><b>{money(x.amount)}</b>{editDelete('income', x)}</div>
      </div>
    )
    if (section === 'receipts') return (
      <div className="data-row" key={x.id}>
        <div><strong>{x.description}</strong><small>{fmtDate(x.receivedAt)} • {x.category?.name ?? 'Sem categoria'}</small></div>
        <div className="row-right"><b>{money(x.amount)}</b>{editDelete('receipts', x)}</div>
      </div>
    )
    if (section === 'expenses') return (
      <div className="data-row" key={x.id}>
        <div><strong>{x.description}</strong><small>Vence {fmtDate(x.dueDate)} • lançada em {fmtDate(x.expenseDate)} • {x.category?.name ?? 'Sem categoria'} • <span className={`badge ${badgeClass(x.status)}`}>{STATUS_LABEL[x.status]}</span></small></div>
        <div className="row-right"><b>{money(x.amount)}</b>{x.status !== 'PAID' && x.status !== 'CANCELLED' && payButton('expense', x.id, x.description, x.amount)}{editDelete('expenses', x)}</div>
      </div>
    )
    if (section === 'payments') return (
      <div className="data-row" key={x.id}>
        <div><strong>{x.description}</strong><small>{fmtDate(x.paidAt)} • {METHOD_LABEL[x.method] ?? x.method}</small></div>
        <div className="row-right"><b>{money(x.amount)}</b></div>
      </div>
    )
    if (section === 'categories') return (
      <div className="data-row" key={x.id}>
        <div><strong><i className="dot" style={{ background: x.color || 'var(--blue)' }} />{x.name}</strong><small>{x.kind === 'RECEIPT' ? 'Para entradas' : 'Para despesas'}</small></div>
        <div className="row-right">{editDelete('categories', x)}</div>
      </div>
    )
    return (
      <div className="data-row" key={x.id}>
        <div><strong>{ACTION_LABEL[x.action] ?? x.action}{TABLE_LABEL[x.tableName] && ['CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PAYMENT'].includes(x.action) ? ` — ${TABLE_LABEL[x.tableName]}` : ''}</strong><small>{fmtDateTime(x.createdAt)}</small></div>
      </div>
    )
  }

  const csvLines = (): string[][] => [
    ['Descrição', 'Valor', 'Data', 'Status'],
    ...filtered.map((x) => [rowName(x), String(x.amount ?? x.totalAmount ?? ''), isoDay(x.dueDate ?? x.expenseDate ?? x.receivedAt ?? x.paidAt ?? x.firstDueDate ?? x.startDate), STATUS_LABEL[x.status] ?? x.status ?? '']),
  ]

  const renderList = () => (
    <>
      {section !== 'audit' && (
        <div className="toolbar">
          <label className="search grow"><Search size={16} /><input placeholder="Buscar por nome ou descrição…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          {hasStatusFilter && (
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="ALL">Todos os status</option>
              {section === 'income' ? <><option value="ACTIVE">Ativas</option><option value="PAUSED">Pausadas</option><option value="ENDED">Encerradas</option></> : <><option value="PENDING">Pendentes</option><option value="PAID">Pagos</option><option value="OVERDUE">Atrasados</option></>}
            </select>
          )}
          {section !== 'categories' && <button className="btn" onClick={() => exportCsv(section, csvLines())} disabled={!filtered.length}><Download size={16} /> Exportar CSV</button>}
        </div>
      )}
      <article className="panel table-panel">
        {listLoading ? <p className="empty">Carregando…</p> : filtered.length === 0 ? <p className="empty">{rows.length ? 'Nada encontrado para este filtro.' : 'Nenhum registro cadastrado.'}</p> : <div className="data-list">{filtered.map(renderRow)}</div>}
        {!listLoading && filtered.length > 0 && section !== 'categories' && section !== 'audit' && (
          <div className="list-footer"><span>{filtered.length} registro(s)</span><span>Total: <b>{money(filteredTotal)}</b></span></div>
        )}
      </article>
    </>
  )

  const field = (label: string, key: string, props: Row = {}) => (
    <label>{label}<input value={form[key] ?? ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} /></label>
  )
  const catSelect = (kind: 'RECEIPT' | 'EXPENSE') => (
    <label>Categoria
      <select value={form.categoryId ?? ''} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
        <option value="">Sem categoria</option>
        {cats.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  )

  const renderFormFields = (type: FormType) => {
    const editing = !!modal?.editing
    if (type === 'categories') return (<>{field('Nome', 'name', { required: true, maxLength: 80 })}<label>Tipo<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="EXPENSE">Despesa</option><option value="RECEIPT">Entrada</option></select></label>{field('Cor', 'color', { type: 'color' })}</>)
    if (type === 'debts') return (<>
      {field('Descrição', 'description', { required: true })}
      {editing ? <p className="hint">Valores e parcelas não podem ser alterados depois de criados. Para mudar, exclua e cadastre novamente.</p> : <>
        {field('Valor bruto', 'originalAmount', { type: 'number', step: '0.01', min: '0.01', required: true })}
        {field('Juros', 'interestAmount', { type: 'number', step: '0.01', min: '0' })}
        {field('Número de parcelas', 'installmentCount', { type: 'number', min: '1', max: '480', required: true })}
        {field('Primeiro vencimento', 'firstDueDate', { type: 'date', required: true })}
      </>}
      <label>Observações<textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
    </>)
    return (<>
      {field('Descrição', 'description', { required: true })}
      {field('Valor', 'amount', { type: 'number', step: '0.01', min: '0.01', required: true })}
      {type === 'income' && <>
        {field('Dia do pagamento', 'expectedDay', { type: 'number', min: '1', max: '31' })}
        {field('Início', 'startDate', { type: 'date', required: true })}
        <label>Frequência<select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}><option value="MONTHLY">Mensal</option><option value="QUARTERLY">Trimestral</option><option value="YEARLY">Anual</option></select></label>
      </>}
      {type === 'receipts' && <>{field('Data recebida', 'receivedAt', { type: 'date', required: true })}{catSelect('RECEIPT')}</>}
      {type === 'expenses' && <>{field('Data da despesa', 'expenseDate', { type: 'date', required: true })}{field('Vencimento', 'dueDate', { type: 'date' })}{catSelect('EXPENSE')}</>}
      <label>Observações<textarea value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
    </>)
  }

  /* ======================================================================
     Layout principal
     ====================================================================== */
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>MF</span><div><strong>MarioFin</strong><small>Gestão financeira</small></div></div>
        <nav>{SECTIONS.map(({ id, label, icon: Icon }) => <button className={section === id ? 'active' : ''} onClick={() => { setError(''); setSection(id) }} key={id}><Icon size={17} />{label}</button>)}</nav>
        <button className="logout" onClick={async () => { await logout(); setUser(null) }}><LogOut size={17} /> Sair</button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><span className="eyebrow">PAINEL FINANCEIRO</span><h2>{current.title}</h2></div>
          <div className="topbar-actions">
            {(section === 'dashboard' || section === 'calendar') && monthNav}
            {section === 'dashboard' && <button className="primary" onClick={() => openModal('expenses')}><Plus size={17} /> Nova despesa</button>}
            {canAdd && <button className="primary" onClick={() => openModal(section as FormType)}><Plus size={17} /> Adicionar</button>}
            <button className="refresh" onClick={refreshAll}><RefreshCw size={16} /> Atualizar</button>
          </div>
        </header>

        {error && <div className="error-box"><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar">×</button></div>}

        {section === 'dashboard' ? renderDashboard() : section === 'calendar' ? renderCalendar() : renderList()}
      </section>

      {modal && (
        <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setModal(null)}>
          <form className="modal" onSubmit={save}>
            <div className="modal-head"><div><span>{modal.editing ? 'EDITAR REGISTRO' : 'NOVO REGISTRO'}</span><h3>{MODAL_TITLE[modal.type]}</h3></div><button type="button" onClick={() => setModal(null)}>×</button></div>
            {error && <div className="error-box"><span>{error}</span></div>}
            {renderFormFields(modal.type)}
            <button className="login-button" disabled={saving}>{saving ? 'Salvando...' : <><CheckCircle2 size={17} /> Salvar</>}</button>
          </form>
        </div>
      )}

      {pay && (
        <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setPay(null)}>
          <form className="modal" onSubmit={doPay}>
            <div className="modal-head"><div><span>REGISTRAR PAGAMENTO</span><h3>{pay.description}</h3></div><button type="button" onClick={() => setPay(null)}>×</button></div>
            <label>Valor pago<input type="number" step="0.01" min="0.01" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required /></label>
            <label>Forma de pagamento<select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Data do pagamento<input type="date" value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} required /></label>
            <button className="login-button" disabled={saving}>{saving ? 'Registrando...' : <><CheckCircle2 size={17} /> Confirmar pagamento</>}</button>
          </form>
        </div>
      )}

      {confirmDel && (
        <div className="modal-backdrop" onMouseDown={(e) => e.currentTarget === e.target && setConfirmDel(null)}>
          <div className="modal">
            <div className="modal-head"><div><span>CONFIRMAR EXCLUSÃO</span><h3>Excluir registro?</h3></div><button type="button" onClick={() => setConfirmDel(null)}>×</button></div>
            <p className="hint">“{confirmDel.label}” será removido da sua lista. A ação fica registrada no histórico de atividades.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button className="btn white" onClick={doDelete} disabled={saving}>{saving ? 'Excluindo...' : 'Excluir'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
