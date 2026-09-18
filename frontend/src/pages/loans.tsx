import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { loans as loansApi } from '@/lib/api'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import type { Loan, AmortizationTable, LoanPayment, PlanVsActual } from '@/types'
import { Plus, Pencil, Trash2, Calculator, Landmark, AlertTriangle, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'

const SELECT_CLASS =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary'

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    active: { bg: 'bg-emerald-100 dark:bg-emerald-500/20', text: 'text-emerald-700 dark:text-emerald-400', label: 'Activo' },
    paid: { bg: 'bg-blue-100 dark:bg-blue-500/20', text: 'text-blue-700 dark:text-blue-400', label: 'Pagado' },
    paused: { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-400', label: 'Pausado' },
  }
  const c = config[status] || config.active
  return <span className={`text-xs px-2 py-1 rounded-full ${c.bg} ${c.text} font-medium`}>{c.label}</span>
}

function LoanFormDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: Loan | null
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (loan: Partial<Loan>) => loansApi.create(loan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); toast.success('Crédito creado'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al crear'),
  })
  const update = useMutation({
    mutationFn: (loan: Partial<Loan>) => loansApi.update(editing!.id, loan),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); toast.success('Crédito actualizado'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al actualizar'),
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const payload: Partial<Loan> = {
      name: fd.get('name') as string,
      entity: fd.get('entity') as string,
      current_balance: Number(fd.get('current_balance')),
      monthly_rate: Number(fd.get('monthly_rate')),
      monthly_payment: Number(fd.get('monthly_payment')),
      insurance_amount: Number(fd.get('insurance_amount') || 0),
      original_balance: fd.get('original_balance') ? Number(fd.get('original_balance')) : null,
      start_date: fd.get('start_date') as string,
      currency: (fd.get('currency') as string) || 'COP',
    }
    if (editing) update.mutate(payload)
    else create.mutate(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar crédito' : 'Nuevo crédito'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Nombre</Label>
              <Input name="name" defaultValue={editing?.name} placeholder="Avancoop - Armando" required />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Entidad</Label>
              <Input name="entity" defaultValue={editing?.entity} placeholder="Avancoop" required />
            </div>
            <div className="space-y-2">
              <Label>Saldo actual</Label>
              <Input name="current_balance" type="number" step="0.01" defaultValue={editing?.current_balance} required />
            </div>
            <div className="space-y-2">
              <Label>Cuota mensual</Label>
              <Input name="monthly_payment" type="number" step="0.01" defaultValue={editing?.monthly_payment} required />
            </div>
            <div className="space-y-2">
              <Label>Tasa mensual (%)</Label>
              <Input name="monthly_rate" type="number" step="0.0001" defaultValue={editing?.monthly_rate} placeholder="1.16" required />
            </div>
            <div className="space-y-2">
              <Label>Seguro / cargos por cuota</Label>
              <Input name="insurance_amount" type="number" step="0.01" defaultValue={editing?.insurance_amount ?? 0} placeholder="43869" />
              <p className="text-[11px] text-muted-foreground">Sale de la cuota antes del abono a capital.</p>
            </div>
            <div className="space-y-2">
              <Label>Saldo original</Label>
              <Input name="original_balance" type="number" step="0.01" defaultValue={editing?.original_balance ?? undefined} placeholder="Opcional" />
              <p className="text-[11px] text-muted-foreground">Con qué arrancó el crédito, para comparar contra el plan.</p>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <select name="currency" defaultValue={editing?.currency || 'COP'} className={SELECT_CLASS}>
                <option value="COP">COP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Fecha inicio (o próximo pago)</Label>
              <Input name="start_date" type="date" defaultValue={editing?.start_date} required />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              {editing ? 'Actualizar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PaymentFormDialog({
  loan,
  open,
  onOpenChange,
}: {
  loan: Loan | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (p: Partial<LoanPayment>) => loansApi.addPayment(loan!.id, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      qc.invalidateQueries({ queryKey: ['amortization', loan?.id] })
      qc.invalidateQueries({ queryKey: ['loan-payments', loan?.id] })
      toast.success('Pago registrado')
      onOpenChange(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al registrar'),
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    create.mutate({
      payment_date: fd.get('payment_date') as string,
      amount: Number(fd.get('amount')),
      principal: Number(fd.get('principal') || 0),
      interest: Number(fd.get('interest') || 0),
      insurance: Number(fd.get('insurance') || 0),
      balance_after: fd.get('balance_after') ? Number(fd.get('balance_after')) : null,
      kind: fd.get('kind') as LoanPayment['kind'],
      note: (fd.get('note') as string) || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar pago — {loan?.name}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Copia el desglose tal como lo reporta la entidad en el extracto. El saldo
            después del pago manda sobre el calculado.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input name="payment_date" type="date" required />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select name="kind" defaultValue="installment" className={SELECT_CLASS}>
                <option value="installment">Cuota</option>
                <option value="extra_principal">Abono a capital</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Consignado</Label>
              <Input name="amount" type="number" step="0.01" required />
            </div>
            <div className="space-y-2">
              <Label>A capital</Label>
              <Input name="principal" type="number" step="0.01" defaultValue={0} />
            </div>
            <div className="space-y-2">
              <Label>A intereses</Label>
              <Input name="interest" type="number" step="0.01" defaultValue={0} />
            </div>
            <div className="space-y-2">
              <Label>Seguro / adicionales</Label>
              <Input name="insurance" type="number" step="0.01" defaultValue={0} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Saldo después del pago</Label>
              <Input name="balance_after" type="number" step="0.01" placeholder="El que reporta la entidad" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Nota</Label>
              <Input name="note" placeholder="Abono cuota #8" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={create.isPending}>Registrar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ComplianceBanner({ pv, currency }: { pv: PlanVsActual; currency: string }) {
  const short = pv.months_short > 0
  return (
    <div
      className={`rounded-lg border p-3 ${
        short
          ? 'border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-500/10'
          : 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/10'
      }`}
    >
      <div className="flex items-start gap-2">
        {short ? (
          <AlertTriangle className="h-4 w-4 mt-0.5 text-rose-600 dark:text-rose-400 shrink-0" />
        ) : (
          <TrendingUp className="h-4 w-4 mt-0.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
        )}
        <div className="text-sm">
          {short ? (
            <>
              <p className="font-medium text-rose-700 dark:text-rose-300">
                {pv.months_short} de {pv.monthly.length} meses por debajo de la cuota
                {pv.consecutive_months_short > 1 && ` — ${pv.consecutive_months_short} seguidos`}
              </p>
              <p className="text-muted-foreground">
                Faltante acumulado {formatCurrency(pv.total_shortfall, currency)}. Un mes
                grande no compensa los meses cortos: cada uno alarga el crédito.
              </p>
            </>
          ) : (
            <p className="font-medium text-emerald-700 dark:text-emerald-300">
              Todos los meses registrados cubren la cuota pactada.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function AmortizationDialog({
  loan,
  open,
  onOpenChange,
  onAddPayment,
}: {
  loan: Loan | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onAddPayment: () => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'projection' | 'actual' | 'monthly'>('projection')

  const { data: table, isLoading } = useQuery<AmortizationTable>({
    queryKey: ['amortization', loan?.id],
    queryFn: () => loansApi.amortization(loan!.id),
    enabled: !!loan && open,
  })

  const { data: payments = [] } = useQuery<LoanPayment[]>({
    queryKey: ['loan-payments', loan?.id],
    queryFn: () => loansApi.payments(loan!.id),
    enabled: !!loan && open,
  })

  const delPayment = useMutation({
    mutationFn: (pid: string) => loansApi.deletePayment(loan!.id, pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] })
      qc.invalidateQueries({ queryKey: ['amortization', loan?.id] })
      qc.invalidateQueries({ queryKey: ['loan-payments', loan?.id] })
      toast.success('Pago eliminado')
    },
  })

  const pv = table?.plan_vs_actual ?? null
  const cur = table?.currency ?? 'COP'

  const TABS: { id: typeof tab; label: string }[] = [
    { id: 'projection', label: `Proyección (${table?.periods ?? 0})` },
    { id: 'actual', label: `Pagos reales (${payments.length})` },
    { id: 'monthly', label: 'Mes a mes' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" /> Tabla de amortización — {loan?.name}
          </DialogTitle>
        </DialogHeader>
        {isLoading && <p className="text-sm text-muted-foreground">Calculando...</p>}
        {table && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground">Saldo vigente</p>
                <p className="font-semibold">{formatCurrency(table.starting_balance, cur)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cuotas restantes</p>
                <p className="font-semibold">{table.periods}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Intereses por pagar</p>
                <p className="font-semibold text-amber-600 dark:text-amber-400">{formatCurrency(table.total_interest, cur)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Termina</p>
                <p className="font-semibold">{table.rows.at(-1)?.payment_date ?? '—'}</p>
              </div>
            </div>

            {pv && (
              <div className="py-3 space-y-3 border-b border-border">
                <ComplianceBanner pv={pv} currency={cur} />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Pagado a la fecha</p>
                    <p className="font-medium">{formatCurrency(pv.total_paid, cur)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">De eso, a capital</p>
                    <p className="font-medium text-emerald-600 dark:text-emerald-400">{formatCurrency(pv.total_principal_paid, cur)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">A intereses</p>
                    <p className="font-medium text-amber-600 dark:text-amber-400">{formatCurrency(pv.total_interest_paid, cur)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">A seguro</p>
                    <p className="font-medium text-muted-foreground">{formatCurrency(pv.total_insurance_paid, cur)}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 py-2 border-b border-border">
              <div className="flex gap-1">
                {TABS.map((x) => (
                  <button
                    key={x.id}
                    onClick={() => setTab(x.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      tab === x.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {x.label}
                  </button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={onAddPayment}>
                <Plus className="h-4 w-4 mr-1" /> Registrar pago
              </Button>
            </div>

            <div className="overflow-auto flex-1">
              {tab === 'projection' && (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card border-b border-border">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-2 py-2">#</th>
                      <th className="px-2 py-2">Fecha</th>
                      <th className="px-2 py-2 text-right">Saldo inicio</th>
                      <th className="px-2 py-2 text-right">Cuota</th>
                      <th className="px-2 py-2 text-right">Intereses</th>
                      <th className="px-2 py-2 text-right">Seguro</th>
                      <th className="px-2 py-2 text-right">Capital</th>
                      <th className="px-2 py-2 text-right">Saldo fin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((r) => (
                      <tr key={r.period} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.period}</td>
                        <td className="px-2 py-1.5">{r.payment_date}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(r.opening_balance, cur)}</td>
                        <td className="px-2 py-1.5 text-right font-medium">{formatCurrency(r.payment, cur)}</td>
                        <td className="px-2 py-1.5 text-right text-amber-600 dark:text-amber-400">{formatCurrency(r.interest, cur)}</td>
                        <td className="px-2 py-1.5 text-right text-muted-foreground">{formatCurrency(r.insurance, cur)}</td>
                        <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(r.principal, cur)}</td>
                        <td className="px-2 py-1.5 text-right">{formatCurrency(r.closing_balance, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {tab === 'actual' && (
                payments.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Sin pagos registrados. Mientras no los cargues, la tabla es solo una proyección teórica.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2">Fecha</th>
                        <th className="px-2 py-2">Concepto</th>
                        <th className="px-2 py-2 text-right">Consignado</th>
                        <th className="px-2 py-2 text-right">Capital</th>
                        <th className="px-2 py-2 text-right">Intereses</th>
                        <th className="px-2 py-2 text-right">Seguro</th>
                        <th className="px-2 py-2 text-right">Saldo</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-2 py-1.5">{p.payment_date}</td>
                          <td className="px-2 py-1.5">
                            <span className="text-muted-foreground">{p.note || '—'}</span>
                            {p.kind === 'extra_principal' && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400">
                                abono extra
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right font-medium">{formatCurrency(p.amount, cur)}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(p.principal, cur)}</td>
                          <td className="px-2 py-1.5 text-right text-amber-600 dark:text-amber-400">{formatCurrency(p.interest, cur)}</td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">{formatCurrency(p.insurance, cur)}</td>
                          <td className="px-2 py-1.5 text-right">{p.balance_after != null ? formatCurrency(p.balance_after, cur) : '—'}</td>
                          <td className="px-2 py-1.5 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { if (confirm('¿Eliminar este pago?')) delPayment.mutate(p.id) }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {tab === 'monthly' && (
                !pv ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    Registra pagos para comparar mes a mes contra la cuota pactada.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-card border-b border-border">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-2 py-2">Mes</th>
                        <th className="px-2 py-2 text-right">Entró</th>
                        <th className="px-2 py-2 text-right">Cuota pactada</th>
                        <th className="px-2 py-2 text-right">Faltante</th>
                        <th className="px-2 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pv.monthly.map((m) => (
                        <tr key={m.month} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="px-2 py-1.5 font-medium">{m.month}</td>
                          <td className="px-2 py-1.5 text-right">{formatCurrency(m.paid, cur)}</td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">{formatCurrency(m.expected, cur)}</td>
                          <td className="px-2 py-1.5 text-right">
                            {m.gap > 0 ? (
                              <span className="text-rose-600 dark:text-rose-400 font-medium">{formatCurrency(m.gap, cur)}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              m.covered
                                ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                                : 'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400'
                            }`}>
                              {m.covered ? 'Cubierto' : 'Corto'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function LoansPage() {
  const qc = useQueryClient()
  const { data: loans = [], isLoading } = useQuery({
    queryKey: ['loans'],
    queryFn: () => loansApi.list(),
  })

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Loan | null>(null)
  const [amortizationLoan, setAmortizationLoan] = useState<Loan | null>(null)
  const [paymentLoan, setPaymentLoan] = useState<Loan | null>(null)

  const del = useMutation({
    mutationFn: (id: string) => loansApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); toast.success('Crédito eliminado') },
  })

  const totalDebt = loans.reduce((sum, l) => sum + Number(l.effective_balance ?? l.current_balance), 0)
  const totalMonthly = loans.reduce((sum, l) => sum + Number(l.monthly_payment), 0)
  const totalInterest = loans.reduce((sum, l) => sum + Number(l.total_interest_remaining || 0), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        section="Finanzas"
        title="Créditos"
        action={
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Nuevo crédito
          </Button>
        }
      />

      {loans.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Deuda total</p>
            <p className="text-2xl font-bold">{formatCurrency(totalDebt, 'COP')}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Pago mensual</p>
            <p className="text-2xl font-bold">{formatCurrency(totalMonthly, 'COP')}</p>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground">Intereses futuros</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{formatCurrency(totalInterest, 'COP')}</p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}

      {!isLoading && loans.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <Landmark className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-4">Aún no tienes créditos registrados.</p>
          <Button onClick={() => { setEditing(null); setFormOpen(true) }}>
            <Plus className="h-4 w-4 mr-1" /> Crear el primero
          </Button>
        </div>
      )}

      {loans.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3">Crédito</th>
                <th className="px-4 py-3">Entidad</th>
                <th className="px-4 py-3 text-right">Saldo</th>
                <th className="px-4 py-3 text-right">Cuota</th>
                <th className="px-4 py-3 text-right">Tasa MV</th>
                <th className="px-4 py-3 text-right">Cuotas restantes</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{l.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.entity}</td>
                  <td className="px-4 py-3 text-right">
                    {formatCurrency(l.effective_balance ?? l.current_balance, l.currency)}
                    {l.payments_count > 0 && (
                      <span className="block text-[11px] text-muted-foreground">
                        {l.payments_count} pago{l.payments_count === 1 ? '' : 's'} registrado{l.payments_count === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{formatCurrency(l.monthly_payment, l.currency)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{Number(l.monthly_rate).toFixed(2)}%</td>
                  <td className="px-4 py-3 text-right">{l.total_remaining_payments}</td>
                  <td className="px-4 py-3 text-center"><StatusBadge status={l.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setAmortizationLoan(l)}>
                        <Calculator className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setEditing(l); setFormOpen(true) }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { if (confirm(`¿Eliminar ${l.name}?`)) del.mutate(l.id) }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LoanFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => setFormOpen(false)}
      />
      <AmortizationDialog
        loan={amortizationLoan}
        open={!!amortizationLoan}
        onOpenChange={(v) => !v && setAmortizationLoan(null)}
        onAddPayment={() => setPaymentLoan(amortizationLoan)}
      />
      <PaymentFormDialog
        loan={paymentLoan}
        open={!!paymentLoan}
        onOpenChange={(v) => !v && setPaymentLoan(null)}
      />
    </div>
  )
}
