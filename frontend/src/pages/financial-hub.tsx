import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  loans as loansApi,
  accounts as accountsApi,
  interestRates as ratesApi,
  recurring as recurringApi,
  goals as goalsApi,
  categories as categoriesApi,
} from '@/lib/api'
import type { RecurringTransaction, Goal, Category } from '@/types'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'
import {
  Wallet, ArrowUpRight, ArrowDownRight, AlertTriangle, TrendingUp,
  Swords, Target, Calendar, Flame, Repeat,
} from 'lucide-react'

function mvToEa(mv: number) { return (Math.pow(1 + mv / 100, 12) - 1) * 100 }

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-5 ${className}`}>{children}</div>
}
function CardTitle({ children, icon: Icon, action }: { children: React.ReactNode; icon: React.ElementType; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm">{children}</h3>
      </div>
      {action}
    </div>
  )
}

export default function FinancialHubPage() {
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'],       queryFn: () => accountsApi.list() })
  const { data: loans = [] }    = useQuery({ queryKey: ['loans'],          queryFn: () => loansApi.list() })
  const { data: rates = [] }    = useQuery({ queryKey: ['interest-rates'], queryFn: () => ratesApi.list() })
  const { data: recs = [] }     = useQuery<RecurringTransaction[]>({ queryKey: ['recurring'], queryFn: () => recurringApi.list() })
  const { data: goals = [] }    = useQuery<Goal[]>({ queryKey: ['goals'],  queryFn: () => goalsApi.list() })
  const { data: cats = [] }     = useQuery<Category[]>({ queryKey: ['categories'], queryFn: () => categoriesApi.list() })

  // ─── NET WORTH ───
  const positiveAssets = accounts
    .filter((a) => (a.type === 'checking' || a.type === 'savings') && Number(a.balance) > 0)
    .reduce((s, a) => s + Number(a.balance), 0)

  const negativeCheck = accounts
    .filter((a) => a.type === 'checking' && Number(a.balance) < 0)
    .reduce((s, a) => s + Number(a.balance), 0)  // ya negativo

  const ccDebt = accounts
    .filter((a) => a.type === 'credit_card')
    .reduce((s, a) => s + Number(a.balance), 0)

  const loanDebt = loans.reduce((s, l) => s + Number(l.current_balance), 0)
  const totalDebt = ccDebt + loanDebt + Math.abs(negativeCheck)
  const netWorth = positiveAssets - totalDebt

  // ─── CASHFLOW MENSUAL ───
  const monthlyIncome = recs
    .filter((r) => r.type === 'credit' && r.frequency === 'monthly' && r.is_active)
    .reduce((s, r) => s + Number(r.amount), 0)
  const monthlyExpense = recs
    .filter((r) => r.type === 'debit' && r.frequency === 'monthly' && r.is_active)
    .reduce((s, r) => s + Number(r.amount), 0)
  const loanCuotas = loans.reduce((s, l) => s + Number(l.monthly_payment), 0)
  const monthlyFree = monthlyIncome - monthlyExpense - loanCuotas

  // ─── ALERTAS ───
  const alerts: Array<{ level: 'critical' | 'warning'; text: string; link?: string }> = []
  for (const a of accounts) {
    if (a.type === 'credit_card' && a.credit_limit) {
      const util = Number(a.balance) / Number(a.credit_limit)
      if (util > 1) alerts.push({ level: 'critical', text: `${a.name}: sobrecupo de ${formatCurrency(Number(a.balance) - Number(a.credit_limit), 'COP')}`, link: '/accounts' })
      else if (util > 0.9) alerts.push({ level: 'warning', text: `${a.name}: ${(util * 100).toFixed(1)}% del cupo usado`, link: '/accounts' })
    }
  }
  for (const l of loans) {
    const ea = mvToEa(Number(l.monthly_rate))
    if (ea > 100) alerts.push({ level: 'critical', text: `${l.name}: tasa ${ea.toFixed(0)}% EA (payday)`, link: '/loans/battle' })
  }
  if (monthlyFree < 0) alerts.push({ level: 'critical', text: `Déficit mensual: ${formatCurrency(Math.abs(monthlyFree), 'COP')}`, link: '/loans/battle' })

  // ─── TOP DEUDAS POR COSTO (mismo ranking que battle) ───
  const topDebts = useMemo(() => {
    const items: Array<{ id: string; label: string; balance: number; ea: number; kind: string }> = []
    for (const l of loans) {
      items.push({ id: l.id, label: l.name, balance: Number(l.current_balance), ea: mvToEa(Number(l.monthly_rate)), kind: 'loan' })
    }
    for (const a of accounts.filter((x) => x.type === 'credit_card' && Number(x.balance) > 0)) {
      const match = rates.find((r) => (r.rate_type.includes('compra') || r.rate_type === 'otro')
        && ((a.name.toLowerCase().includes('mc') && r.product_name.toLowerCase().includes('mastercard'))
         || (a.name.toLowerCase().includes('visa') && r.product_name.toLowerCase().includes('visa'))
         || (a.name.toLowerCase().includes('lulo') && r.entity.toLowerCase().includes('lulo'))))
      items.push({ id: a.id, label: a.name, balance: Number(a.balance), ea: match ? Number(match.ea) : 29.66, kind: 'cc' })
    }
    return items.sort((x, y) => y.ea - x.ea).slice(0, 3)
  }, [loans, accounts, rates])

  // ─── RECURRING POR CATEGORÍA (gastos mensualizados) ───
  const catNameById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c.name])), [cats])
  const recurringByCategory = useMemo(() => {
    const toMonthly = (amount: number, freq: string) => {
      if (freq === 'monthly')   return amount
      if (freq === 'weekly')    return amount * 4.33
      if (freq === 'quarterly') return amount / 3
      if (freq === 'yearly')    return amount / 12
      return amount
    }
    const map = new Map<string, { total: number; count: number; items: string[] }>()
    for (const r of recs) {
      if (r.type !== 'debit' || !r.is_active) continue
      const catId = r.category_id ?? 'uncategorized'
      const catName = catNameById[catId] ?? 'Sin categoría'
      const monthly = toMonthly(Number(r.amount), r.frequency)
      const entry = map.get(catName) ?? { total: 0, count: 0, items: [] }
      entry.total += monthly
      entry.count += 1
      entry.items.push(r.description)
      map.set(catName, entry)
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.total - a.total)
  }, [recs, catNameById])

  const recurringTotal = recurringByCategory.reduce((s, r) => s + r.total, 0)

  // ─── PRÓXIMOS 7 DÍAS ───
  const today = new Date()
  const in7 = new Date(today.getTime() + 7 * 86400000)
  const upcoming = recs
    .filter((r) => r.is_active && r.next_occurrence)
    .filter((r) => {
      const d = new Date(r.next_occurrence)
      return d >= today && d <= in7
    })
    .sort((a, b) => a.next_occurrence.localeCompare(b.next_occurrence))
    .slice(0, 8)

  return (
    <div className="space-y-6">
      <PageHeader section="Finanzas" title="Hub Financiero" />

      {/* Net Worth + Cashflow (grid principal) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardTitle icon={Wallet}>Patrimonio Neto</CardTitle>
          <p className={`text-4xl font-black ${netWorth >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {formatCurrency(netWorth, 'COP')}
          </p>
          <div className="mt-4 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-emerald-500 flex items-center gap-1"><ArrowUpRight className="h-3 w-3" /> Activos líquidos</span>
              <span className="font-bold">{formatCurrency(positiveAssets, 'COP')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-500 flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> TC deuda</span>
              <span className="font-bold">−{formatCurrency(ccDebt, 'COP')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-500 flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> Créditos</span>
              <span className="font-bold">−{formatCurrency(loanDebt, 'COP')}</span>
            </div>
            {negativeCheck < 0 && (
              <div className="flex justify-between">
                <span className="text-rose-500 flex items-center gap-1"><ArrowDownRight className="h-3 w-3" /> Deudas informales</span>
                <span className="font-bold">−{formatCurrency(Math.abs(negativeCheck), 'COP')}</span>
              </div>
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle icon={TrendingUp}>Flujo mensual</CardTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Ingresos</p>
              <p className="text-lg font-bold text-emerald-500">+{formatCurrency(monthlyIncome, 'COP')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Gastos fijos</p>
              <p className="text-lg font-bold text-rose-500">−{formatCurrency(monthlyExpense, 'COP')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cuotas créditos</p>
              <p className="text-lg font-bold text-rose-500">−{formatCurrency(loanCuotas, 'COP')}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Disponible</p>
              <p className={`text-lg font-bold ${monthlyFree >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {monthlyFree >= 0 ? '+' : ''}{formatCurrency(monthlyFree, 'COP')}
              </p>
            </div>
          </div>
          {monthlyFree < 0 && (
            <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-500 mt-0.5" />
              <p className="text-xs text-rose-500">
                Estás en <b>déficit mensual</b>. Sin recortes o ingresos extra, la deuda revolvente crece cada mes.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* Alertas */}
      {alerts.length > 0 && (
        <Card>
          <CardTitle icon={AlertTriangle}>Alertas ({alerts.length})</CardTitle>
          <div className="space-y-2">
            {alerts.map((a, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
                  a.level === 'critical' ? 'bg-rose-500/10 border border-rose-500/30' : 'bg-amber-500/10 border border-amber-500/30'
                }`}
              >
                <AlertTriangle className={`h-4 w-4 shrink-0 ${a.level === 'critical' ? 'text-rose-500' : 'text-amber-500'}`} />
                <span className="flex-1">{a.text}</span>
                {a.link && <Link to={a.link} className="text-xs font-bold text-primary hover:underline">Ver →</Link>}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top 3 deudas por costo */}
        <Card>
          <CardTitle icon={Swords} action={<Link to="/loans/battle" className="text-xs font-bold text-primary hover:underline">Ver todas →</Link>}>
            Top deudas por tasa
          </CardTitle>
          <div className="space-y-3">
            {topDebts.map((d, i) => (
              <div key={d.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`size-8 rounded-full flex items-center justify-center font-bold text-xs ${
                    i === 0 ? 'bg-rose-500 text-white' : i === 1 ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground'
                  }`}>{i === 0 ? <Flame className="h-4 w-4" /> : `#${i + 1}`}</div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{d.label}</p>
                    <p className="text-xs text-muted-foreground">{formatCurrency(d.balance, 'COP')}</p>
                  </div>
                </div>
                <p className={`font-black ${d.ea > 100 ? 'text-rose-500' : d.ea > 29.66 ? 'text-rose-400' : 'text-amber-400'}`}>
                  {d.ea.toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </Card>

        {/* Próximos pagos 7 días */}
        <Card>
          <CardTitle icon={Calendar}>Próximos 7 días</CardTitle>
          <div className="space-y-2">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Sin pagos programados en la próxima semana.</p>}
            {upcoming.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-border/50 last:border-0">
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.description}</p>
                  <p className="text-xs text-muted-foreground">{r.next_occurrence}</p>
                </div>
                <p className={`font-bold ${r.type === 'credit' ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {r.type === 'credit' ? '+' : '−'}{formatCurrency(Number(r.amount), r.currency)}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recurring por categoría (gastos mensualizados) */}
      {recurringByCategory.length > 0 && (
        <Card>
          <CardTitle icon={Repeat} action={<Link to="/recurring" className="text-xs font-bold text-primary hover:underline">Ver todas →</Link>}>
            Gastos recurrentes por categoría — {formatCurrency(recurringTotal, 'COP')}/mes
          </CardTitle>
          <div className="space-y-2">
            {recurringByCategory.map((cat) => {
              const pct = recurringTotal > 0 ? (cat.total / recurringTotal) * 100 : 0
              return (
                <div key={cat.name} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{cat.name}</span>
                      <span className="text-xs text-muted-foreground">({cat.count} recurrentes)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
                      <span className="font-bold text-rose-500">{formatCurrency(cat.total, 'COP')}</span>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {cat.items.slice(0, 5).join(' · ')}{cat.items.length > 5 && ` · +${cat.items.length - 5} más`}
                  </p>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Metas */}
      {goals.length > 0 && (
        <Card>
          <CardTitle icon={Target} action={<Link to="/goals" className="text-xs font-bold text-primary hover:underline">Ver todas →</Link>}>
            Metas activas
          </CardTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {goals.filter((g) => g.status === 'active').slice(0, 3).map((g) => {
              const pct = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0
              return (
                <div key={g.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-semibold truncate">{g.name}</p>
                  <div className="w-full h-2 bg-muted rounded-full mt-2 overflow-hidden">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1 text-xs">
                    <span className="text-muted-foreground">{formatCurrency(g.current_amount, g.currency)}</span>
                    <span className="font-bold">{formatCurrency(g.target_amount, g.currency)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
