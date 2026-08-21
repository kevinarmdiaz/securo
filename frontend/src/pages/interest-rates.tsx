import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { interestRates as ratesApi } from '@/lib/api'
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
import type { InterestRate } from '@/types'
import { Plus, Trash2, TrendingUp } from 'lucide-react'
import { PageHeader } from '@/components/page-header'

const SELECT_CLASS =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary'

const RATE_TYPE_LABELS: Record<string, string> = {
  compra_pesos: 'Compra COP',
  avance_pesos: 'Avance COP',
  mora_pesos: 'Mora COP',
  compra_dolares: 'Compra USD',
  avance_dolares: 'Avance USD',
  mora_dolares: 'Mora USD',
  otro: 'Otro',
}

function RateFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: (r: Partial<InterestRate>) => ratesApi.create(r),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['interest-rates'] }); toast.success('Tasa registrada'); onSaved() },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Error al crear'),
  })

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    create.mutate({
      entity: fd.get('entity') as string,
      product_name: fd.get('product_name') as string,
      rate_type: fd.get('rate_type') as any,
      currency: (fd.get('currency') as string) || 'COP',
      ea: Number(fd.get('ea')),
      mv: Number(fd.get('mv')),
      valid_from: fd.get('valid_from') as string,
      valid_to: (fd.get('valid_to') as string) || null,
      source_url: (fd.get('source_url') as string) || null,
      notes: (fd.get('notes') as string) || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar tasa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 col-span-2">
              <Label>Entidad</Label>
              <Input name="entity" placeholder="Banco de Occidente" required />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Producto</Label>
              <Input name="product_name" placeholder="Credencial Clásica Mastercard" required />
            </div>
            <div className="space-y-2">
              <Label>Tipo</Label>
              <select name="rate_type" className={SELECT_CLASS} required defaultValue="compra_pesos">
                {Object.entries(RATE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Moneda</Label>
              <select name="currency" defaultValue="COP" className={SELECT_CLASS}>
                <option value="COP">COP</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Tasa E.A. (%)</Label>
              <Input name="ea" type="number" step="0.0001" placeholder="24.84" required />
            </div>
            <div className="space-y-2">
              <Label>Tasa M.V. (%)</Label>
              <Input name="mv" type="number" step="0.0001" placeholder="1.85" required />
            </div>
            <div className="space-y-2">
              <Label>Vigente desde</Label>
              <Input name="valid_from" type="date" required />
            </div>
            <div className="space-y-2">
              <Label>Vigente hasta (opcional)</Label>
              <Input name="valid_to" type="date" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Fuente (URL del PDF)</Label>
              <Input name="source_url" placeholder="https://bancodeoccidente.com.co/..." />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Notas</Label>
              <Input name="notes" placeholder="Ej: Usura vigente 29.66%" />
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

export default function InterestRatesPage() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState({ entity: '', product: '', type: '' })
  const [formOpen, setFormOpen] = useState(false)

  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['interest-rates', filter],
    queryFn: () => ratesApi.list({
      entity: filter.entity || undefined,
      product_name: filter.product || undefined,
      rate_type: filter.type || undefined,
    }),
  })

  const del = useMutation({
    mutationFn: (id: string) => ratesApi.delete(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['interest-rates'] }); toast.success('Eliminada') },
  })

  // Agrupar por producto para ver evolución
  const byProduct = rates.reduce<Record<string, InterestRate[]>>((acc, r) => {
    const k = `${r.entity} · ${r.product_name} · ${RATE_TYPE_LABELS[r.rate_type]}`
    ;(acc[k] ||= []).push(r)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <PageHeader
        section="Finanzas"
        title="Histórico de tasas"
        action={
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Nueva tasa
          </Button>
        }
      />

      <div className="bg-card border border-border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input placeholder="Filtrar entidad..." value={filter.entity} onChange={(e) => setFilter({ ...filter, entity: e.target.value })} />
        <Input placeholder="Filtrar producto..." value={filter.product} onChange={(e) => setFilter({ ...filter, product: e.target.value })} />
        <select className={SELECT_CLASS} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}>
          <option value="">Todos los tipos</option>
          {Object.entries(RATE_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}

      {!isLoading && rates.length === 0 && (
        <div className="bg-card border border-border rounded-xl p-8 text-center">
          <TrendingUp className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-4">Aún no hay tasas registradas.</p>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Registrar la primera
          </Button>
        </div>
      )}

      {Object.entries(byProduct).map(([label, items]) => (
        <div key={label} className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <p className="font-semibold text-sm">{label}</p>
            <p className="text-xs text-muted-foreground">{items.length} periodo{items.length !== 1 ? 's' : ''}</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border/50">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Desde</th>
                <th className="px-4 py-2">Hasta</th>
                <th className="px-4 py-2 text-right">E.A.</th>
                <th className="px-4 py-2 text-right">M.V.</th>
                <th className="px-4 py-2">Notas</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="px-4 py-2">{r.valid_from}</td>
                  <td className="px-4 py-2 text-muted-foreground">{r.valid_to || '—'}</td>
                  <td className="px-4 py-2 text-right font-medium">{Number(r.ea).toFixed(2)}%</td>
                  <td className="px-4 py-2 text-right font-medium">{Number(r.mv).toFixed(2)}%</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-xs">{r.notes || ''}</td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => { if (confirm('¿Eliminar tasa?')) del.mutate(r.id) }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <RateFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={() => setFormOpen(false)} />
    </div>
  )
}
