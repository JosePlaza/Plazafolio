/**
 * LLM Provider — Pluggable narrative generation for financial reports
 *
 * Currently supports:
 *   - Gemini Flash (default, free tier: 15 RPM / 1M tokens/day)
 *
 * Future: Ollama (local), Anthropic, OpenAI via BYOK
 *
 * Each provider implements: generateNarrative(ticker, reportData) → string
 */

// Models in order of preference — first available wins
// Priority: 3.1 Flash Lite (500 RPD!) → 3 Flash → 2.5 Flash Lite → 2.5 Flash
const GEMINI_MODELS = [
  'gemini-3.1-flash-lite-preview',  // 15 RPM, 500 RPD — most generous free tier
  'gemini-3-flash-preview',          // 5 RPM, 20 RPD — Pro-level quality
  'gemini-2.5-flash-lite',           // 10 RPM, 20 RPD — fallback
  'gemini-2.5-flash',                // 5 RPM, 20 RPD — last resort
]
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/'

/**
 * Build the prompt for the LLM from structured report data.
 */
function buildPrompt(ticker, report) {
  const rows = Object.entries(report.metrics)
    .map(([key, m]) => {
      const fmtVal = (v) => {
        if (m.format === 'currency') {
          const abs = Math.abs(v)
          if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
          if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
          return `$${v.toFixed(0)}`
        }
        if (m.format === 'percent') return `${v}%`
        if (m.format === 'decimal') return `$${v.toFixed(2)}`
        return String(v)
      }
      return `- ${m.label}: ${fmtVal(m.previous)} → ${fmtVal(m.current)} (${m.change > 0 ? '+' : ''}${m.change}%, ${m.direction})`
    })
    .join('\n')

  return `Eres un analista financiero senior escribiendo para inversores particulares en español.

Empresa: ${ticker}
Informe: ${report.reportType} · ${report.periodCurrent} vs ${report.periodPrevious}
Presentado: ${report.filedDate}

Datos disponibles:
${rows}

Diagnóstico cuantitativo: ${report.diagnosis.summary}
Señales: ${report.diagnosis.signals.map(s => `[${s.type}] ${s.text}`).join('; ')}

Tu tarea: escribe un ANÁLISIS CUALITATIVO (4-5 párrafos, máx 350 palabras) que explique el PORQUÉ detrás de los números. El usuario ya ve las métricas en una tabla, así que NO repitas cifras salvo para dar contexto a tu explicación.

IMPORTANTE — Contexto noticioso:
Usa tu acceso a Google Search para buscar noticias y eventos relevantes de ${ticker} durante el periodo ${report.periodCurrent} que puedan explicar los resultados. Ejemplos: cambios de CEO, reestructuraciones, adquisiciones, demandas judiciales, lanzamientos de producto, cambios regulatorios, aranceles, problemas en la cadena de suministro, etc. Incluye esta información en tu análisis de forma natural, citando la fuente cuando sea posible.

Estructura:
1. CONTEXTO — ¿Qué eventos relevantes ocurrieron durante este periodo? Menciona noticias concretas (cambios directivos, demandas, adquisiciones, nuevos productos, factores macro) que hayan podido influir en los resultados. Cita las fuentes.
2. ANÁLISIS — ¿Qué le está pasando al negocio? Conecta los eventos del contexto con la evolución de las métricas. Si caen ingresos, ¿es por demanda débil, pérdida de cuota, efecto divisa, aranceles? Si mejora el margen pero cae el ingreso, ¿es por recorte de costes? Busca la historia detrás del dato.
3. IMPLICACIONES — ¿Qué implica esto para el inversor a largo plazo? Comenta la sostenibilidad del dividendo, la posición de deuda/caja, y si los fundamentales apoyan mantener, ampliar o vigilar la posición.

Reglas:
- Español, tono directo y profesional, sin rodeos
- Solo párrafos, NUNCA listas con viñetas ni bullet points
- No inventes datos — si no puedes deducir el porqué, di "probablemente" o "posiblemente"
- Cuando menciones una noticia o evento, indica brevemente la fuente (ej: "según Reuters", "como reportó Bloomberg")
- Evita frases genéricas tipo "los inversores deberían vigilar de cerca" — sé concreto`
}

/**
 * Call Gemini Flash API to generate a narrative summary.
 * Returns { text, sources } where sources is an array of { title, url }.
 * @param {string} prompt
 * @param {string} apiKey - User-provided Gemini API key
 */
async function callGemini(prompt, apiKey) {
  if (!apiKey) {
    console.warn('[LLM] No Gemini API key provided — skipping narrative generation')
    return null
  }

  // Strategy: try with Google Search grounding first (richer output with sources).
  // If all models hit 429 (quota), retry WITHOUT grounding (plain analysis, no sources).
  // Free tier grounding limit is ~20 RPD — plain calls have a higher limit.

  for (const useGrounding of [true, false]) {
    const bodyObj = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 700,
        topP: 0.8,
      },
    }
    if (useGrounding) bodyObj.tools = [{ google_search: {} }]
    const body = JSON.stringify(bodyObj)
    const mode = useGrounding ? 'grounded' : 'plain'

    let allQuotaExhausted = true
    for (const model of GEMINI_MODELS) {
      try {
        const url = `${GEMINI_BASE}${model}:generateContent?key=${apiKey}`
        console.log(`[LLM] Trying ${model} (${mode})...`)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })

        if (!res.ok) {
          const errBody = await res.text()
          console.warn(`[LLM] ${model} HTTP ${res.status} (${mode}):`, errBody.slice(0, 200))
          if (res.status === 429 || res.status === 403) continue
          let errorMsg = `Gemini API error ${res.status}`
          try { errorMsg = JSON.parse(errBody).error?.message || errorMsg } catch {}
          throw new Error(errorMsg)
        }

        allQuotaExhausted = false
        const data = await res.json()
        const candidate = data.candidates?.[0]

        // Log structure for debugging
        if (candidate) {
          const gm = candidate.groundingMetadata || candidate.grounding_metadata
          console.log(`[LLM] ${model} (${mode}): ${candidate.content?.parts?.length} parts, groundingMetadata: ${gm ? Object.keys(gm).join(',') : 'none'}`)
        }

        // Grounded responses may have multiple text parts — concatenate all
        const parts = candidate?.content?.parts || []
        const text = parts.filter(p => p.text).map(p => p.text).join('')

        if (text?.trim()) {
          const sources = useGrounding ? extractGroundingSources(candidate, data) : []
          console.log(`[LLM] ✓ ${model} (${mode}), ${text.length} chars, ${sources.length} sources`)
          return { text: text.trim(), sources }
        }
      } catch (err) {
        console.warn(`[LLM] ${model} (${mode}) failed:`, err.message)
        allQuotaExhausted = false
      }
    }

    // If grounded mode had all 429s, fall through to plain mode
    if (useGrounding && allQuotaExhausted) {
      console.log('[LLM] Grounding quota exhausted — retrying without grounding...')
      continue
    }
    // If plain mode also failed completely, break
    if (!useGrounding) break
  }

  throw new Error('All Gemini models failed (quota exhausted)')
}

/**
 * Extract grounding sources from Gemini response.
 * Searches in candidate.groundingMetadata and also top-level response.
 * Returns deduplicated array of { title, url }.
 */
function extractGroundingSources(candidate, fullResponse) {
  const sources = []
  const seen = new Set()

  // Try multiple locations where grounding metadata might live
  const metadataSources = [
    candidate?.groundingMetadata,
    candidate?.grounding_metadata,
    fullResponse?.candidates?.[0]?.groundingMetadata,
    fullResponse?.candidates?.[0]?.grounding_metadata,
  ]

  for (const meta of metadataSources) {
    if (!meta) continue
    const chunks = meta.groundingChunks || meta.grounding_chunks || []
    for (const chunk of chunks) {
      const web = chunk.web || chunk.Web || {}
      const url = web.uri || web.url
      const title = web.title || ''
      if (url && !seen.has(url)) {
        seen.add(url)
        sources.push({ title: title.trim(), url })
      }
    }
    // Also check supportingSearchResults (alternative field name)
    const searchResults = meta.searchEntryPoint?.searchResults
      || meta.webSearchQueries || []
    // Log search queries for debugging
    if (meta.webSearchQueries?.length) {
      console.log(`[LLM] Grounding search queries: ${meta.webSearchQueries.join(', ')}`)
    }
  }

  return sources
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Income Simulator — Contextual recommendations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build prompt for "Optimal Mix" simulator recommendations.
 * Gemini receives ranked candidates + suggested allocation and generates advice.
 */
function buildIncomeRecommendationPrompt(simulationData) {
  const { assets, allocation, allocationTotals, amount, years } = simulationData

  const candidateRows = assets
    .slice(0, 10) // top 10 by composite score
    .map((a, i) => {
      const safety = a.safetyScore != null ? `Safety: ${a.safetyScore}/10` : 'Safety: ?'
      const payout = a.payoutRatio != null ? `Payout: ${a.payoutRatio}%` : ''
      return `${i + 1}. ${a.ticker} — Yield: ${a.yieldPct}% | CAGR div: ${a.dividendCAGR}% | ${safety} | ${payout} | Score: ${a.compositeScore}/10`
    })
    .join('\n')

  const allocationRows = allocation
    .map(a => `- ${a.ticker}: ${a.weight}% (€${a.amount}) → Income año ${years}: €${a.incomeYearN}/año`)
    .join('\n')

  const totalsSummary = allocationTotals
    ? `Income total año ${years}: €${allocationTotals.incomeYearN}/año | Income acumulado ${years}a: €${allocationTotals.totalIncome} | Valor final: €${allocationTotals.finalValue}`
    : ''

  return `Eres un asesor de inversión en dividendos escribiendo para un inversor particular en español.

CONTEXTO: El usuario quiere invertir €${amount} a ${years} años con reinversión de dividendos (DRIP).

ACTIVOS CANDIDATOS (ordenados por score compuesto yield+crecimiento+seguridad):
${candidateRows}

ASIGNACIÓN SUGERIDA POR EL ALGORITMO:
${allocationRows}
${totalsSummary}

Tu tarea: genera un ANÁLISIS DE LA ASIGNACIÓN (2-3 párrafos, máx 250 palabras).

Analiza:
1. ¿Tiene sentido la distribución propuesta? ¿El equilibrio entre yield alto (income inmediato) y CAGR alto (crecimiento futuro) es adecuado?
2. ¿Hay algún activo que el algoritmo haya incluido pero tú desaconsejarías? (yield traps, payout insostenible, CAGR 0%)
3. ¿Echas en falta algún tipo de activo para diversificar? (ej. solo hay tech, falta utilities/consumer staples)
4. Comenta brevemente el efecto DRIP compuesto sobre el income proyectado.

Reglas:
- Español, tono asesor financiero cercano pero profesional
- Solo párrafos, NUNCA listas con viñetas
- Usa datos concretos (tickers, yields, CAGRs, scores) — no seas genérico
- Si ves algún riesgo claro, dilo directamente
- Termina con: "Esto no constituye asesoría financiera."
- No repitas números que el usuario ya ve — interprétalos`
}

/**
 * Generate contextual recommendations for the income simulator.
 * Returns { text, sources } or null.
 */
export async function generateIncomeRecommendation(simulationData, apiKey) {
  if (!apiKey) return null
  const prompt = buildIncomeRecommendationPrompt(simulationData)
  const result = await callGemini(prompt, apiKey)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Earnings Call Dividend Decoder — AI analysis of earnings call transcripts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build prompt for Earnings Call Dividend Decoder.
 * Two modes:
 *   1. With transcript text → deep analysis of actual words
 *   2. Without transcript → Gemini uses Google Search to find earnings call info
 *
 * @param {string} ticker
 * @param {string} fiscalPeriod - e.g. "Q4 2025"
 * @param {string|null} transcriptContext - Dividend-relevant excerpt, or null for search mode
 */
function buildEarningsCallPrompt(ticker, fiscalPeriod, transcriptContext) {
  const hasTranscript = transcriptContext && transcriptContext.length > 100

  const transcriptBlock = hasTranscript
    ? `\nTRANSCRIPTO (extracto relevante a dividendos):\n---\n${transcriptContext}\n---\n`
    : `\nNo hay transcripto disponible. Usa tu acceso a Google Search para buscar información sobre el earnings call de ${ticker} del periodo ${fiscalPeriod}. Busca específicamente: transcripciones, resúmenes de analistas, artículos sobre el call, declaraciones del CEO/CFO sobre dividendos y capital allocation.\n`

  return `Eres un analista especializado en política de dividendos, escribiendo para inversores particulares en español.

Empresa: ${ticker}
Periodo: ${fiscalPeriod}
${transcriptBlock}
Tu tarea: genera un BRIEF DE EARNINGS CALL orientado a dividendos (3-4 párrafos, máx 300 palabras) con la siguiente estructura:

1. POLÍTICA DE DIVIDENDOS — ¿Qué dijo el management sobre el dividendo? ¿Mencionaron payout target, política de crecimiento, compromiso con el dividendo? Si no mencionaron el dividendo, esto es una señal en sí misma — indícalo.

2. ASIGNACIÓN DE CAPITAL — ¿Cómo distribuye la empresa su cash flow? ¿Priorizan dividendos, buybacks, reinversión, o reducción de deuda? ¿Hubo cambios respecto al trimestre anterior?

3. TONO DEL MANAGEMENT — ¿El CEO/CFO sonó confiado, cauteloso, evasivo o entusiasta al hablar de retorno al accionista? Cita textualmente 2-3 frases clave del management (máx 25 palabras cada cita) que sean relevantes para la política de dividendos. Si no hay transcript, busca citas en fuentes públicas.

Al final de tu respuesta, añade en una línea separada:
TONO: [una palabra: Confiado | Cauteloso | Evasivo | Entusiasta | Neutral | Sin mención]

Reglas:
- Español, tono directo y profesional
- Solo párrafos, NUNCA listas con viñetas
- Las citas textuales deben ir entre comillas y atribuidas al speaker (ej: "Según el CFO: «...»")
- Si el transcript no menciona dividendos en absoluto, di claramente: "El management no discutió la política de dividendos en este call" — esto es información valiosa
- Si usas Google Search, cita las fuentes
- No inventes citas — si no tienes la cita exacta, parafrasea indicándolo`
}

/**
 * Generate Earnings Call Dividend Brief.
 * Returns { text, sources, tone } or null.
 *
 * @param {string} ticker
 * @param {string} fiscalPeriod
 * @param {string|null} transcriptContext
 * @param {string} apiKey
 */
export async function generateEarningsCallBrief(ticker, fiscalPeriod, transcriptContext, apiKey) {
  if (!apiKey) return null
  const prompt = buildEarningsCallPrompt(ticker, fiscalPeriod, transcriptContext)
  const result = await callGemini(prompt, apiKey)
  if (!result) return null

  // Extract tone from the last line
  let tone = 'Neutral'
  const toneMatch = result.text.match(/TONO:\s*(Confiado|Cauteloso|Evasivo|Entusiasta|Neutral|Sin mención)/i)
  if (toneMatch) {
    tone = toneMatch[1]
    // Remove the TONO line from the text
    result.text = result.text.replace(/\n?TONO:\s*.+$/i, '').trim()
  }

  return {
    text: result.text,
    sources: result.sources || [],
    tone,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dividend Safety Analysis — AI-enhanced risk assessment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build prompt for Dividend Safety Radar analysis.
 * Gemini receives the mechanical score + factors and generates contextual analysis.
 */
function buildSafetyPrompt(ticker, safetyData) {
  const factorRows = safetyData.factors
    .map(f => `- ${f.name} (${f.weight}): ${f.label} — Score: ${f.score}/10 [${f.signal}]`)
    .join('\n')

  return `Eres un analista de riesgo de dividendos escribiendo para inversores particulares en español.

Empresa: ${ticker}
Score de Seguridad del Dividendo: ${safetyData.score}/10 (${safetyData.level})
${safetyData.isReit ? '⚠️ Esta empresa es un REIT — los umbrales de payout son más altos por obligación legal de distribuir >90% de beneficios.' : ''}

Desglose de factores:
${factorRows}

Resumen mecánico: ${safetyData.summary}

CONTEXTO NOTICIOSO (OBLIGATORIO):
Usa tu acceso a Google Search para buscar noticias recientes de ${ticker} que puedan afectar a la sostenibilidad del dividendo. Busca específicamente:
- Recortes o aumentos de dividendo recientes o anunciados
- Guidance del management sobre política de dividendos
- Demandas, multas, o problemas regulatorios
- Reestructuraciones, adquisiciones, o desinversiones
- Cambios en la deuda o calificación crediticia
- Problemas sectoriales que afecten al cash flow

Tu tarea: escribe un ANÁLISIS DE RIESGO DEL DIVIDENDO (2-3 párrafos, máx 250 palabras) que:

1. CONTEXTO — ¿Hay noticias recientes que afecten la seguridad del dividendo? Cita fuentes concretas.
2. DIAGNÓSTICO — Explica los factores de riesgo principales (los que puntúan más bajo) y por qué importan. Si el dividendo es seguro, explica qué lo sostiene.
3. QUÉ VIGILAR — Señales concretas que el inversor debería monitorear en los próximos trimestres.

Reglas:
- Español, tono directo y profesional
- Solo párrafos, NUNCA listas con viñetas
- No repitas los números que el usuario ya ve en la ficha — interprétalos
- Sé específico: "la deuda/EBITDA de 3.2x limita el margen para mantener el dividendo si caen ingresos" es mejor que "la deuda es preocupante"
- Cuando menciones noticias, indica la fuente`
}

/**
 * Generate AI analysis for dividend safety.
 * Returns { text, sources } or null if no API key.
 */
export async function generateSafetyAnalysis(ticker, safetyData, apiKey) {
  if (!apiKey) return null
  const prompt = buildSafetyPrompt(ticker, safetyData)
  const result = await callGemini(prompt, apiKey)
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// TTS — Text-to-Speech via Gemini 2.5 Flash TTS
// ─────────────────────────────────────────────────────────────────────────────

const TTS_MODEL = 'gemini-2.5-flash-preview-tts'

/**
 * Convert narrative text to speech audio using Gemini TTS.
 * Returns a Buffer containing a WAV file, or null on failure.
 *
 * @param {string} text - The narrative text to convert
 * @param {string} apiKey - Gemini API key
 * @returns {Promise<Buffer|null>}
 */
export async function generateAudio(text, apiKey) {
  if (!apiKey || !text) return null

  const url = `${GEMINI_BASE}${TTS_MODEL}:generateContent?key=${apiKey}`
  const body = JSON.stringify({
    contents: [{
      parts: [{
        text: `Lee este análisis financiero en español con tono profesional y claro, como un presentador de noticias financieras. Ritmo pausado y natural:\n\n${text}`,
      }],
    }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Orus',
          },
        },
      },
    },
  })

  console.log(`[TTS] Generating audio with ${TTS_MODEL}...`)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.warn(`[TTS] ${TTS_MODEL} HTTP ${res.status}:`, errBody.slice(0, 200))
      let msg = `Gemini TTS error ${res.status}`
      try { msg = JSON.parse(errBody).error?.message || msg } catch {}
      throw new Error(msg)
    }

    const data = await res.json()
    const candidate = data.candidates?.[0]
    const parts = candidate?.content?.parts || []

    // TTS returns inlineData with audio bytes (base64-encoded PCM)
    const audioPart = parts.find(p => p.inlineData)
    if (!audioPart?.inlineData?.data) {
      console.warn('[TTS] No audio data in response. Parts:', parts.map(p => Object.keys(p)))
      return null
    }

    const pcmBase64 = audioPart.inlineData.data
    const mimeType = audioPart.inlineData.mimeType || 'audio/L16;rate=24000'
    console.log(`[TTS] Got audio: ${pcmBase64.length} base64 chars, mime: ${mimeType}`)

    // Decode base64 to raw PCM buffer
    const pcmBuffer = Buffer.from(pcmBase64, 'base64')

    // Wrap PCM in WAV container (16-bit mono 24kHz)
    const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16)
    console.log(`[TTS] ✓ WAV generated: ${(wavBuffer.length / 1024).toFixed(0)} KB`)

    return wavBuffer
  } catch (err) {
    console.error('[TTS] Failed:', err.message)
    throw err
  }
}

/**
 * Convert raw PCM data to WAV format by adding RIFF headers.
 * @param {Buffer} pcmData - Raw PCM audio data
 * @param {number} sampleRate - e.g. 24000
 * @param {number} numChannels - 1 for mono
 * @param {number} bitsPerSample - 16
 * @returns {Buffer} WAV file buffer
 */
function pcmToWav(pcmData, sampleRate, numChannels, bitsPerSample) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = pcmData.length
  const headerSize = 44
  const buffer = Buffer.alloc(headerSize + dataSize)

  // RIFF header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)

  // fmt sub-chunk
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)           // sub-chunk size
  buffer.writeUInt16LE(1, 20)            // PCM format
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)

  // data sub-chunk
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  pcmData.copy(buffer, 44)

  return buffer
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a narrative summary for a financial report.
 * Returns null if no API key is provided or the call fails (graceful degradation).
 *
 * @param {string} ticker
 * @param {Object} report - Report object with metrics, diagnosis, etc.
 * @param {string} apiKey - User-provided Gemini API key
 * @returns {Promise<string|null>}
 */
/**
 * Generate a narrative summary for a financial report.
 * Returns { text, sources } or null if no API key.
 *
 * @param {string} ticker
 * @param {Object} report - Report object with metrics, diagnosis, etc.
 * @param {string} apiKey - User-provided Gemini API key
 * @returns {Promise<{text: string, sources: Array<{title: string, url: string}>}|null>}
 */
export async function generateNarrative(ticker, report, apiKey) {
  if (!apiKey) return null
  const prompt = buildPrompt(ticker, report)

  // Currently only Gemini; extend here for Ollama / Anthropic / OpenAI
  const result = await callGemini(prompt, apiKey)
  return result
}

/**
 * Quick validation: send a trivial prompt to check if the API key works.
 * Returns { ok: true } or { ok: false, error: '...' }
 */
export async function testApiKey(apiKey) {
  if (!apiKey) return { ok: false, error: 'No API key provided' }

  for (const model of GEMINI_MODELS) {
    try {
      const url = `${GEMINI_BASE}${model}:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Responde solo "ok".' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 10 },
        }),
      })
      if (!res.ok) {
        const errBody = await res.text()
        let msg = `HTTP ${res.status}`
        try { msg = JSON.parse(errBody).error?.message || msg } catch {}
        // If quota issue, try next model
        if (res.status === 429 || res.status === 403) continue
        return { ok: false, error: msg }
      }
      return { ok: true, model }
    } catch (err) {
      // Network error — try next model
      continue
    }
  }
  return { ok: false, error: 'Todos los modelos Gemini fallaron (cuota agotada). Espera unos minutos o revisa tu plan en ai.google.dev' }
}

/**
 * Check availability status of all models + grounding.
 * Returns array of { model, name, available, grounding, error, rpdLimit }
 */
export async function checkModelsStatus(apiKey) {
  if (!apiKey) return []

  const MODEL_INFO = {
    'gemini-3.1-flash-lite-preview': { name: 'Gemini 3.1 Flash Lite', rpdLimit: 500 },
    'gemini-3-flash-preview':        { name: 'Gemini 3 Flash',        rpdLimit: 20 },
    'gemini-2.5-flash-lite':         { name: 'Gemini 2.5 Flash Lite', rpdLimit: 20 },
    'gemini-2.5-flash':              { name: 'Gemini 2.5 Flash',      rpdLimit: 20 },
  }

  const results = await Promise.all(GEMINI_MODELS.map(async (model) => {
    const info = MODEL_INFO[model] || { name: model, rpdLimit: '?' }
    const entry = { model, name: info.name, rpdLimit: info.rpdLimit, available: false, grounding: false, error: null }

    try {
      // Test plain call
      const url = `${GEMINI_BASE}${model}:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Responde "ok"' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 5 },
        }),
      })
      if (res.ok) {
        entry.available = true
      } else {
        const errBody = await res.text()
        entry.error = res.status === 429 ? 'Cuota agotada' : `HTTP ${res.status}`
        try { const e = JSON.parse(errBody).error?.message; if (e) entry.error = e.slice(0, 80) } catch {}
        return entry
      }
    } catch (err) {
      entry.error = err.message
      return entry
    }

    // Test grounding call (only if plain succeeded)
    try {
      const url = `${GEMINI_BASE}${model}:generateContent?key=${apiKey}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Responde "ok"' }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0, maxOutputTokens: 5 },
        }),
      })
      if (res.ok) entry.grounding = true
    } catch {}

    return entry
  }))

  return results
}
