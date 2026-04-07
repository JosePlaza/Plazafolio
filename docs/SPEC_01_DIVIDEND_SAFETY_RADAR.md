# PRD: Dividend Safety Radar

**Author:** Jose Plaza
**Status:** Draft
**Fecha:** Abril 2026
**Prioridad:** P0 — Feature 1 del Sprint Gemini Intelligence

---

## Problem Statement

Los inversores de dividendos viven con el miedo constante al *dividend cut* — una reduccion o eliminacion del dividendo que puede causar caidas del 15-30% en el precio. Actualmente, Plazafolio muestra metricas historicas (payout ratio, dividend streak, yield) pero no ofrece una evaluacion proactiva de *riesgo futuro* del dividendo. El usuario tiene que interpretar manualmente multiples senales financieras y buscar noticias relevantes para evaluar si su dividendo esta en peligro.

**Quien lo experimenta:** Todo usuario de Plazafolio con activos en cartera o watchlist que pagan dividendos.

**Coste de no resolverlo:** El usuario se entera del riesgo cuando ya es tarde (post earnings miss, post cut announcement). Pierde dinero y pierde confianza en la herramienta.

---

## Goals

1. **Deteccion temprana:** Identificar senales de riesgo de dividend cut 1-2 trimestres antes de que ocurra, con >70% precision en backtesting historico.
2. **Contexto accionable:** No solo un numero — explicar *por que* el dividendo esta en riesgo y que vigilar, en un lenguaje que un inversor individual entienda.
3. **Cobertura automatica:** Generar safety scores para todos los activos del portfolio sin intervencion manual del usuario.
4. **Integracion natural:** El safety score debe sentirse como una extension del sistema Geraldine Weiss existente, no como una feature aislada.

---

## Non-Goals

1. **No es un predictor binario** — No decimos "va a cortar" o "no va a cortar". Es un score de riesgo relativo (1-10). Intentar prediccion binaria seria irresponsable.
2. **No reemplaza el Buy Score de Geraldine** — El safety score complementa al buy score. Geraldine dice "cuando comprar", Safety Radar dice "cuando preocuparse".
3. **No cubre acciones sin historial de dividendos** — Solo aplica a empresas que actualmente pagan dividendo. Growth stocks sin dividendo no tienen safety score.
4. **No genera alertas push en v1** — Primera version es consulta bajo demanda y visualizacion en portfolio. Alertas push quedan para v2.
5. **No es asesoria financiera** — Disclaimer claro. El score es informativo, no una recomendacion de compra/venta.

---

## User Stories

**Como inversor de dividendos con un portfolio activo**, quiero ver de un vistazo cuales de mis activos tienen el dividendo mas en riesgo, para poder investigar y tomar decisiones antes de que sea tarde.

**Como usuario que analiza un activo individual**, quiero entender por que su safety score es alto o bajo, con explicaciones concretas basadas en datos financieros y noticias recientes, para no depender solo de mi propio analisis.

**Como usuario de la watchlist**, quiero que los activos que estoy vigilando tambien tengan safety score, para incorporar el riesgo del dividendo en mi decision de compra.

**Como usuario movil**, quiero ver el safety score como un indicador visual rapido (color + numero) sin tener que abrir un informe detallado.

---

## Requirements

### Must-Have (P0)

**R1: Safety Score Engine**
- Calcular un score de 1-10 basado en metricas cuantitativas:
  - **Payout Ratio** (peso: 25%) — >80% es peligroso, >100% es critico
  - **FCF Coverage** (peso: 25%) — FCF / Dividendos totales. <1.0x es critico
  - **Debt/EBITDA trend** (peso: 15%) — Aumento sostenido de deuda relativa
  - **Dividend Growth Consistency** (peso: 15%) — Irregularidad en crecimiento
  - **EPS Trend** (peso: 10%) — Caida de beneficios 2+ trimestres
  - **Revenue Trend** (peso: 10%) — Caida de ingresos como leading indicator
- Acceptance Criteria:
  - [ ] Score 1-3: "Riesgo Alto" (rojo)
  - [ ] Score 4-6: "Riesgo Moderado" (amarillo)
  - [ ] Score 7-10: "Dividendo Seguro" (verde)
  - [ ] Score calculable con datos FMP existentes (sin APIs adicionales)
  - [ ] Manejo graceful cuando faltan metricas (usar las disponibles, ajustar pesos)

**R2: Gemini Analysis Layer**
- Enviar score + metricas a Gemini para generar una explicacion contextual de 2-3 parrafos en espanol.
- Incluir Google Search grounding para detectar noticias de riesgo (demandas, guidance negativo, cambios regulatorios).
- Acceptance Criteria:
  - [ ] Gemini recibe: score numerico, desglose por factor, metricas raw, ticker, periodo
  - [ ] Respuesta incluye: resumen ejecutivo, factores de riesgo principales, que vigilar
  - [ ] Sources de Google Search incluidas si estan disponibles
  - [ ] Fallback sin grounding si se agotan los 15 RPD

**R3: API Endpoint**
- `GET /api/dividend-safety/:ticker`
- Headers: `x-gemini-key` (para analysis layer)
- Response: `{ score, factors: [{name, value, weight, signal}], analysis, sources, updatedAt }`
- Acceptance Criteria:
  - [ ] Retorna score mecanico aunque falle Gemini (degradacion graceful)
  - [ ] Rate limiting: max 1 request por ticker cada 4 horas
  - [ ] Cache en Supabase table `dividend_safety`

**R4: Safety Card Component**
- `DividendSafetyCard.vue` — compacto, muestra score circular + texto corto
- Version expandida: desglose de factores + analisis completo de Gemini
- Acceptance Criteria:
  - [ ] Score circular con color gradient (rojo-amarillo-verde)
  - [ ] Texto de una linea: "Dividendo Seguro — FCF cubre 2.3x"
  - [ ] Click expande a vista detallada con factores y analisis
  - [ ] Responsive: funciona en mobile y desktop
  - [ ] Glass effect consistente con el design system actual

**R5: Integracion en Vistas Existentes**
- Mostrar DividendSafetyCard en:
  - `PortfolioDetail.vue` — junto al Buy Score de Geraldine
  - `AnalysisView.vue` — en la lista de informes SEC/ESEF
  - `RankingView.vue` — como columna adicional en el ranking
- Acceptance Criteria:
  - [ ] Visible en las 3 vistas sin romper layouts existentes
  - [ ] No bloquea el render de la vista si el score no esta listo (lazy load)
  - [ ] Loading skeleton mientras se calcula

### Nice-to-Have (P1)

**R6: Supabase Cache con TTL**
- Nueva tabla `dividend_safety` con TTL de 24h
- Schema: `ticker, score, factors (JSONB), analysis (TEXT), sources (JSONB), computed_at, expires_at`
- Auto-refresh en background cuando expira

**R7: Batch Score para Portfolio**
- Endpoint `POST /api/dividend-safety/batch` que calcula scores para todos los activos del portfolio en una sola llamada
- Cola interna con backoff para respetar rate limits de Gemini
- Progreso visible en frontend

**R8: Audio TTS del Safety Analysis**
- Reutilizar pipeline `generateAudio()` existente para generar audio del analisis de seguridad
- Mismo flujo que narrativas de informes SEC

### Future Considerations (P2)

**R9: Safety Score Historico**
- Guardar historico de scores por ticker para detectar tendencias (mejorando/empeorando)
- Grafico sparkline en la card

**R10: Alertas Proactivas**
- Notificacion cuando un safety score baja >2 puntos respecto al ultimo calculo
- Integracion con sistema de notificaciones (por definir)

---

## Success Metrics

### Leading Indicators (1-2 semanas post-launch)
- **Adopcion:** >60% de activos del portfolio tienen safety score generado en la primera semana
- **Engagement:** Usuario promedio consulta safety details de al menos 3 activos
- **Generacion de analisis:** >40% de scores tienen analisis Gemini (no solo score mecanico)

### Lagging Indicators (1-3 meses)
- **Retorno:** Usuarios que consultan safety score vuelven a la app 2x mas frecuentemente
- **Precision percibida:** En casos de dividend cuts reales, el score habia marcado <5 previamente en >60% de los casos
- **Uso de Gemini API:** Consumo de tokens se mantiene dentro del free tier con cache de 24h

---

## Arquitectura Tecnica Propuesta

```
[FMP API] → fundamentals, dividends, cashflow
     ↓
[Safety Score Engine] (server.js)
     ↓ score mecanico (1-10) + factores
     ↓
[Gemini Flash + Search Grounding] (llm-provider.js)
     ↓ analisis contextual + sources
     ↓
[Supabase: dividend_safety table]
     ↓ cache 24h TTL
     ↓
[DividendSafetyCard.vue] → PortfolioDetail / AnalysisView / RankingView
```

### Nuevos Archivos
- `dividend-safety.js` — Motor de scoring + logica de factores
- `src/components/DividendSafetyCard.vue` — Componente visual
- `src/services/dividendSafetyApi.js` — Servicio frontend
- `supabase/migrations/dividend-safety.sql` — Tabla nueva

### Archivos a Modificar
- `server.js` — Nuevos endpoints
- `llm-provider.js` — Nuevo prompt template para safety analysis
- `src/views/PortfolioDetail.vue` — Integrar card
- `src/components/AnalysisView.vue` — Integrar card
- `src/components/RankingView.vue` — Columna adicional

---

## Open Questions

| # | Pregunta | Owner | Blocking? | Resolucion |
|---|----------|-------|-----------|------------|
| 1 | Debemos incluir el safety score en el calculo del Buy Score de Geraldine como factor negativo? | Jose (product) | No | **No, de momento.** El safety score complementa pero no modifica el Buy Score. Se revisara post-launch. |
| 2 | Que hacer con REITs que tienen payout ratios >90% por naturaleza? Necesitan umbrales diferentes? | Jose (domain) | Si | **Si, umbrales REIT diferenciados.** Los REITs estan obligados legalmente a distribuir >90% de beneficios. Se usa AFFO Payout Ratio como metrica: <70% = seguro, 70-85% = saludable, 85-90% = limite, >90% = riesgo. Para non-REITs: <50% seguro, 50-70% saludable, 70-85% limite, >85% riesgo. Deteccion automatica via SIC code o sector "REIT" de FMP profile. |
| 3 | Limite de Gemini free tier: 15 RPD con grounding. Es suficiente para un portfolio de 20+ activos? | Jose (tech) | Si | **Si, con cache agresivo.** Score mecanico se calcula SIN Gemini (sin quota). Analisis Gemini con grounding se cachea 24h en Supabase. Para 20 activos = 20 RPD maximo al dia (solo si todos expiran a la vez). Batch request serializa con delay. Modo degradado: score numerico sin analisis si Gemini no disponible. |
| 4 | Incluir datos de insider selling como factor adicional de riesgo? | Jose (product) | No | **Explorar en v2.** Requiere API adicional (no disponible en FMP free). |

---

## Timeline

| Semana | Milestone |
|--------|-----------|
| Semana 1 (Abr 14-18) | Score engine + endpoint + Gemini prompt |
| Semana 2 (Abr 21-25) | Componente Vue + integracion + cache Supabase |
| Semana 2 viernes | Demo funcional de Safety Radar end-to-end |
