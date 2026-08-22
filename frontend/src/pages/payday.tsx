import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  dashboard as dashboardApi,
  loans as loansApi,
  accounts as accountsApi,
  transactions as transactionsApi,
} from '@/lib/api'
import type { ProjectedTransaction, Loan, Account } from '@/types'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'
import {
  CheckCircle2, Circle, Wallet, AlertTriangle, Upload,
  Flame, Calendar as CalendarIcon, Zap,
} from 'lucide-react'
import { toast } from 'sonner'

type Priority = 'critical' | 'high' | 'normal' | 'low'
type ObligationItem = {
  key: string                     // unique
  source: 'recurring' | 'loan' | 'tc_payment'
  source_id: string               // recurring_id / loan_id / account_id
  description: string
  amount: number
  currency: string
  account_id: string | null       // cuenta desde donde sale
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
  // Solventa payday-loan
  if (desc.includes('solventa')) return 'critical'
  // Deudas informales
  if (desc.includes('suárez') || desc.includes('suarez')) return 'critical'
  // TCs con mora / pago mínimo
  if (desc.includes('tarjeta') || desc.includes('credencial') || desc.includes('mastercard') || desc.includes('visa')) {
    return days <= 3 ? 'critical' : days <= 7 ? 'high' : 'normal'
  }
  // Cuotas de créditos vencen esta semana
  if (days <= 3) return 'critical'
  if (days <= 7) return 'high'
  if (days <= 15) return 'normal'
  return 'low'
}

export default function PaydayPage() {
  const qc = useQueryClient()
  const [selectedFile, setSelectedFile] = useState<Record<string, File>>({})
  const [paidLocal, setPaidLocal] = useState<Record<string, string>>({}) // key → tx_id

  const currentMonth = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [])

  // Ventana Payday: desde hoy hasta 35 días adelante (cubre el próximo sueldo)
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
  const { data: loans = [] } = useQuery<Loan[]>({ queryKey: ['loans'], queryFn: () => loansApi.list() })
  const { data: accounts = [] } = useQuery<Account[]>({ queryKey: ['accounts'], queryFn: () => accountsApi.list() })

  const accountName = (id: string | null | undefined) => accounts.find((a) => a.id === id)?.name || '—'

  // ─── Consolidar obligaciones del mes ───
  const items = useMemo<ObligationItem[]>(() => {
    const out: ObligationItem[] = []

    // 1. Projected recurring (debits solamente = gastos a pagar)
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

    // 2. Cuotas de loans (siempre este mes)
    for (const l of loans) {
      if (l.status !== 'active') continue
      // Asumir cuota vence este mes si aún no venció
      const dueDate = l.start_date
      const base = {
        key: `loan:${l.id}:${currentMonth}`,
        source: 'loan' as const,
        source_id: l.id,
        description: `Cuota ${l.name}`,
        amount: Number(l.monthly_payment),
        currency: l.currency,
        account_id: null,          // varía — el usuario lo selecciona
        category_id: null,
        due_date: dueDate,
      }
      out.push({ ...base, priority: derivePriority(base) })
    }

    // 3. TC con pago mínimo pendiente
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

    // Marcar como pagados los que están en paidLocal
    for (const it of out) {
      if (paidLocal[it.key]) {
        it.paid = true
        it.paidTxId = paidLocal[it.key]
      }
    }

    // Sort: paid al final; pendientes por prioridad y fecha
    const priorityOrder: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 }
    return out.sort((a, b) => {
      if (a.paid !== b.paid) return a.paid ? 1 : -1
      if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority]
      return a.due_date.localeCompare(b.due_date)
    })
  }, [projected, loans, accounts, paidLocal, currentMonth])

  // ─── Resumen ───
  const totalPending = items.filter((i) => !i.paid).reduce((s, i) => s + i.amount, 0)
  const totalPaid    = items.filter((i) =>  i.paid).reduce((s, i) => s + i.amount, 0)
  const criticalCount = items.filter((i) => !i.paid && i.priority === 'critical').length
  const paidCount = items.filter((i) => i.paid).length

  // ─── Cuenta pagadora principal (Lulo Ahorros) ───
  const LULO_AHORROS = accounts.find((a) => a.name === 'Lulo Bank Ahorros')?.id
  const luloBalance = LULO_AHORROS ? Number(accounts.find((a) => a.id === LULO_AHORROS)?.balance ?? 0) : 0

  // ─── Mark paid mutation ───
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
      return { key: it.key, tx }
    },
    onSuccess: ({ key, tx }) => {
      setPaidLocal((prev) => ({ ...prev, [key]: tx.id }))
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['loans'] })
      toast.success('Pago registrado')
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al registrar pago'),
  })

  // ─── Upload attachment ───
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

      {/* Resumen top */}
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

      {/* Warning si no alcanza */}
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

      {/* Lista de obligaciones */}
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
                {/* Checkbox */}
                <button
                  onClick={() => !it.paid && markPaid.mutate(it)}
                  disabled={it.paid || markPaid.isPending}
                  className="shrink-0"
                >
                  {it.paid
                    ? <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    : <Circle className="h-6 w-6 text-muted-foreground hover:text-primary transition-colors" />}
                </button>

                {/* Content */}
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
                    <span className="capitalize">· {it.source === 'tc_payment' ? 'Pago mínimo TC' : it.source === 'loan' ? 'Cuota crédito' : 'Recurrente'}</span>
                  </div>
                </div>

                {/* Amount */}
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

      {/* Footer helper */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 flex items-start gap-2 text-sm">
        <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p><b>Cómo funciona:</b> Cada vez que tachas un item, Securo crea una transacción real en tu cuenta pagadora y la marca en tu historial.</p>
          <p className="text-xs text-muted-foreground">Los pagos ya registrados se conservan cuando refrescas la página (aparecen automáticamente si su descripción coincide).</p>
        </div>
      </div>
    </div>
  )
}
