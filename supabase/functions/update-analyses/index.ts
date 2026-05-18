// Supabase Edge Function: update-analyses
// Recalcula el análisis Geraldine Weiss completo para todos los tickers
// que cualquier usuario tenga en su tabla `assets`. Se ejecuta vía cron
// (ver schema.sql sección 7) para mantener el ranking actualizado al día
// aunque nadie abra la app.
//
// Required env vars (Supabase Dashboard > Edge Functions > Secrets):
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
//   APP_BASE_URL              -> https://tu-app.vercel.app (sin slash final)
//
// Deploy:  supabase functions deploy update-analyses --no-verify-jwt
// Test:    supabase functions invoke update-analyses

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONCURRENCY = 5;
const DEFAULT_YEARS = 12;

// ── Geraldine Weiss core (port de src/lib/geraldine.js) ─────────────────────

type Price = { date: string; close: number };
type Dividend = { date: string; dividend?: number; adjDividend?: number };
type TrailingDiv = { date: string; annualDividend: number };
type DailyYield = { date: string; close: number; annualDividend: number; dividendYield: number };

function detectFrequency(dividends: Dividend[]): number {
  if (dividends.length < 3) return 1;
  const recent = dividends.slice(-8);
  if (recent.length < 2) return 1;
  let totalDays = 0;
  let count = 0;
  for (let i = 1; i < recent.length; i++) {
    const d1 = new Date(recent[i - 1].date);
    const d2 = new Date(recent[i].date);
    const days = (d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24);
    if (days > 0 && days < 400) {
      totalDays += days;
      count++;
    }
  }
  if (count === 0) return 1;
  const avg = totalDays / count;
  if (avg < 50) return 12;
  if (avg < 120) return 4;
  if (avg < 250) return 2;
  return 1;
}

function computeTrailingAnnualDividends(dividends: Dividend[]): TrailingDiv[] {
  if (!dividends.length) return [];
  const freq = detectFrequency(dividends);
  return dividends.map((d) => ({
    date: d.date,
    annualDividend: (d.adjDividend ?? d.dividend ?? 0) * freq,
  }));
}

function computeDailyYields(prices: Price[], trailing: TrailingDiv[]): DailyYield[] {
  if (!trailing.length || !prices.length) return [];
  const divMap = new Map<string, number>();
  trailing.forEach((d) => divMap.set(d.date, d.annualDividend));

  const results: DailyYield[] = [];
  let current = 0;
  for (const td of trailing) {
    if (td.date <= prices[0].date) current = td.annualDividend;
    else break;
  }
  for (const p of prices) {
    if (divMap.has(p.date)) current = divMap.get(p.date)!;
    const dy = p.close > 0 && current > 0 ? (current / p.close) * 100 : 0;
    results.push({ date: p.date, close: p.close, annualDividend: current, dividendYield: dy });
  }
  return results;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function computeHistoricalYieldBands(daily: DailyYield[], years: number) {
  if (!daily.length) return { avgHighYield: 0, avgLowYield: 0, avgYield: 0, yearlyData: [] };
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const valid = daily.filter((d) => d.date >= cutoffStr && d.dividendYield > 0).map((d) => d.dividendYield);
  if (!valid.length) return { avgHighYield: 0, avgLowYield: 0, avgYield: 0, yearlyData: [] };
  const sorted = [...valid].sort((a, b) => a - b);
  const avgLowYield = percentile(sorted, 3);
  const avgHighYield = percentile(sorted, 97);
  const avgYield = sorted.reduce((a, b) => a + b, 0) / sorted.length;

  const byYear: Record<string, number[]> = {};
  for (const d of daily) {
    if (d.date < cutoffStr || d.dividendYield <= 0) continue;
    const y = d.date.substring(0, 4);
    (byYear[y] ||= []).push(d.dividendYield);
  }
  const yearlyData = Object.keys(byYear).sort().map((year) => {
    const ys = byYear[year];
    return {
      year,
      high: Math.max(...ys),
      low: Math.min(...ys),
      avg: ys.reduce((a, b) => a + b, 0) / ys.length,
    };
  });
  return { avgHighYield, avgLowYield, avgYield, yearlyData };
}

function computeDividendProjection(trailing: TrailingDiv[], yearsToProject = 10) {
  if (trailing.length < 2) return { cagr: 0, historical: [], projected: [] };
  const byYear: Record<string, number> = {};
  for (const d of trailing) byYear[d.date.substring(0, 4)] = d.annualDividend;
  const ys = Object.keys(byYear).sort();
  const historical = ys.map((y) => ({ year: parseInt(y), dividend: byYear[y] }));
  const valid = historical.filter((h) => h.dividend > 0);
  if (valid.length < 2) return { cagr: 0, historical, projected: [] };
  const first = valid[0];
  const last = valid[valid.length - 1];
  const numYears = last.year - first.year;
  const cagr = numYears > 0 ? (Math.pow(last.dividend / first.dividend, 1 / numYears) - 1) * 100 : 0;
  const projected = [];
  for (let i = 1; i <= yearsToProject; i++) {
    projected.push({ year: last.year + i, dividend: last.dividend * Math.pow(1 + cagr / 100, i) });
  }
  return { cagr, historical, projected };
}

function computeIndicators(
  prices: Price[],
  dividends: Dividend[],
  years: number,
  profile: any,
) {
  const trailing = computeTrailingAnnualDividends(dividends);
  const daily = computeDailyYields(prices, trailing);
  const { avgHighYield, avgLowYield, avgYield } = computeHistoricalYieldBands(daily, years);

  const lastPrice = prices.length ? prices[prices.length - 1] : null;
  const lastYield = daily.length ? daily[daily.length - 1] : null;
  const lastAnnual = lastYield?.annualDividend ?? 0;

  const indicators = {
    currentPrice: lastPrice?.close || 0,
    currentYield: lastYield?.dividendYield || 0,
    avgYield,
    avgHighYield,
    avgLowYield,
    undervaluedPrice: avgHighYield > 0 && lastAnnual > 0 ? (lastAnnual / avgHighYield) * 100 : 0,
    overvaluedPrice: avgLowYield > 0 && lastAnnual > 0 ? (lastAnnual / avgLowYield) * 100 : 0,
    companyName: profile?.companyName || "",
    sector: profile?.sector || "",
    currency: profile?.currency || "USD",
  };

  const projection = computeDividendProjection(trailing, 10);
  return { indicators, projection };
}

// ── Buy score (port de src/lib/scoring.js) ──────────────────────────────────

function calcDividendStreak(dividends: any[]): number {
  if (!dividends || !dividends.length) return 0;
  const byYear: Record<string, { total: number; count: number }> = {};
  for (const d of dividends) {
    const year = String(d.date).substring(0, 4);
    const amt = Number(d.amount || d.dividend || 0);
    if (amt > 0) {
      if (!byYear[year]) byYear[year] = { total: 0, count: 0 };
      byYear[year].total += amt;
      byYear[year].count++;
    }
  }
  const currentYear = String(new Date().getFullYear());
  delete byYear[currentYear];
  const ys = Object.keys(byYear).sort();
  if (ys.length < 2) return 0;
  let streak = 0;
  for (let i = ys.length - 1; i > 0; i--) {
    const cur = byYear[ys[i]].total / byYear[ys[i]].count;
    const prev = byYear[ys[i - 1]].total / byYear[ys[i - 1]].count;
    if (cur > prev * 1.005) streak++;
    else break;
  }
  return streak;
}

function calcPayoutMetrics(cashFlow: any[] | null) {
  if (!cashFlow || !cashFlow.length) return { payoutRatio: null, fcfPayout: null } as { payoutRatio: number | null; fcfPayout: number | null };
  for (const cf of cashFlow) {
    const divPaid = Math.abs(Number(cf.dividendsPaid || cf.dividendPaid || 0));
    const fcf = Number(cf.freeCashFlow || 0);
    const netIncome = Number(cf.netIncome || 0);
    if (divPaid > 0) {
      return {
        fcfPayout: fcf > 0 ? (divPaid / fcf) * 100 : null,
        payoutRatio: netIncome > 0 ? (divPaid / netIncome) * 100 : null,
      };
    }
  }
  return { payoutRatio: null, fcfPayout: null };
}

function calcFundamentalMetrics(fundamentals: any) {
  if (!fundamentals) return { debtToEbitda: null, sharesDilution: null } as { debtToEbitda: number | null; sharesDilution: number | null };
  const income = fundamentals.income || [];
  const balance = fundamentals.balance || [];
  let debtToEbitda: number | null = null;
  if (income.length && balance.length) {
    const li = income[0];
    const lb = balance[0];
    const ebitda = Number(
      li.ebitda || (li.ebitdaratio && li.revenue ? li.ebitdaratio * li.revenue : 0),
    );
    const totalDebt = Number(lb.totalDebt || lb.longTermDebt || 0);
    if (ebitda > 0) debtToEbitda = totalDebt / ebitda;
  }
  let sharesDilution: number | null = null;
  if (income.length >= 2) {
    const recent = Number(income[0].weightedAverageShsOut || income[0].weightedAverageShsOutDil || 0);
    const oldIdx = Math.min(income.length - 1, 4);
    const old = Number(income[oldIdx].weightedAverageShsOut || income[oldIdx].weightedAverageShsOutDil || 0);
    if (recent > 0 && old > 0) sharesDilution = ((recent - old) / old) * 100;
  }
  return { debtToEbitda, sharesDilution };
}

function computeBuyScore(
  indicators: any,
  projection: any,
  dividends: any[],
  cashFlow: any[] | null,
  fundamentals: any,
): number {
  if (!indicators?.avgHighYield || !indicators?.avgLowYield) return 0;
  const { currentYield, avgHighYield, avgLowYield, currentPrice, undervaluedPrice } = indicators;
  const range = avgHighYield - avgLowYield;
  if (range <= 0) return 0;

  let yieldRatio = Math.max(0, (currentYield - avgLowYield) / range);
  let yieldScore: number;
  if (yieldRatio >= 1.0) yieldScore = 32 + (Math.min(yieldRatio - 1.0, 0.5) / 0.5) * 13;
  else if (yieldRatio >= 0.7) yieldScore = 22 + ((yieldRatio - 0.7) / 0.3) * 10;
  else if (yieldRatio >= 0.4) yieldScore = 10 + ((yieldRatio - 0.4) / 0.3) * 12;
  else yieldScore = (yieldRatio / 0.4) * 10;

  const cagr = projection?.cagr || 0;
  let cagrScore = 0;
  if (cagr > 0) cagrScore = Math.min(cagr * 0.8, 12);
  else if (cagr < 0) cagrScore = Math.max(cagr * 0.5, -4);

  let consistencyScore = 0;
  if (dividends?.length) {
    const ys = new Set(dividends.map((d: any) => String(d.date).substring(0, 4)));
    consistencyScore = Math.min(ys.size, 8);
  }

  let marginScore = 0;
  if (undervaluedPrice > 0 && currentPrice > 0) {
    const upside = (undervaluedPrice - currentPrice) / currentPrice;
    if (upside > 0) marginScore = Math.min(upside / 0.3, 1) * 5;
  }

  const streak = calcDividendStreak(dividends);
  let streakScore = 0;
  if (streak >= 25) streakScore = 12;
  else if (streak >= 10) streakScore = 8 + ((streak - 10) / 15) * 4;
  else if (streak >= 5) streakScore = 4 + ((streak - 5) / 5) * 4;
  else if (streak > 0) streakScore = streak;

  let payoutScore = 0;
  const { fcfPayout, payoutRatio } = calcPayoutMetrics(cashFlow);
  const payout = fcfPayout ?? payoutRatio;
  if (payout !== null) {
    if (payout < 30) payoutScore = 5;
    else if (payout < 50) payoutScore = 3;
    else if (payout < 70) payoutScore = 1;
    else if (payout < 85) payoutScore = 0;
    else if (payout < 100) payoutScore = -4;
    else payoutScore = -8;
  }

  const { debtToEbitda, sharesDilution } = calcFundamentalMetrics(fundamentals);
  let debtScore = 0;
  if (debtToEbitda !== null) {
    if (debtToEbitda < 1) debtScore = 3;
    else if (debtToEbitda < 2) debtScore = 2;
    else if (debtToEbitda < 3) debtScore = 0;
    else if (debtToEbitda < 5) debtScore = -2;
    else debtScore = -4;
  }
  let dilutionScore = 0;
  if (sharesDilution !== null) {
    if (sharesDilution < -5) dilutionScore = 2;
    else if (sharesDilution < -1) dilutionScore = 1;
    else if (sharesDilution < 3) dilutionScore = 0;
    else if (sharesDilution < 10) dilutionScore = -1;
    else dilutionScore = -3;
  }
  const fundamentalsScore = debtScore + dilutionScore;

  const raw = yieldScore + cagrScore + consistencyScore + marginScore + streakScore + payoutScore + fundamentalsScore;
  const score = Math.max(0, Math.min(100, raw));
  return Math.round(score * 10) / 10;
}

// ── Backend fetchers (llamamos a tu API Vercel para reusar normalización) ───

async function fetchJSON(url: string, timeoutMs = 25000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchTickerData(baseUrl: string, ticker: string, years: number) {
  const to = new Date();
  const from = new Date();
  from.setFullYear(from.getFullYear() - years - 1);
  const fromStr = from.toISOString().split("T")[0];
  const toStr = to.toISOString().split("T")[0];
  const sym = encodeURIComponent(ticker);

  const [prices, dividends, profile, cashFlow, fundamentals] = await Promise.all([
    fetchJSON(`${baseUrl}/api/prices?symbol=${sym}&from=${fromStr}&to=${toStr}`),
    fetchJSON(`${baseUrl}/api/dividends?symbol=${sym}&from=2000-01-01`),
    fetchJSON(`${baseUrl}/api/profile?symbol=${sym}`).catch(() => null),
    fetchJSON(`${baseUrl}/api/cashflow?symbol=${sym}`).catch(() => []),
    fetchJSON(`${baseUrl}/api/fundamentals?symbol=${sym}`).catch(() => null),
  ]);

  if (!Array.isArray(prices) || !prices.length) {
    throw new Error("no price data");
  }
  if (!Array.isArray(dividends) || !dividends.length) {
    throw new Error("no dividend data");
  }

  const filteredDividends = dividends.filter((d: Dividend) => d.date >= fromStr);
  return { prices, dividends: filteredDividends, profile, cashFlow, fundamentals };
}

// ── Concurrencia controlada ─────────────────────────────────────────────────

async function pMap<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const appBaseUrl = (Deno.env.get("APP_BASE_URL") || "").replace(/\/$/, "");

  if (!appBaseUrl) {
    return new Response(
      JSON.stringify({ error: "APP_BASE_URL secret no configurado" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1. Tickers que algún usuario tiene en assets
  const { data: assets, error: assetsErr } = await supabase
    .from("assets")
    .select("ticker, user_id");

  if (assetsErr) {
    return new Response(JSON.stringify({ error: assetsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ticker -> Set<user_id>
  const tickerUsers = new Map<string, Set<string>>();
  for (const a of assets || []) {
    if (!tickerUsers.has(a.ticker)) tickerUsers.set(a.ticker, new Set());
    tickerUsers.get(a.ticker)!.add(a.user_id);
  }
  const tickers = [...tickerUsers.keys()];

  // 2. Recoger el `years` ya guardado por (user, ticker) para respetar la
  //    ventana del usuario; si no hay, DEFAULT_YEARS.
  const { data: existing } = await supabase
    .from("analyses")
    .select("user_id, ticker, years");
  const yearsMap = new Map<string, number>(); // key: `${user}|${ticker}`
  for (const r of existing || []) {
    yearsMap.set(`${r.user_id}|${r.ticker}`, r.years || DEFAULT_YEARS);
  }

  const today = new Date().toISOString().split("T")[0];
  const results: Record<string, string> = {};

  await pMap(tickers, async (ticker) => {
    try {
      // Si distintos usuarios usan distinta ventana `years` para el mismo
      // ticker, hacemos un solo fetch (la ventana mayor) y luego computamos
      // por usuario con su `years` específico (el computo es local y barato).
      const userIds = [...tickerUsers.get(ticker)!];
      const userYears = userIds.map((u) => yearsMap.get(`${u}|${ticker}`) || DEFAULT_YEARS);
      const maxYears = Math.max(...userYears, DEFAULT_YEARS);

      const { prices, dividends, profile, cashFlow, fundamentals } =
        await fetchTickerData(appBaseUrl, ticker, maxYears);

      // Profile compacto (mismo shape que assetsApi.js cachea)
      const compactProfile = profile
        ? {
            companyName: profile.companyName,
            symbol: profile.symbol,
            price: profile.price,
            currency: profile.currency,
            image: profile.image,
            lastDividend: profile.lastDividend,
            sector: profile.sector,
            industry: profile.industry,
          }
        : null;

      // Upsert por usuario con su ventana propia
      for (const userId of userIds) {
        const yrs = yearsMap.get(`${userId}|${ticker}`) || DEFAULT_YEARS;
        const { indicators, projection } = computeIndicators(prices, dividends, yrs, profile);
        const score = computeBuyScore(indicators, projection, dividends, cashFlow, fundamentals);
        await supabase.from("analyses").upsert(
          {
            user_id: userId,
            ticker,
            years: yrs,
            last_updated: today,
            indicators,
            projection,
            dividends,
            cash_flow: cashFlow ?? null,
            fundamentals: fundamentals ?? null,
            profile: compactProfile,
            score,
          },
          { onConflict: "user_id,ticker" },
        );
      }

      // Refrescamos también el price del asset (para vistas que no usan analyses)
      if (compactProfile?.price) {
        await supabase
          .from("assets")
          .update({ price: compactProfile.price })
          .eq("ticker", ticker);
      }

      results[ticker] = "ok";
    } catch (err) {
      results[ticker] = `error: ${(err as Error).message}`;
    }
  }, CONCURRENCY);

  // Snapshot por usuario: promueve current_rank -> previous_rank y recalcula
  // current_rank desde el score persistido.
  const allUserIds = new Set<string>();
  for (const set of tickerUsers.values()) for (const uid of set) allUserIds.add(uid);
  for (const uid of allUserIds) {
    try {
      await supabase.rpc("snapshot_user_ranking", { uid });
    } catch (err) {
      console.warn(`snapshot_user_ranking(${uid}) failed:`, (err as Error).message);
    }
  }

  const okCount = Object.values(results).filter((v) => v === "ok").length;
  return new Response(
    JSON.stringify({
      date: today,
      tickers: tickers.length,
      ok: okCount,
      failed: tickers.length - okCount,
      snapshots: allUserIds.size,
      results,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
