import { computed } from 'vue'
import { useCurrency } from './useCurrency'
import { computeBuyScore } from '@/lib/scoring'
import { derivePosition } from '@/services/transactionsApi'

/**
 * Portfolio calculations — enriches actives with analysis data.
 * @param {Ref<Array>} actives - Reactive array of active assets
 * @param {Ref<Object>} analyses - Reactive map of cached analyses { TICKER: { data, profile } }
 * @param {Ref<Array>} transactions - Reactive array of all transactions (optional, for deriving positions)
 */
export function usePortfolio(actives, analyses, transactions) {
  const { convert, symbolFor, nativeCurrencyOf, forcedCurrency, eurUsdRate } = useCurrency()

  // ── Enriched asset list with portfolio metrics ──────────────────────
  const portfolioItems = computed(() => {
    return actives.value.map((asset) => {
      const cached = analyses.value?.[asset.ticker]
      const indicators = cached?.data?.indicators || null
      const projection = cached?.data?.projection || null
      const dividends = cached?.data?.dividends || []
      const cashFlow = cached?.data?.cashFlow || null
      const fundamentals = cached?.data?.fundamentals || null
      const scoring = indicators ? computeBuyScore(indicators, projection, dividends, cashFlow, fundamentals) : null

      const nativeCur = nativeCurrencyOf(asset.ticker)
      const sym = symbolFor(asset.ticker)
      const currentPrice = indicators?.currentPrice || asset.price || 0

      // Derive position from transactions if available, else fall back to asset fields
      let shares = asset.shares || 0
      let entryPrice = asset.entryPrice || 0
      if (transactions?.value?.length) {
        const assetTxs = transactions.value.filter(tx => tx.assetId === asset.id)
        if (assetTxs.length) {
          const pos = derivePosition(assetTxs, nativeCur, eurUsdRate.value)
          shares = pos.shares
          entryPrice = pos.entryPrice
        }
      }

      // Annual dividend per share (from projection or trailing)
      const annualDivPerShare = projection?.historical?.length
        ? projection.historical[projection.historical.length - 1]?.dividend || 0
        : 0

      // Convert prices to display currency
      const displayPrice = convert(currentPrice, nativeCur)
      const displayEntry = convert(entryPrice, nativeCur)
      const displayDivPerShare = convert(annualDivPerShare, nativeCur)

      // Portfolio metrics
      const positionValue = displayPrice * shares
      const annualIncome = displayDivPerShare * shares
      const yieldOnCost = entryPrice > 0 ? (annualDivPerShare / entryPrice) * 100 : 0
      const pnlPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0

      return {
        ...asset,
        indicators,
        projection,
        scoring,
        score: scoring?.score ?? null,
        currency: sym,
        nativeCurrency: nativeCur,
        sector: indicators?.sector || '-',
        currentPrice: displayPrice,
        rawCurrentPrice: currentPrice,
        annualDivPerShare: displayDivPerShare,
        positionValue,
        annualIncome,
        yieldOnCost,
        pnlPct,
        shares,
        entryPrice,
        hasPosition: shares > 0 && entryPrice > 0,
      }
    })
  })

  // Only items with a position (shares > 0)
  const positionedItems = computed(() =>
    portfolioItems.value.filter((i) => i.hasPosition)
  )

  // ── Aggregate KPIs ─────────────────────────────────────────────────
  const totalValue = computed(() =>
    positionedItems.value.reduce((sum, i) => sum + i.positionValue, 0)
  )

  const totalAnnualIncome = computed(() =>
    positionedItems.value.reduce((sum, i) => sum + i.annualIncome, 0)
  )

  const weightedYieldOnCost = computed(() => {
    const tv = totalValue.value
    if (!tv) return 0
    return positionedItems.value.reduce(
      (sum, i) => sum + i.yieldOnCost * (i.positionValue / tv),
      0,
    )
  })

  const totalCost = computed(() =>
    positionedItems.value.reduce((sum, i) => sum + (i.entryPrice ? convert(i.entryPrice, i.nativeCurrency) : 0) * i.shares, 0)
  )

  const totalPnlPct = computed(() => {
    const cost = totalCost.value
    if (!cost) return 0
    return ((totalValue.value - cost) / cost) * 100
  })

  // ── Distribution data for pie chart ────────────────────────────────
  const distributionByAsset = computed(() => {
    const tv = totalValue.value
    if (!tv) return []
    return positionedItems.value
      .map((i) => ({
        name: i.ticker,
        y: i.positionValue,
        pct: (i.positionValue / tv) * 100,
      }))
      .sort((a, b) => b.y - a.y)
  })

  const distributionBySector = computed(() => {
    const tv = totalValue.value
    if (!tv) return []
    const sectors = {}
    positionedItems.value.forEach((i) => {
      const s = i.sector || 'Sin sector'
      sectors[s] = (sectors[s] || 0) + i.positionValue
    })
    return Object.entries(sectors)
      .map(([name, y]) => ({ name, y, pct: (y / tv) * 100 }))
      .sort((a, b) => b.y - a.y)
  })

  return {
    portfolioItems,
    positionedItems,
    totalValue,
    totalAnnualIncome,
    weightedYieldOnCost,
    totalPnlPct,
    distributionByAsset,
    distributionBySector,
  }
}
