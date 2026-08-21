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
import type { Loan, AmortizationTable } from '@/types'
import { Plus, Pencil, Trash2, Calculator, Landmark } from 'lucide-react'
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

function AmortizationDialog({
  loan,
  open,
  onOpenChange,
}: {
  loan: Loan | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { data: table, isLoading } = useQuery<AmortizationTable>({
    queryKey: ['amortization', loan?.id],
    queryFn: () => loansApi.amortization(loan!.id),
    enabled: !!loan && open,
  })

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
              <div><p className="text-xs text-muted-foreground">Cuotas restantes</p><p className="font-semibold">{table.periods}</p></div>
              <div><p className="text-xs text-muted-foreground">Total intereses</p><p className="font-semibold">{formatCurrency(table.total_interest, table.currency)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total capital</p><p className="font-semibold">{formatCurrency(table.total_principal, table.currency)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total a pagar</p><p className="font-semibold">{formatCurrency(table.total_payments, table.currency)}</p></div>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card border-b border-border">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-2 py-2">#</th>
                    <th className="px-2 py-2">Fecha</th>
                    <th className="px-2 py-2 text-right">Saldo inicio</th>
                    <th className="px-2 py-2 text-right">Cuota</th>
                    <th className="px-2 py-2 text-right">Intereses</th>
                    <th className="px-2 py-2 text-right">Capital</th>
                    <th className="px-2 py-2 text-right">Saldo fin</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((r) => (
                    <tr key={r.period} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="px-2 py-1.5 text-muted-foreground">{r.period}</td>
                      <td className="px-2 py-1.5">{r.payment_date}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(r.opening_balance, table.currency)}</td>
                      <td className="px-2 py-1.5 text-right font-medium">{formatCurrency(r.payment, table.currency)}</td>
                      <td className="px-2 py-1.5 text-right text-amber-600 dark:text-amber-400">{formatCurrency(r.interest, table.currency)}</td>
                      <td className="px-2 py-1.5 text-right text-emerald-600 dark:text-emerald-400">{formatCurrency(r.principal, table.currency)}</td>
                      <td className="px-2 py-1.5 text-right">{formatCurrency(r.closing_balance, table.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

  const del = useMutation({
    mutationFn: (id: string) => loansApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loans'] }); toast.success('Crédito eliminado') },
  })

  const totalDebt = loans.reduce((sum, l) => sum + Number(l.current_balance), 0)
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
                  <td className="px-4 py-3 text-right">{formatCurrency(l.current_balance, l.currency)}</td>
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
      />
    </div>
  )
}
