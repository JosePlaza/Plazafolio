# PRD: Earnings Call Dividend Decoder

**Author:** Jose Plaza
**Status:** Draft
**Fecha:** Abril 2026
**Prioridad:** P0 — Feature 2 del Sprint Gemini Intelligence

---

## Problem Statement

Los earnings calls contienen senales criticas sobre la intencion del management respecto a dividendos — pero estan enterradas en transcripts de 60+ minutos llenos de jerga financiera. Un inversor individual no tiene tiempo de escuchar cada call de cada empresa de su portfolio, y mucho menos de extraer las frases clave sobre politica de dividendos, buybacks vs dividendos, o cambios en la estrategia de retorno al accionista.

**Quien lo experimenta:** Inversores de dividendos con 5+ activos en cartera que no pueden dedicar horas a revisar earnings calls.

**Coste de no resolverlo:** El inversor se pierde senales tempranas de cambio en la politica de dividendos. Se entera por las noticias, cuando el mercado ya ha reaccionado.

---

## Goals

1. **Extraer lo que importa:** De un transcript de 10,000+ palabras, generar un brief de 3-4 parrafos centrado exclusivamente en dividend policy, capital allocation y shareholder returns.
2. **Citar textualmente:** Incluir citas directas del management (CEO/CFO) sobre dividendos para que el usuario pueda evaluar el tono y la intencion.
3. **Cobertura trimestral:** Analizar automaticamente el earnings call mas reciente de cada activo en el portfolio.
4. **Audio opcional:** Permitir escuchar el brief como narration TTS, reutilizando el pipeline de audio existente.

---

## Non-Goals

1. **No transcribimos el audio** — No procesamos el audio del earnings call. Usamos transcripts textuales ya disponibles.
2. **No cubrimos earnings calls historicos en v1** — Solo el mas reciente. Historico es v2.
3. **No analizamos el call completo** — Solo la parte relevante a dividendos/capital allocation. Analisis general del negocio no esta en scope.
4. **No es analisis de sentimiento generico** — Es especificamente sobre la intencion del management respecto a dividendos.
5. **No sustituye la lectura del 10-Q/10-K** — Complementa los informes financieros que ya analizamos.

---

## User Stories

**Como inversor de dividendos**, quiero leer un resumen de 2 minutos de lo que el CEO/CFO dijo sobre el dividendo en el ultimo earnings call, para detectar senales de cambio en la politica sin escuchar 60 minutos de call.

**Como usuario analizando un activo nuevo para la watchlist**, quiero saber que dijo el management sobre dividendos en su ultimo call, para evaluar si la empresa esta comprometida con el retorno al accionista.

**Como usuario movil en movimiento**, quiero escuchar el brief del earnings call como audio mientras conduzco o hago ejercicio, usando el mismo player flotante de la app.

**Como inversor que compara dos activos**, quiero ver side-by-side que dice cada management sobre dividendos, para decidir donde invertir.

---

## Requirements

### Must-Have (P0)

**R1: Fuente de Transcripts**
- Investigar y seleccionar fuente de datos para earnings call transcripts:
  - **Opcion A:** SEC EDGAR 8-K filings (gratuito, text completo pero formato variable)
  - **Opcion B:** API de terceros (Financial Modeling Prep ya tiene endpoint `/earning_call_transcript`)
  - **Opcion C:** Google Search grounding para obtener snippets relevantes (sin transcript completo)
- Acceptance Criteria:
  - [ ] Fuente seleccionada cubre >80% de los tickers en portfolios tipicos (US large/mid cap)
  - [ ] Acceso gratuito o dentro del plan FMP existente
  - [ ] Transcript disponible dentro de 48h del earnings call
  - [ ] Si ninguna fuente es viable, pivotar a Opcion C (search-based analysis)

**R2: Gemini Dividend-Focused Analysis**
- Prompt especializado que extrae de un transcript:
  - **Dividend Policy:** Mencion explicita de dividendo, payout target, politica de crecimiento
  - **Capital Allocation:** Buybacks vs dividendos vs reinversion vs deuda
  - **Forward Guidance:** Cualquier mencion sobre dividendos futuros
  - **Tone Analysis:** Confianza del management (firme, cauteloso, evasivo, entusiasta)
  - **Key Quotes:** 2-3 citas textuales del CFO/CEO sobre dividendos (max 30 palabras cada una)
- Acceptance Criteria:
  - [ ] Output estructurado: `{ summary, dividendPolicy, capitalAllocation, forwardGuidance, tone, keyQuotes: [{speaker, quote, context}] }`
  - [ ] En espanol, tono analista financiero para inversor individual
  - [ ] Max 350 palabras el brief completo
  - [ ] Si el transcript no menciona dividendos, indicar claramente "El management no discutio la politica de dividendos en este call" (esto es una senal por si misma)

**R3: API Endpoint**
- `GET /api/earnings-call/:ticker`
- Headers: `x-gemini-key`
- Response: `{ ticker, callDate, fiscalPeriod, brief, keyQuotes, tone, sources, analyzedAt }`
- Acceptance Criteria:
  - [ ] Cache en Supabase con TTL hasta proximo earnings call (~90 dias)
  - [ ] Error handling: transcript no disponible, Gemini rate limit, ticker no cubierto
  - [ ] Indicar fecha del call y periodo fiscal analizado

**R4: Earnings Call Brief Component**
- `EarningsCallBrief.vue` — Brief expandible con citas destacadas
- Acceptance Criteria:
  - [ ] Header: ticker + fecha del call + periodo fiscal
  - [ ] Brief de 3-4 parrafos legible
  - [ ] Key quotes en blockquote con speaker label (CEO/CFO)
  - [ ] Tone indicator visual (chip o badge: "Confiado", "Cauteloso", etc.)
  - [ ] Boton de generar audio TTS
  - [ ] Glass effect consistente con design system
  - [ ] Responsive mobile

**R5: Integracion en Flujo de Informes**
- Mostrar EarningsCallBrief como seccion dentro de SecReportDetail.vue (para reportes 10-Q/10-K)
- Tambien accesible desde PortfolioDetail.vue como tab o seccion
- Acceptance Criteria:
  - [ ] Aparece debajo de la narrativa del informe SEC si hay un earnings call asociado al periodo
  - [ ] No bloquea la carga de la vista (lazy load)
  - [ ] Skeleton loading mientras se genera

### Nice-to-Have (P1)

**R6: Audio TTS del Brief**
- Reutilizar `generateAudio()` de llm-provider.js para narrar el brief
- Storage path: `reports/{ticker}/earnings_call_{period}.wav`
- Playback via FloatingAudioPlayer existente

**R7: Seccion Dedicada en AnalysisView**
- Tab "Earnings Calls" en la vista de analisis, mostrando briefs de todos los activos del portfolio
- Ordenados por fecha de call mas reciente

### Future Considerations (P2)

**R8: Historico de Calls**
- Mostrar briefs de earnings calls anteriores (ultimos 4 trimestres)
- Detectar cambios en el tono/politica a lo largo del tiempo

**R9: Comparativa Cross-Company**
- Vista que compara lo que dicen diferentes managements sobre dividendos en el mismo trimestre
- Util para decidir entre dos activos del mismo sector

**R10: Alertas de Cambio de Tono**
- Notificar cuando Gemini detecta un cambio significativo en el tono del management vs el call anterior

---

## Success Metrics

### Leading Indicators (1-2 semanas)
- **Cobertura:** >70% de activos del portfolio tienen brief de earnings call generado
- **Engagement:** >50% de usuarios que ven un informe SEC tambien consultan el earnings call brief
- **Audio:** >20% de briefs se escuchan como audio

### Lagging Indicators (1-3 meses)
- **Retention:** Usuarios con Earnings Call feature activa vuelven >3x/semana vs 2x/semana base
- **Cobertura creciente:** A medida que salen nuevos earnings, >90% se capturan automaticamente
- **Satisfaccion:** Feedback cualitativo positivo sobre calidad de los briefs y citas

---

## Arquitectura Tecnica Propuesta

```
[FMP API /earning_call_transcript] o [SEC 8-K]
     ↓ transcript completo
     ↓
[Gemini Flash] (prompt: dividend-focused extraction)
     ↓ brief + key quotes + tone
     ↓
[Supabase: earnings_call_briefs table]
     ↓ cache 90 dias TTL
     ↓
[EarningsCallBrief.vue] → SecReportDetail / PortfolioDetail
     ↓ (opcional)
[Gemini TTS] → Supabase Storage → FloatingAudioPlayer
```

### Nuevos Archivos
- `earnings-calls.js` — Fetch transcript + parse
- `src/components/EarningsCallBrief.vue` — Componente visual
- `src/services/earningsCallApi.js` — Servicio frontend
- `supabase/migrations/earnings-call-briefs.sql` — Tabla nueva

### Archivos a Modificar
- `server.js` — Nuevo endpoint
- `llm-provider.js` — Nuevo prompt template para earnings call analysis
- `src/components/SecReportDetail.vue` — Seccion de earnings call
- `src/views/PortfolioDetail.vue` — Tab o seccion

---

## Open Questions

| # | Pregunta | Owner | Blocking? |
|---|----------|-------|-----------|
| 1 | FMP `/earning_call_transcript` esta incluido en el plan actual o requiere upgrade? | Jose (tech) | Si — validar dia 1 |
| 2 | Si FMP no cubre, 8-K filings de SEC tienen transcripts fiables para large caps? | Jose (tech) | Si — alternativa a validar |
| 3 | Que hacer con empresas que no hacen earnings calls publicos (europeas ESEF)? | Jose (product) | No — scope v1 es US/SEC only |
| 4 | Debemos traducir las citas del management (ingles → espanol) o dejarlas en original? | Jose (UX) | No — decidir durante implementacion |

---

## Timeline

| Semana | Milestone |
|--------|-----------|
| Semana 3, Lun-Mar (Abr 28-29) | Investigar fuente de transcripts + validar acceso |
| Semana 3, Mie-Jue (Abr 30-May 1) | Prompt Gemini + endpoint backend |
| Semana 3, Vie (May 2) | Componente Vue + integracion |
