import { useQuery } from '@tanstack/react-query'
import { loans as loansApi, accounts as accountsApiRaw, interestRates as ratesApi } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'
import { Swords, TrendingUp, Zap, Bolt, ArrowUp, ShieldAlert, CircleCheck, Flame } from 'lucide-react'
import type { Loan, Account, InterestRate } from '@/types'

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/** Convierte tasa mensual vencida (%) → efectiva anual (%). */
function mvToEa(mvPct: number): number {
  return (Math.pow(1 + mvPct / 100, 12) - 1) * 100
}

/** Tasa de usura vigente Colombia (agosto 2026). */
const USURA_EA = 29.66

type DebtRow = {
  id: string
  name: string
  entity: string
  kind: 'loan' | 'credit_card'
  balance: number
  minPayment: number | null
  cupo?: number | null           // Solo TC
  ea: number                      // Efectiva anual %
  mv: number                      // Mensual vencida %
  rateNote?: string               // Ej: "(real 152% capped)"
  currency: string
}

// ─────────────────────────────────────────────────────────
// Building the ranking
// ─────────────────────────────────────────────────────────

function buildRanking(loans: Loan[], accounts: Account[], rates: InterestRate[]): DebtRow[] {
  const rows: DebtRow[] = []

  // Loans (Avancoop, Omar, Libre Inv, Solventa)
  for (const l of loans) {
    const mv = Number(l.monthly_rate)
    const ea = mvToEa(mv)
    // Special case: Solventa está capped porque el validator no permite > 100
    // Real ~152% EA — leer notas
    let rateNote: string | undefined
    if (l.entity.toLowerCase().includes('solventa')) {
      rateNote = '~152% EA real (payday, ver notas)'
    }
    rows.push({
      id: l.id,
      name: l.name,
      entity: l.entity,
      kind: 'loan',
      balance: Number(l.current_balance),
      minPayment: Number(l.monthly_payment),
      ea, mv, rateNote,
      currency: l.currency,
    })
  }

  // Credit cards con balance > 0
  const ccAccounts = accounts.filter((a) => a.type === 'credit_card' && Number(a.balance) > 0)
  for (const a of ccAccounts) {
    // Buscar tasa: matchear por entity/product_name
    // Simplificación: usamos la última rate cuya product_name aparece en el nombre de la cuenta
    const matchingRates = rates.filter((r) => {
      const pn = r.product_name.toLowerCase()
      const an = a.name.toLowerCase()
      const rt = r.rate_type
      // Solo rate_type de compras (no mora)
      if (!rt.includes('compra') && rt !== 'otro') return false
      return pn.split(/\s+/).some((tok) => tok.length > 3 && an.includes(tok))
        || (an.includes('lulo') && pn.includes('tarjeta') && r.entity.toLowerCase().includes('lulo'))
        || (an.includes('mc') && pn.toLowerCase().includes('mastercard'))
        || (an.includes('visa') && pn.toLowerCase().includes('visa'))
    })
    // Tomar la más reciente por valid_from
    matchingRates.sort((x, y) => y.valid_from.localeCompare(x.valid_from))
    const latest = matchingRates[0]
    const ea = latest ? Number(latest.ea) : 29.66  // fallback usura
    const mv = latest ? Number(latest.mv) : 2.18
    rows.push({
      id: a.id,
      name: a.name,
      entity: a.name.toLowerCase().includes('occidente')
        ? 'Banco de Occidente'
        : a.name.toLowerCase().includes('lulo')
          ? 'Lulo Bank'
          : 'Otro',
      kind: 'credit_card',
      balance: Number(a.balance),
      minPayment: a.minimum_payment ? Number(a.minimum_payment) : null,
      cupo: a.credit_limit ? Number(a.credit_limit) : null,
      ea, mv,
      currency: a.currency,
    })
  }

  // Ordenar por EA descendente (mayor tasa primero = "más peligroso")
  return rows.sort((a, b) => b.ea - a.ea)
}

// ─────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────

function KpiCard({
  label, value, sublabel, icon: Icon, tone = 'default',
}: {
  label: string
  value: string
  sublabel?: string
  icon: React.ElementType
  tone?: 'default' | 'good' | 'bad'
}) {
  const toneClasses = {
    default: 'text-primary',
    good:    'text-emerald-500 dark:text-emerald-400',
    bad:     'text-rose-500 dark:text-rose-400',
  }[tone]
  return (
    <div className="flex-1 min-w-[200px] rounded-xl border border-border bg-card p-6 flex flex-col gap-2">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Icon className={`h-5 w-5 ${toneClasses}`} />
      </div>
      <p className="text-3xl font-bold text-foreground leading-tight">{value}</p>
      {sublabel && <p className={`text-sm font-medium ${toneClasses}`}>{sublabel}</p>}
    </div>
  )
}

function AttackTargetCard({ row }: { row: DebtRow }) {
  const isSolventa = row.entity.toLowerCase().includes('solventa')
  const eaColor = row.ea > USURA_EA ? 'text-rose-400' : row.ea > 25 ? 'text-amber-400' : 'text-emerald-400'
  return (
    <div className="rounded-xl border-2 border-primary bg-gradient-to-br from-slate-900 to-slate-950 shadow-xl overflow-hidden relative">
      <div className="absolute top-4 right-4">
        <div className="flex items-center gap-1 bg-primary text-primary-foreground text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider animate-pulse">
          Priority #1 Target
        </div>
      </div>
      <div className="p-6 md:p-8">
        <p className="text-primary text-xs font-black uppercase tracking-widest mb-2">
          High Impact Battle Action
        </p>
        <h3 className="text-white text-2xl font-black leading-tight flex items-center gap-2 mb-5">
          <Flame className="h-6 w-6 text-primary" />
          ATTACK: {row.name}
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg bg-slate-800 border border-slate-700 p-3">
            <p className="text-xs text-slate-400">Tasa EA</p>
            <p className={`text-lg font-black leading-none mt-1 ${eaColor}`}>{row.ea.toFixed(2)}%</p>
            {row.rateNote && <p className="text-[10px] text-slate-500 mt-1">{row.rateNote}</p>}
          </div>
          <div className="rounded-lg bg-slate-800 border border-slate-700 p-3">
            <p className="text-xs text-slate-400">Tasa MV</p>
            <p className="text-lg font-black leading-none mt-1 text-white">{row.mv.toFixed(2)}%</p>
          </div>
          <div className="rounded-lg bg-slate-800 border border-slate-700 p-3">
            <p className="text-xs text-slate-400">Saldo</p>
            <p className="text-lg font-black leading-none mt-1 text-white">{formatCurrency(row.balance, row.currency)}</p>
          </div>
          <div className="rounded-lg bg-slate-800 border border-slate-700 p-3">
            <p className="text-xs text-slate-400">vs Usura ({USURA_EA}%)</p>
            <p className={`text-lg font-black leading-none mt-1 ${row.ea > USURA_EA ? 'text-rose-400' : 'text-emerald-400'}`}>
              {row.ea > USURA_EA ? `+${(row.ea - USURA_EA).toFixed(1)}pp` : `−${(USURA_EA - row.ea).toFixed(1)}pp`}
            </p>
          </div>
        </div>

        <p className="text-slate-300 text-sm leading-relaxed max-w-3xl">
          {isSolventa ? (
            <>
              Tu peor enemigo financiero. <b className="text-white">Cada mes que rolean, Solventa gana ~$100K</b> en intereses tuyos.
              Solución: sacar cupo de <b className="text-white">Libre Inversión Lulo (21.56% EA)</b> para pagar Solventa completo y no volver a rollear.
              Ahorro anual estimado: <b className="text-emerald-400">$1,700,000</b>.
            </>
          ) : (
            <>
              Este es tu crédito con la tasa más alta activa. Bajo el método <b>Avalanche</b>, cada peso extra
              aquí ahorra <b className="text-emerald-400">{(row.ea / 100 * 1000).toFixed(0)} pesos</b> anuales
              por cada $1,000 abonados.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

function DebtBattleRow({ row, rank }: { row: DebtRow; rank: number }) {
  const eaColor = row.ea > USURA_EA + 20 ? 'text-rose-500'
    : row.ea > USURA_EA ? 'text-rose-400'
    : row.ea > 25 ? 'text-amber-400'
    : row.ea > 15 ? 'text-yellow-500'
    : 'text-emerald-400'
  const utilization = row.cupo ? (row.balance / row.cupo) * 100 : null
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 p-5 rounded-xl border border-border bg-card hover:bg-muted/30 transition-all">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="size-10 rounded-full bg-muted flex items-center justify-center font-bold text-muted-foreground text-sm shrink-0">
          #{rank}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-foreground truncate">{row.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.entity} · {row.kind === 'loan' ? 'Préstamo' : 'Tarjeta de crédito'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6 md:flex-[2]">
        <div>
          <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Tasa EA</p>
          <p className={`font-black ${eaColor}`}>{row.ea.toFixed(2)}%</p>
          {row.rateNote && <p className="text-[9px] text-muted-foreground mt-0.5">{row.rateNote}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Saldo</p>
          <p className="font-bold text-foreground">{formatCurrency(row.balance, row.currency)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">Cuota mín</p>
          <p className="font-bold text-foreground">
            {row.minPayment ? formatCurrency(row.minPayment, row.currency) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-black tracking-widest text-muted-foreground">
            {utilization !== null ? 'Uso cupo' : 'Estado'}
          </p>
          {utilization !== null ? (
            <div>
              <div className="w-full h-2 bg-muted rounded-full mt-1 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    utilization > 90 ? 'bg-rose-500' : utilization > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.min(utilization, 100)}%` }}
                />
              </div>
              <p className={`text-[10px] mt-1 font-bold ${
                utilization > 90 ? 'text-rose-500' : utilization > 70 ? 'text-amber-500' : 'text-emerald-500'
              }`}>
                {utilization.toFixed(1)}%
              </p>
            </div>
          ) : (
            <span className="text-emerald-500 font-bold text-xs flex items-center gap-1">
              <CircleCheck className="h-3 w-3" /> Activo
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────

export default function LoansBattlePage() {
  const { data: loans = [], isLoading: lLoad } = useQuery({ queryKey: ['loans'], queryFn: () => loansApi.list() })
  const { data: accounts = [], isLoading: aLoad } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsApiRaw.list() })
  const { data: rates = [], isLoading: rLoad } = useQuery({ queryKey: ['interest-rates'], queryFn: () => ratesApi.list() })

  const isLoading = lLoad || aLoad || rLoad
  const ranking = buildRanking(loans, accounts, rates)

  // KPIs
  const totalDebt = ranking.reduce((s, r) => s + r.balance, 0)
  const totalMonthlyInterest = ranking.reduce(
    (s, r) => s + (r.balance * (r.mv / 100)),
    0,
  )
  const totalAnnualInterest = ranking.reduce(
    (s, r) => s + (r.balance * (r.ea / 100)),
    0,
  )
  const attackTarget = ranking[0]

  // Ahorro potencial: mover todo lo que esté por encima de Libre Inv (21.56%) a esa tasa
  const targetRate = 21.56
  const potentialSavings = ranking.reduce((s, r) => {
    if (r.ea > targetRate) {
      const currentAnnual = r.balance * (r.ea / 100)
      const targetAnnual  = r.balance * (targetRate / 100)
      return s + (currentAnnual - targetAnnual)
    }
    return s
  }, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        section="Finanzas"
        title="Debt Rate Battle"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold rounded uppercase tracking-wider">
          Strategy: Avalanche
        </span>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">
          Ataca primero la tasa más alta para minimizar el costo total.
        </span>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Calculando...</p>}

      {!isLoading && ranking.length > 0 && (
        <>
          {/* KPIs */}
          <div className="flex flex-wrap gap-4">
            <KpiCard
              label="Deuda total"
              value={formatCurrency(totalDebt, 'COP')}
              sublabel={`${ranking.length} obligaciones activas`}
              icon={ShieldAlert}
              tone="bad"
            />
            <KpiCard
              label="Interés mensual estimado"
              value={formatCurrency(totalMonthlyInterest, 'COP')}
              sublabel={`~${formatCurrency(totalAnnualInterest, 'COP')} / año`}
              icon={TrendingUp}
              tone="bad"
            />
            <KpiCard
              label="Ahorro potencial anual"
              value={formatCurrency(potentialSavings, 'COP')}
              sublabel={`Si refinancias todo a ${targetRate}% EA (Libre Inv)`}
              icon={Zap}
              tone="good"
            />
          </div>

          {/* Attack Target Hero Card */}
          {attackTarget && <AttackTargetCard row={attackTarget} />}

          {/* Battleground list */}
          <div>
            <div className="flex items-center justify-between px-1 mb-4">
              <h4 className="text-xl font-bold flex items-center gap-2">
                <Swords className="h-5 w-5" /> The Battleground
                <span className="text-sm font-normal text-muted-foreground">
                  ({ranking.length} rankeadas por tasa)
                </span>
              </h4>
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                Orden: <span className="text-primary bg-primary/10 px-2 py-1 rounded">Mayor tasa EA</span>
                <ArrowUp className="h-3 w-3" />
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {ranking.map((row, i) => (
                <DebtBattleRow key={row.id} row={row} rank={i + 1} />
              ))}
            </div>
          </div>

          {/* Legal frame */}
          <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm space-y-2">
            <p className="font-bold flex items-center gap-2">
              <Bolt className="h-4 w-4 text-primary" /> Marco legal Colombia (ago 2026)
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div><span className="text-muted-foreground">Usura ordinaria:</span> <b>29.66% EA</b></div>
              <div><span className="text-muted-foreground">IBC:</span> <b>19.77% EA</b></div>
              <div><span className="text-muted-foreground">Consumo bajo monto:</span> <b>~55% EA</b></div>
              <div><span className="text-muted-foreground">Microcrédito:</span> <b>~53-70% EA</b></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
