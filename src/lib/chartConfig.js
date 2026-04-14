/**
 * Shared chart configuration for consistent styling across all charts
 */

export const labelStyle = { color: '#71717a', fontSize: '10px' }
export const gridColor = 'rgba(255, 255, 255, 0.04)'
export const titleStyle = { color: '#e4e4e7', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }

// Shared subtitle config for data-freshness labels under chart titles
export const freshSubtitle = (text) => ({
  text: text || '',
  align: 'left',
  style: { color: '#71717a', fontSize: '10px', fontWeight: '400', textTransform: 'none', letterSpacing: '0' },
})

// Muted teal — secondary accent, distinct from red/green/blue
export const earthyBrown = '#78b0a8'

// Common legend config: bottom center
export const legendBottom = {
  align: 'center',
  verticalAlign: 'bottom',
  floating: false,
  y: 4,
  itemStyle: { color: '#71717a', fontSize: '9px', fontWeight: '500' },
  itemHoverStyle: { color: '#a1a1aa' },
  symbolRadius: 3,
  symbolHeight: 8,
  symbolWidth: 8,
  itemDistance: 12,
}

// Format large numbers — 2 decimal places for billions for precision
export function fmtNum(val) {
  if (Math.abs(val) >= 1e9) return (val / 1e9).toFixed(2) + 'B'
  if (Math.abs(val) >= 1e6) return (val / 1e6).toFixed(0) + 'M'
  return val.toLocaleString()
}

// CAGR calculation
export function cagr(values) {
  const valid = values.filter((v) => v > 0)
  if (valid.length < 2) return 0
  return (Math.pow(valid[valid.length - 1] / valid[0], 1 / (valid.length - 1)) - 1) * 100
}

// Extract year from date string "YYYY-MM-DD" or "YYYY-MM"
export function yearFromDate(dateStr) {
  return String(dateStr || '').substring(0, 4)
}

// Health indicator colors
export const healthColors = { green: '#34d399', neutral: '#fbbf24', red: '#f87171' }

// Build chart title with optional health dot
export function chartTitle(text, health) {
  if (!health) return { text, align: 'left', style: titleStyle, useHTML: false }
  const color = healthColors[health]
  return {
    text: `${text} <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-left:6px;vertical-align:middle;opacity:0.85;"></span>`,
    useHTML: true,
    align: 'left',
    style: titleStyle,
  }
}

// Glassmorphism tooltip builder
export function buildTooltip(x, points, opts = {}) {
  let html = `<div style="background:rgba(14,14,22,0.85);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:10px 14px;box-shadow:0 8px 32px rgba(0,0,0,0.4);min-width:160px;">`
  html += `<div style="color:#a1a1aa;font-size:10px;margin-bottom:6px;">${x}</div>`
  points.forEach((p) => {
    if (p.y == null) return
    let val
    if (p.series.yAxis?.options?.opposite) {
      // secondary axis — check format
      const fmt = opts.secondaryFormat || '%'
      val = fmt === 'x' ? p.y.toFixed(2) + 'x' : p.y.toFixed(2) + '%'
    } else {
      val = fmtNum(p.y)
    }
    html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;"><span style="width:6px;height:6px;border-radius:50%;background:${p.color};flex-shrink:0;"></span><span style="color:#a1a1aa;font-size:11px;flex:1;">${p.series.name}</span><span style="color:#e4e4e7;font-size:11px;font-weight:600;">${val}</span></div>`
  })
  html += '</div>'
  return html
}
