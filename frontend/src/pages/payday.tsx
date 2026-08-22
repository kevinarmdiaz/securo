import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  dashboard as dashboardApi,
  loans as loansApi,
  accounts as accountsApi,
  transactions as transactionsApi,
  interestRates as ratesApi,
  oneOffDebts as oneOffDebtsApi,
  recurring as recurringApi,
} from '@/lib/api'
import type { ProjectedTransaction, Loan, Account, InterestRate, OneOffDebt, RecurringTransaction } from '@/types'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'
import {
  CheckCircle2, Circle, Wallet, AlertTriangle, Upload,
  Flame, Calendar as CalendarIcon, Zap, Table2, TrendingUp, Repeat,
} from 'lucide-react'
import { toast } from 'sonner'

// ═══════════════ Helpers de tasa / plazo ═══════════════

function matchRate(account: Account, rates: InterestRate[]): InterestRate | undefined {
  const an = account.name.toLowerCase()
  return rates
    .filter((r) => r.rate_type.includes('compra') || r.rate_type === 'otro')
    .filter((r) => {
      const pn = r.product_name.toLowerCase()
      return (an.includes('mc') && pn.includes('mastercard'))
        || (an.includes('visa') && pn.includes('visa'))
        || (an.includes('lulo') && r.entity.toLowerCase().includes('lulo'))
    })
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
}

function bankLabel(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('occidente')) return 'Banco de Occidente'
  if (n.includes('lulo')) return 'Lulo Bank'
  if (n.includes('bancolombia')) return 'Bancolombia'
  if (n.includes('avancoop')) return 'Avancoop'
  if (n.includes('santander')) return 'Banco Santander'
  return name
}

/** Plazo en meses para liquidar con la cuota actual, dada tasa mensual en % (MV).
 *  Infinity si la cuota no alcanza a cubrir intereses. */
function payoffMonths(balance: number, payment: number, monthlyRatePct: number): number {
  if (balance <= 0) return 0
  if (payment <= 0) return Infinity
  const r = monthlyRatePct / 100
  if (r <= 0) return Math.ceil(balance / payment)
  if (payment <= balance * r) return Infinity
  const n = -Math.log(1 - (balance * r) / payment) / Math.log(1 + r)
  return Math.ceil(n)
}

function formatPlazo(months: number): string {
  if (!isFinite(months)) return '∞'
  if (months <= 1) return '1 mes'
  return `${months} meses`
}

type MasterRow = {
  id: string
  banco: string
  nombre: string
  deuda: number
  plazo: number
  cuota: number
  tasaMV: number
  currency: string
  kind: 'loan' | 'tc' | 'one_off'
}

// ═══════════════ Checklist accionable (payday hasta próximo payday) ═══════════════

type Priority = 'critical' | 'high' | 'normal' | 'low'
type ObligationItem = {
  key: string
  source: 'recurring' | 'loan' | 'tc_payment' | 'one_off'
  source_id: string
  description: string
  amount: number
  currency: string
  account_id: string | null
  category_id: string | null
  due_date: string
  priority: Priority
  paid?: boolean
  paidTxId?: string
}

const priorityMeta: Record<Priority, { label: string; color: string; icon: React.ElementType }> = {
  critical: { label: 'Crítico', color: 'text-rose-500 bg-rose-500/10 border-rose-500/30', icon: Flame },
  high:     { label: 'Alto',    color: 'text-amber-500 bg-amber-500/10 border-amber-500/30', icon: AlertTriangle },
  normal:   { label: 'Normal',  color: 'text-primary bg-primary/10 border-primary/30', icon: CalendarIcon },
  low:      { label: 'Bajo',    color: 'text-muted-foreground bg-muted border-border', icon: Circle },
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000)
}

function derivePriority(item: Omit<ObligationItem, 'priority'>): Priority {
  const desc = item.description.toLowerCase()
  const today = new Date()
  const due = new Date(item.due_date)
  const days = daysBetween(today, due)
  if (desc.includes('solventa')) return 'critical'
  if (desc.includes('suárez') || desc.includes('suarez')) return 'critical'
  if (desc.includes('dian')) return 'critical'
  if (desc.includes('tarjeta') || desc.includes('credencial') || desc.includes('mastercard') || desc.includes('visa')) {
    return days <= 3 ? 'critical' : days <= 7 ? 'high' : 'normal'
  }
  if (days <= 3) return 'critical'
  if (days <= 7) return 'high'
  if (days <= 15) return 'normal'
  return 'low'
}

// ═══════════════ UI helpers ═══════════════

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>{children}</div>
}
function CardTitle({ children, icon: Icon }: { children: React.ReactNode; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="font-semibold text-sm">{children}</h3>
    </div>
  )
}

export default function PaydayPage() {
  const qc = useQueryClient()
  const [selectedFile, setSelectedFile] = useState<Record<string, File>>({})
  const [paidLocal, setPaidLocal] = useState<Record<string, string>>({})

  const currentMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [])

  const paydayWindow = useMemo(() => {
    const today = new Date()
    const end = new Date(today.getTime() + 35 * 86400000)
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { from: fmt(today), to: fmt(end) }
  }, [])

  const { data: projected = [] } = useQuery<ProjectedTransaction[]>({
    queryKey: ['projected-window', paydayWindow.from, paydayWindow.to],
    queryFn: () => dashboardApi.projectedTransactions({ from: paydayWindow.from, to: paydayWindow.to }),
  })
  const { data: loans = [] }       = useQuery<Loan[]>({ queryKey: ['loans'], queryFn: () => loansApi.list() })
  const { data: accounts = [] }    = useQuery<Account[]>({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })
  const { data: rates = [] }       = useQuery<InterestRate[]>({ queryKey: ['interest-rates'], queryFn: () => ratesApi.list() })
  const { data: oneOffs = [] }     = useQuery<OneOffDebt[]>({
    queryKey: ['one-off-debts', currentMonth],
    queryFn: () => oneOffDebtsApi.list({ target_month: currentMonth }),
  })
  const { data: recs = [] }        = useQuery<RecurringTransaction[]>({ queryKey: ['recurring'], queryFn: () => recurringApi.list() })

  const accountName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name || '—'

  // ─── SECCIÓN 1: Tabla maestra de obligaciones ───
  const masterRows = useMemo<MasterRow[]>(() => {
    const rows: MasterRow[] = []
    for (const l of loans) {
      if (l.status !== 'active') continue
      rows.push({
        id: `loan:${l.id}`,
        banco: bankLabel(l.entity || l.name),
        nombre: l.name,
        deuda: Number(l.current_balance),
        plazo: payoffMonths(Number(l.current_balance), Number(l.monthly_payment), Number(l.monthly_rate)),
        cuota: Number(l.monthly_payment),
        tasaMV: Number(l.monthly_rate),
        currency: l.currency,
        kind: 'loan',
      })
    }
    for (const a of accounts) {
      if (a.type !== 'credit_card' || Number(a.balance) <= 0) continue
      const rate = matchRate(a, rates)
      const mv = rate ? Number(rate.mv) : 0
      const cuota = Number(a.minimum_payment) || 0
      rows.push({
        id: `tc:${a.id}`,
        banco: bankLabel(a.name),
        nombre: a.name,
        deuda: Number(a.balance),
        plazo: cuota > 0 ? payoffMonths(Number(a.balance), cuota, mv) : Infinity,
        cuota,
        tasaMV: mv,
        currency: a.currency,
        kind: 'tc',
      })
    }
    for (const o of oneOffs) {
      if (o.paid) continue
      rows.push({
        id: `one_off:${o.id}`,
        banco: o.entity || '—',
        nombre: o.name,
        deuda: Number(o.amount),
        plazo: 1,
        cuota: Number(o.amount),
        tasaMV: 0,
        currency: o.currency,
        kind: 'one_off',
      })
    }
    return rows.sort((a, b) => b.tasaMV - a.tasaMV)
  }, [loans, accounts, rates, oneOffs])

  const masterTotalDeuda = masterRows.reduce((s, r) => s + r.deuda, 0)
  const masterTotalCuota = masterRows.reduce((s, r) => s + r.cuota, 0)

  // ─── SECCIÓN 2: Semáforo del sueldo ───
  const monthlySalary = recs
    .filter((r) => r.type === 'credit' && r.is_active && r.frequency === 'monthly')
    .reduce((s, r) => s + Number(r.amount), 0)
  const disponible = monthlySalary - masterTotalCuota

  // ─── SECCIÓN 3: Suscripciones agrupadas por cuenta pagadora ───
  const subscriptions = useMemo(() => {
    const map = new Map<string, { account: string; items: RecurringTransaction[]; total: number }>()
    for (const r of recs) {
      if (r.type !== 'debit' || !r.is_active) continue
      const acc = accountName(r.account_id)
      const entry = map.get(acc) ?? { account: acc, items: [], total: 0 }
      const monthly = r.frequency === 'monthly' ? Number(r.amount)
        : r.frequency === 'weekly' ? Number(r.amount) * 4.33
        : r.frequency === 'quarterly' ? Number(r.amount) / 3
        : r.frequency === 'yearly' ? Number(r.amount) / 12
        : Number(r.amount)
      entry.items.push(r)
      entry.total += monthly
      map.set(acc, entry)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [recs, accounts])

  // ─── SECCIÓN 4: Checklist accionable (payday → próximo payday) ───
  const items = useMemo<ObligationItem[]>(() => {
    const out: ObligationItem[] = []

    for (const p of projected) {
      if (p.type !== 'debit') continue
      const base = {
        key: `rec:${p.recurring_id}:${p.date}`,
        source: 'recurring' as const,
        source_id: p.recurring_id,
        description: p.description,
        amount: Math.abs(Number(p.amount)),
        currency: p.currency,
        account_id: p.account_id,
        category_id: p.category_id,
        due_date: p.date,
      }
      out.push({ ...base, priority: derivePriority(base) })
    }

    for (const l of loans) {
      if (l.status !== 'active') continue
      const base = {
        key: `loan:${l.id}:${currentMonth}`,
        source: 'loan' as const,
        source_id: l.id,
        description: `Cuota ${l.name}`,
        amount: Number(l.monthly_payment),
        currency: l.currency,
        account_id: null,
        category_id: null,
        due_date: l.start_date,
      }
      out.push({ ...base, priority: derivePriority(base) })
    }

    for (const a of accounts) {
      if (a.type === 'credit_card' && a.minimum_payment && Number(a.minimum_payment) > 0 && a.next_due_date) {
        const base = {
          key: `tc:${a.id}:${a.next_due_date}`,
          source: 'tc_payment' as const,
          source_id: a.id,
          description: `Pago mínimo ${a.name}`,
          amount: Number(a.minimum_payment),
          currency: a.currency,
          account_id: null,
          category_id: null,
          due_date: a.next_due_date,
        }
        out.push({ ...base, priority: derivePriority(base) })
      }
    }

    for (const o of oneOffs) {
      if (o.paid) continue
      const base = {
        key: `one_off:${o.id}`,
        source: 'one_off' as const,
        source_id: o.id,
        description: o.name,
        amount: Number(o.amount),
        currency: o.currency,
        account_id: null,
        category_id: null,
        due_date: o.due_date || o.target_month,
      }
      out.push({ ...base, priority: derivePriority(base) })
    }

    for (const it of out) {
      if (paidLocal[it.key]) {
        it.paid = true
        it.paidTxId = paidLocal[it.key]
      }
    }

    const priorityOrder: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 }
    return out.sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? 1 : -1
      if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority]
      return a.due_date.localeCompare(b.due_date)
    })
  }, [projected, loans, accounts, oneOffs, paidLocal, currentMonth])

  const totalPending = items.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0)
  const totalPaid    = items.filter((i) =>  i.paid).reduce((s, i) => s + i.amount, 0)
  const criticalCount = items.filter((i) => !i.paid && i.priority === 'critical').length
  const paidCount = items.filter((i) => i.paid).length

  const LULO_AHORROS = accounts.find((a) => a.name === 'Lulo Bank Ahorros')?.id
  const luloBalance = LULO_AHORROS ? Number(accounts.find((a) => a.id === LULO_AHORROS)?.balance ?? 0) : 0

  const markPaid = useMutation({
    mutationFn: async (it: ObligationItem) => {
      const body = {
        date: new Date().toISOString().slice(0, 10),
        amount: it.amount,
        currency: it.currency,
        type: 'debit',
        description: `[Payday] ${it.description}`,
        account_id: it.account_id ?? LULO_AHORROS,
        category_id: it.category_id ?? undefined,
        notes: `Marcado como pagado desde Payday Splitter. Fuente: ${it.source} ${it.source_id}`,
      }
      const tx = await transactionsApi.create(body as any)
      if (it.source === 'one_off') {
        await oneOffDebtsApi.update(it.source_id, { paid: true, paid_transaction_id: tx.id })
      }
      return { key: it.key, tx }
    },
    onSuccess: ({ key, tx }) => {
      setPaidLocal((prev) => ({ ...prev, [key]: tx.id }))
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['loans'] })
      qc.invalidateQueries({ queryKey: ['one-off-debts'] })
      toast.success('Pago registrado')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al registrar pago'),
  })

  const uploadAttachment = useMutation({
    mutationFn: async ({ txId, file }: { txId: string; file: File }) => {
      return transactionsApi.attachments.upload(txId, file)
    },
    onSuccess: () => toast.success('Comprobante subido'),
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error subiendo comprobante'),
  })

  return (
    <div className="space-y-6">
      <PageHeader section="Finanzas" title="Payday Splitter" />

      {/* ═══ SECCIÓN 1: Tabla maestra de obligaciones ═══ */}
      <Card>
        <CardTitle icon={Table2}>Tabla maestra de obligaciones</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 pr-3">Banco</th>
                <th className="pb-2 pr-3">Nombre</th>
                <th className="pb-2 pr-3 text-right">Deuda</th>
                <th className="pb-2 pr-3 text-right">Plazo</th>
                <th className="pb-2 pr-3 text-right">Cuota mes</th>
                <th className="pb-2 text-right">Tasa MV</th>
              </tr>
            </thead>
            <tbody>
              {masterRows.map((r) => (
                <tr key={r.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2 pr-3 text-muted-foreground">{r.banco}</td>
                  <td className="py-2 pr-3 font-medium">{r.nombre}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{formatCurrency(r.deuda, r.currency)}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">{formatPlazo(r.plazo)}</td>
                  <td className="py-2 pr-3 text-right text-rose-500 font-semibold">{formatCurrency(r.cuota, r.currency)}</td>
                  <td className="py-2 text-right">
                    {r.tasaMV > 0
                      ? <span className={r.tasaMV > 2 ? 'text-rose-500 font-bold' : 'text-amber-500'}>{r.tasaMV.toFixed(2)}%</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border font-bold">
                <td className="pt-3" colSpan={2}>Total</td>
                <td className="pt-3 text-right">{formatCurrency(masterTotalDeuda, 'COP')}</td>
                <td />
                <td className="pt-3 text-right text-rose-500">{formatCurrency(masterTotalCuota, 'COP')}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {/* ═══ SECCIÓN 2: Semáforo del sueldo ═══ */}
      <Card>
        <CardTitle icon={TrendingUp}>¿Cuánto me queda este mes?</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Sueldo mensual</p>
            <p className="text-lg font-bold text-emerald-500">+{formatCurrency(monthlySalary, 'COP')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Deudas del mes (tabla maestra)</p>
            <p className="text-lg font-bold text-rose-500">−{formatCurrency(masterTotalCuota, 'COP')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">A pagar este mes</p>
            <p className="text-lg font-bold text-rose-500">{formatCurrency(masterTotalCuota, 'COP')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Queda disponible</p>
            <p className={`text-lg font-bold ${disponible >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {formatCurrency(disponible, 'COP')}
            </p>
          </div>
        </div>
        {disponible < 0 && (
          <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5" />
            <p className="text-xs text-rose-500">
              Las cuotas del mes superan el sueldo. Evalúa refinanciar en{' '}
              <a href="/loans/refinance" className="underline font-semibold">/loans/refinance</a>.
            </p>
          </div>
        )}
      </Card>

      {/* ═══ SECCIÓN 3: Suscripciones y recurrentes por cuenta pagadora ═══ */}
      {subscriptions.length > 0 && (
        <Card>
          <CardTitle icon={Repeat}>Suscripciones y recurrentes por cuenta</CardTitle>
          <div className="space-y-4">
            {subscriptions.map((s) => (
              <div key={s.account}>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="font-semibold">{s.account}</span>
                  <span className="font-bold text-rose-500">{formatCurrency(s.total, 'COP')}/mes</span>
                </div>
                <div className="space-y-1">
                  {s.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-xs text-muted-foreground pl-3 border-l-2 border-border">
                      <span>{it.description}</span>
                      <span>{formatCurrency(Number(it.amount), it.currency)} · {it.frequency}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ═══ SECCIÓN 4: Resumen + checklist accionable ═══ */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground">Disponible Lulo Ahorros</p>
          </div>
          <p className="text-xl font-bold text-emerald-500">{formatCurrency(luloBalance, 'COP')}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Pendiente pagar</p>
          <p className="text-xl font-bold text-rose-500">{formatCurrency(totalPending, 'COP')}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{items.length - paidCount} obligaciones</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground mb-1">Ya pagado este mes</p>
          <p className="text-xl font-bold text-emerald-500">{formatCurrency(totalPaid, 'COP')}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{paidCount} pagos registrados</p>
        </div>
        <div className={`rounded-xl border p-4 ${criticalCount > 0 ? 'border-rose-500/40 bg-rose-500/5' : 'border-border bg-card'}`}>
          <div className="flex items-center gap-2 mb-1">
            <Flame className="h-4 w-4 text-rose-500" />
            <p className="text-xs text-muted-foreground">Críticos pendientes</p>
          </div>
          <p className={`text-xl font-bold ${criticalCount > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
            {criticalCount}
          </p>
        </div>
      </div>

      {totalPending > luloBalance && (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30">
          <AlertTriangle className="h-5 w-5 text-rose-500 mt-0.5" />
          <div>
            <p className="font-semibold text-rose-500">Déficit: {formatCurrency(totalPending - luloBalance, 'COP')}</p>
            <p className="text-sm text-muted-foreground">
              El pendiente supera el saldo disponible. Prioriza pagos críticos y evalúa refinanciar en{' '}
              <a href="/loans/refinance" className="text-primary hover:underline">/loans/refinance</a>.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {items.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
            No hay obligaciones proyectadas para este mes.
          </div>
        )}
        {items.map((it) => {
          const meta = priorityMeta[it.priority]
          const Icon = meta.icon
          const daysUntil = daysBetween(new Date(), new Date(it.due_date))
          return (
            <div
              key={it.key}
              className={`rounded-xl border p-4 transition-all ${
                it.paid
                  ? 'border-emerald-500/30 bg-emerald-500/5 opacity-70'
                  : 'border-border bg-card hover:bg-muted/30'
              }`}
            >
              <div className="flex items-center gap-3">
                <button
                  onClick={() => !it.paid && markPaid.mutate(it)}
                  disabled={it.paid || markPaid.isPending}
                  className="shrink-0"
                >
                  {it.paid
                    ? <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    : <Circle className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors" />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-semibold ${it.paid ? 'line-through text-muted-foreground' : ''}`}>
                      {it.description}
                    </p>
                    {!it.paid && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${meta.color}`}>
                        <Icon className="h-3 w-3" /> {meta.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span>Vence {it.due_date} {daysUntil >= 0 ? `(en ${daysUntil}d)` : `(vencido ${-daysUntil}d)`}</span>
                    {it.account_id && <span>· desde {accountName(it.account_id)}</span>}
                    <span className="capitalize">
                      · {it.source === 'tc_payment' ? 'Pago mínimo TC' : it.source === 'loan' ? 'Cuota crédito' : it.source === 'one_off' ? 'Gasto único' : 'Recurrente'}
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className={`font-black ${it.paid ? 'text-emerald-500 line-through' : 'text-rose-500'}`}>
                    {formatCurrency(it.amount, it.currency)}
                  </p>
                  {it.paid && it.paidTxId && (
                    <div className="mt-2 flex items-center gap-2">
                      <label className="inline-flex items-center gap-1 text-xs text-primary hover:underline cursor-pointer">
                        <Upload className="h-3 w-3" />
                        <span>Comprobante</span>
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,application/pdf"
                          onChange={(e) => {
                            const f = e.target.files?.[0]
                            if (f) {
                              setSelectedFile((prev) => ({ ...prev, [it.key]: f }))
                              uploadAttachment.mutate({ txId: it.paidTxId!, file: f })
                            }
                          }}
                        />
                      </label>
                      {selectedFile[it.key] && (
                        <span className="text-[10px] text-emerald-500 truncate max-w-[100px]">
                          {selectedFile[it.key].name}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4 flex items-start gap-2 text-sm">
        <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p><b>Cómo funciona:</b> Cada vez que tachas un item, Securo crea una transacción real en tu cuenta pagadora y la marca en tu historial. Los gastos únicos también se marcan como pagados en su tabla.</p>
          <p className="text-xs text-muted-foreground">Los pagos ya registrados se conservan cuando refrescas la página.</p>
        </div>
      </div>
    </div>
  )
}
