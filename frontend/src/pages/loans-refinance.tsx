import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { loans as loansApi, accounts as accountsApi, interestRates as ratesApi } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'
import { ArrowRightLeft, TrendingDown, AlertTriangle, CircleCheck, Calculator } from 'lucide-react'
import type { Loan, Account, InterestRate } from '@/types'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

function mvToEa(mv: number) { return (Math.pow(1 + mv / 100, 12) - 1) * 100 }

type DebtOption = {
  id: string
  label: string
  entity: string
  ea: number
  mv: number
  balance: number
  available?: number   // cupo disponible (solo para destinos revolving / no-consumidos)
  kind: 'source' | 'target' | 'both'
}

function buildDebtOptions(loans: Loan[], accounts: Account[], rates: InterestRate[]): DebtOption[] {
  const opts: DebtOption[] = []

  for (const l of loans) {
    const mv = Number(l.monthly_rate)
    opts.push({
      id: `loan:${l.id}`,
      label: l.name,
      entity: l.entity,
      ea: mvToEa(mv),
      mv,
      balance: Number(l.current_balance),
      kind: 'source',   // Los loans normalmente son solo source (no puedes girar cupo extra fácil)
    })
  }

  for (const a of accounts.filter((a) => a.type === 'credit_card' && Number(a.balance) >= 0)) {
    const matches = rates.filter((r) => {
      const pn = r.product_name.toLowerCase()
      const an = a.name.toLowerCase()
      if (!r.rate_type.includes('compra') && r.rate_type !== 'otro') return false
      return (an.includes('mc') && pn.includes('mastercard'))
        || (an.includes('visa') && pn.includes('visa'))
        || (an.includes('lulo') && r.entity.toLowerCase().includes('lulo'))
    }).sort((x, y) => y.valid_from.localeCompare(x.valid_from))
    const latest = matches[0]
    const ea = latest ? Number(latest.ea) : 29.66
    const mv = latest ? Number(latest.mv) : 2.18
    const cupo = a.credit_limit ? Number(a.credit_limit) : 0
    const balance = Number(a.balance)
    const available = Math.max(cupo - balance, 0)
    opts.push({
      id: `cc:${a.id}`,
      label: a.name,
      entity: a.name.toLowerCase().includes('occidente') ? 'Banco de Occidente'
            : a.name.toLowerCase().includes('lulo')      ? 'Lulo Bank'
            : 'Otro',
      ea, mv, balance, available,
      kind: balance > 0 && available > 0 ? 'both' : balance > 0 ? 'source' : 'target',
    })
  }
  return opts.sort((a, b) => b.ea - a.ea)
}

function Panel({ children, title, icon: Icon }: { children: React.ReactNode; title: string; icon: React.ElementType }) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <p className="font-semibold text-sm">{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

const SELECT_CLASS = 'w-full border border-border rounded-lg px-3 py-2 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary'

export default function LoansRefinancePage() {
  const { data: loans = [] }    = useQuery({ queryKey: ['loans'],           queryFn: () => loansApi.list() })
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'],        queryFn: () => accountsApi.list() })
  const { data: rates = [] }    = useQuery({ queryKey: ['interest-rates'],  queryFn: () => ratesApi.list() })

  const options = useMemo(() => buildDebtOptions(loans, accounts, rates), [loans, accounts, rates])

  const sources = options.filter((o) => o.kind === 'source' || o.kind === 'both')
  const targets = options.filter((o) => (o.kind === 'target' || o.kind === 'both') && (o.available ?? 0) > 0)

  // Default: origen = tasa más alta con saldo > 0. Destino = tasa más baja con cupo.
  const [sourceId, setSourceId] = useState<string>(sources[0]?.id ?? '')
  const [targetId, setTargetId] = useState<string>(targets.sort((a,b)=>a.ea-b.ea)[0]?.id ?? '')
  const source = sources.find((o) => o.id === sourceId)
  const target = targets.find((o) => o.id === targetId)

  const [amount, setAmount] = useState<number>(0)
  const defaultAmount = source && target
    ? Math.min(source.balance, target.available ?? source.balance)
    : 0
  const transferAmount = amount || defaultAmount

  // Cálculos
  const canTransfer = source && target && source.id !== target.id && transferAmount > 0
  const currentAnnual = source ? transferAmount * source.ea / 100 : 0
  const targetAnnual  = target ? transferAmount * target.ea / 100 : 0
  const savingsAnnual = currentAnnual - targetAnnual
  const savingsMonthly = savingsAnnual / 12

  const exceedsCupo = target && transferAmount > (target.available ?? 0)
  const sameOrHigherRate = source && target && target.ea >= source.ea

  // Top 3 refinanciaciones sugeridas automáticamente
  const suggestions = useMemo(() => {
    const list: Array<{ from: DebtOption; to: DebtOption; amount: number; save: number }> = []
    const bestTargets = targets.sort((a, b) => a.ea - b.ea).slice(0, 3)
    for (const from of sources) {
      for (const to of bestTargets) {
        if (from.id === to.id) continue
        if (to.ea >= from.ea) continue
        const amt = Math.min(from.balance, to.available ?? from.balance)
        if (amt < 100000) continue // ignorar < $100K
        const save = amt * (from.ea - to.ea) / 100
        list.push({ from, to, amount: amt, save })
      }
    }
    return list.sort((a, b) => b.save - a.save).slice(0, 3)
  }, [sources, targets])

  return (
    <div className="space-y-6">
      <PageHeader
        section="Finanzas"
        title="Balance Transfer — Simulador de refinanciación"
      />

      <p className="text-sm text-muted-foreground max-w-3xl">
        Mueve deuda de un crédito con tasa alta a otro con tasa más baja (y cupo disponible).
        La lógica es simple: si tu Solventa está a 152% EA y tu Libre Inversión Lulo a 21.56%,
        cada peso que muevas te ahorra la diferencia anual en intereses.
      </p>

      {/* Simulador manual */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Deuda origen (mover DESDE)" icon={ArrowRightLeft}>
          <select className={SELECT_CLASS} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">Seleccionar...</option>
            {sources.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} — {o.ea.toFixed(2)}% EA · saldo {formatCurrency(o.balance, 'COP')}
              </option>
            ))}
          </select>
          {source && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <div><span className="text-muted-foreground">Tasa EA</span><p className="font-bold text-rose-500">{source.ea.toFixed(2)}%</p></div>
              <div><span className="text-muted-foreground">Tasa MV</span><p className="font-bold">{source.mv.toFixed(2)}%</p></div>
              <div><span className="text-muted-foreground">Saldo total</span><p className="font-bold">{formatCurrency(source.balance, 'COP')}</p></div>
            </div>
          )}
        </Panel>

        <Panel title="Crédito destino (mover HACIA)" icon={CircleCheck}>
          <select className={SELECT_CLASS} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Seleccionar...</option>
            {targets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} — {o.ea.toFixed(2)}% EA · cupo libre {formatCurrency(o.available ?? 0, 'COP')}
              </option>
            ))}
          </select>
          {target && (
            <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
              <div><span className="text-muted-foreground">Tasa EA</span><p className="font-bold text-emerald-500">{target.ea.toFixed(2)}%</p></div>
              <div><span className="text-muted-foreground">Tasa MV</span><p className="font-bold">{target.mv.toFixed(2)}%</p></div>
              <div><span className="text-muted-foreground">Cupo libre</span><p className="font-bold">{formatCurrency(target.available ?? 0, 'COP')}</p></div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Monto a transferir" icon={Calculator}>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Input
              type="number"
              value={transferAmount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder={defaultAmount.toString()}
            />
          </div>
          <Button variant="outline" onClick={() => setAmount(defaultAmount)}>
            Máx: {formatCurrency(defaultAmount, 'COP')}
          </Button>
        </div>

        {canTransfer && (
          <div className="mt-6 space-y-3">
            {exceedsCupo && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5" />
                <p className="text-sm text-rose-500">
                  El monto excede el cupo libre del destino ({formatCurrency(target?.available ?? 0, 'COP')}).
                  Ajusta el monto o elige otro destino.
                </p>
              </div>
            )}
            {sameOrHigherRate && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
                <p className="text-sm text-amber-500">
                  El destino tiene tasa igual o mayor al origen. No hay ahorro, mover no tiene sentido.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">Interés actual anual</p>
                <p className="text-xl font-bold text-rose-500">{formatCurrency(currentAnnual, 'COP')}</p>
                <p className="text-[10px] text-muted-foreground mt-1">a {source?.ea.toFixed(2)}% EA</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">Interés post-refi anual</p>
                <p className="text-xl font-bold text-emerald-500">{formatCurrency(targetAnnual, 'COP')}</p>
                <p className="text-[10px] text-muted-foreground mt-1">a {target?.ea.toFixed(2)}% EA</p>
              </div>
              <div className="rounded-lg border-2 border-emerald-500 bg-emerald-500/10 p-4">
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">Ahorro anual</p>
                <p className="text-2xl font-black text-emerald-500 flex items-center gap-1">
                  <TrendingDown className="h-5 w-5" />
                  {formatCurrency(savingsAnnual, 'COP')}
                </p>
                <p className="text-xs text-emerald-500 mt-1">{formatCurrency(savingsMonthly, 'COP')}/mes</p>
              </div>
            </div>
          </div>
        )}
      </Panel>

      {/* Top 3 sugerencias auto */}
      {suggestions.length > 0 && (
        <div>
          <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-emerald-500" /> Top 3 refinanciaciones sugeridas
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {suggestions.map((s, i) => (
              <div
                key={i}
                onClick={() => { setSourceId(s.from.id); setTargetId(s.to.id); setAmount(s.amount) }}
                className="rounded-xl border border-border bg-card p-4 cursor-pointer hover:border-primary hover:bg-primary/5 transition-all"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase text-primary bg-primary/10 px-2 py-0.5 rounded">Top #{i + 1}</span>
                  <span className="text-xs font-bold text-emerald-500">{formatCurrency(s.save, 'COP')}/año</span>
                </div>
                <p className="text-sm font-bold leading-tight">
                  {s.from.label} → {s.to.label}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Mueve {formatCurrency(s.amount, 'COP')} · {s.from.ea.toFixed(1)}% → {s.to.ea.toFixed(1)}%
                </p>
                <p className="text-[10px] text-muted-foreground mt-2">Click para simular</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
