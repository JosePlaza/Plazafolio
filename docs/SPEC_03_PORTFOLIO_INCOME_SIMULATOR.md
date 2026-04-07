# PRD: Portfolio Income Simulator

**Author:** Jose Plaza
**Status:** Draft
**Fecha:** Abril 2026
**Prioridad:** P0 — Feature 3 del Sprint Gemini Intelligence

---

## Problem Statement

Los inversores de dividendos toman decisiones de inversion sin visibilidad sobre el impacto a largo plazo en su income pasivo. Preguntas como "si invierto 10K mas, cuanto income extra genero al ano?", "es mejor reinvertir dividendos o cobrarlos?", o "que pasa si roto de KHC (alto yield, bajo growth) a NKE (bajo yield, alto growth)?" no tienen respuesta facil sin un modelo de proyeccion.

Las calculadoras de dividendos existentes (Dividend.com, Simply Wall St) son genericas — no consideran el portfolio real del usuario, su scoring de Geraldine Weiss, ni el contexto actual de cada empresa.

**Quien lo experimenta:** Inversores de dividendos con capital disponible que necesitan decidir donde y como asignarlo para maximizar income.

**Coste de no resolverlo:** Decisiones suboptimas de asignacion de capital. Inversores que priorizan yield alto sin considerar sostenibilidad (cae en "yield traps") o que no entienden el poder del dividend growth compuesto.

---

## Goals

1. **Proyeccion realista:** Mostrar income proyectado a 1, 3, 5 y 10 anos basado en tasas historicas de crecimiento del dividendo de cada activo, con escenarios optimista/base/pesimista.
2. **Contexto inteligente:** Gemini proporciona recomendaciones contextuales basadas en el portfolio actual, scoring de Geraldine, y safety radar, no solo numeros mecanicos.
3. **Decision support:** Responder preguntas concretas: "donde pongo 10K?", "DRIP o cobrar?", "diversifico sectores?" con analisis personalizado.
4. **Interactividad:** El usuario puede ajustar parametros (monto, horizonte, estrategia DRIP, reinversion selectiva) y ver resultados en tiempo real.

---

## Non-Goals

1. **No es una herramienta de backtesting** — No simulamos "que hubiera pasado si hubieras comprado X hace 5 anos". Solo proyecciones futuras.
2. **No incluimos impuestos en v1** — La fiscalidad de dividendos varia por pais/jurisdiccion y complica enormemente. v2.
3. **No es un robo-advisor** — No ejecutamos trades. Solo recomendamos y proyectamos.
4. **No modelamos inflacion** — Proyecciones son nominales. Ajuste real es P2.
5. **No cubrimos REITs con distribucion especial** — En v1, todos los activos se tratan con el modelo estandar de dividendo ordinario.

---

## User Stories

**Como inversor con 10K disponibles**, quiero ver cuanto income anual adicional generaria si los invierto en NKE vs KHC vs dividirlos entre ambos, para decidir donde asignar capital.

**Como inversor con DRIP activado**, quiero entender la diferencia a 10 anos entre reinvertir dividendos y cobrarlos, para confirmar que mi estrategia tiene sentido.

**Como usuario con un portfolio concentrado en un sector**, quiero que Gemini me sugiera como diversificar para reducir riesgo sin sacrificar yield, basandose en mi watchlist y los scores de Geraldine.

**Como inversor que busca income recurrente**, quiero ver un calendario de income proyectado mes a mes (basado en frecuencias de pago de cada activo), para planificar mi cash flow.

**Como usuario movil**, quiero poder correr una simulacion rapida "que pasa si invierto X en Y" sin tener que llenar 10 campos.

---

## Requirements

### Must-Have (P0)

**R1: Motor de Proyeccion de Income**
- Calcular income proyectado para cada activo basado en:
  - **Dividend actual por accion** (dato FMP existente)
  - **CAGR historico del dividendo** (ultimos 5-10 anos, dato existente en Geraldine)
  - **Precio actual** (Yahoo Finance, dato existente)
  - **Posicion del usuario** (shares, precio de entrada, dato existente)
  - **Estrategia de reinversion:** DRIP (reinversion automatica) vs Cash (cobrar)
- Escenarios:
  - **Pesimista:** CAGR = 50% del historico (o 0% si historico es bajo)
  - **Base:** CAGR = historico
  - **Optimista:** CAGR = 150% del historico (cap en 15%)
- Output por activo: `{ year1, year3, year5, year10 }` income anual en cada escenario
- Acceptance Criteria:
  - [ ] Calculo correcto con DRIP (compound effect: dividendos reinvertidos compran mas shares que generan mas dividendos)
  - [ ] Calculo correcto sin DRIP (income crece solo por dividend growth, no por mas shares)
  - [ ] Agregacion a nivel portfolio: income total proyectado
  - [ ] Manejo de activos sin historial suficiente (usar CAGR 0% como base)

**R2: Simulador "What If"**
- Inputs del usuario:
  - **Monto a invertir** (EUR/USD, input numerico)
  - **Ticker destino** (selector de activos del portfolio + watchlist)
  - **Horizonte** (selector: 1, 3, 5, 10 anos)
  - **Estrategia** (toggle: DRIP / Cash)
- Output: tabla/grafico mostrando income anual proyectado para los 3 escenarios
- Acceptance Criteria:
  - [ ] Resultados en tiempo real mientras se ajustan inputs (no requiere submit)
  - [ ] Comparar "portfolio actual" vs "portfolio + nueva inversion"
  - [ ] Input monto tiene default inteligente (based on portfolio size)
  - [ ] Mobile-friendly: inputs apilados verticalmente

**R3: Gemini Contextual Recommendations**
- Dado el portfolio actual + monto disponible, Gemini genera recomendaciones de 2-3 parrafos:
  - Donde asignar capital y por que (basandose en Geraldine scores, safety radar, yield vs growth tradeoff)
  - Gaps de diversificacion sectorial/geografica
  - Advertencias (concentracion excesiva, yield traps, payout ratios altos)
- Prompt incluye: portfolio composition, scores Geraldine, safety scores (si disponibles), dividend data
- Acceptance Criteria:
  - [ ] En espanol, tono asesor financiero
  - [ ] Max 300 palabras
  - [ ] Incluye datos concretos del portfolio del usuario (no generico)
  - [ ] Disclaimer: "Esto no es asesoria financiera"
  - [ ] Funciona sin Gemini (modo degradado: solo numeros, sin recomendaciones)

**R4: API Endpoint**
- `POST /api/income-simulator`
- Body: `{ portfolio: [{ticker, shares, price}], additionalInvestment?, targetTicker?, horizon, strategy, geminiKey? }`
- Response: `{ projections: [{ticker, scenarios: {pessimistic, base, optimistic}, byYear: [...]}], totalIncome: {byYear: [...]}, recommendation? }`
- Acceptance Criteria:
  - [ ] Calculo server-side para acceso a datos FMP
  - [ ] Cache de dividend data (ya existe en el sistema)
  - [ ] Gemini recommendation es opcional (solo si geminiKey presente)
  - [ ] Response time <3s para portfolio de 20 activos (sin Gemini)

**R5: Income Simulator View**
- `IncomeSimulator.vue` — Vista completa o seccion en PortfolioView
- Layout:
  - Top: Inputs (monto, ticker, horizonte, estrategia)
  - Middle: Grafico de proyeccion + tabla de resultados
  - Bottom: Recomendaciones Gemini (si disponibles)
- Acceptance Criteria:
  - [ ] Grafico Highcharts con 3 lineas (pesimista/base/optimista) mostrando income anual acumulado
  - [ ] Tabla con desglose por activo
  - [ ] Total income actual del portfolio visible como referencia
  - [ ] Mobile: grafico scrollable, tabla condensada
  - [ ] Glass effect cards consistente con design system

### Nice-to-Have (P1)

**R6: Grafico Highcharts Interactivo**
- Area chart con 3 escenarios y tooltip detallado
- Eje X: anos, Eje Y: income anual (EUR)
- Barras verticales para ver composicion por activo en cada ano
- Selector de escenario para ver uno solo en detalle

**R7: Sugerencias de Diversificacion**
- Gemini analiza la composicion sectorial del portfolio
- Sugiere activos de la watchlist que mejorarian la diversificacion
- Incluye impacto en yield promedio y safety score promedio

**R8: Calendario de Income**
- Vista mes a mes del income esperado basado en las fechas de pago de cada activo
- Barras apiladas mostrando de que empresa viene cada pago
- Util para planificar cash flow personal

### Future Considerations (P2)

**R9: Comparador de Escenarios**
- Side-by-side: "Portfolio actual" vs "Si vendo X y compro Y"
- Drag-and-drop de activos entre escenarios

**R10: Impacto Fiscal**
- Selector de jurisdiccion fiscal (Espana, US, etc.)
- Calculo de income neto despues de retenciones

**R11: Goal-Based Planning**
- "Quiero 1000 EUR/mes de income pasivo. Cuanto necesito invertir y en que?"
- Gemini genera plan de inversion a N anos para alcanzar el objetivo

---

## Success Metrics

### Leading Indicators (1-2 semanas)
- **Adopcion:** >50% de usuarios ejecutan al menos 1 simulacion en la primera semana
- **Engagement:** Promedio de 3+ simulaciones por usuario por sesion
- **Gemini usage:** >30% de simulaciones incluyen recomendaciones Gemini

### Lagging Indicators (1-3 meses)
- **Conversion:** Usuarios que usan el simulador anaden >25% mas activos al portfolio (indicio de que toman decisiones informadas)
- **Retorno:** Usuarios del simulador vuelven 3x/semana vs 2x/semana base
- **Portfolio growth:** Incremento en el numero de shares registradas (el usuario ejecuta las inversiones simuladas)

---

## Arquitectura Tecnica Propuesta

```
[Datos existentes]
  ├── FMP: dividend history, fundamentals
  ├── Yahoo: precios actuales
  ├── Geraldine: CAGR, scores, priceBands
  └── Safety Radar: safety scores (si disponible)
          ↓
[Income Projection Engine] (income-simulator.js)
  ├── DRIP compound calculator
  ├── Scenario builder (pesimista/base/optimista)
  └── Portfolio aggregator
          ↓
[Gemini Flash] (prompt: contextual recommendations)
  ├── Portfolio composition analysis
  ├── Diversification gaps
  └── Actionable recommendations
          ↓
[IncomeSimulator.vue]
  ├── Input controls (monto, ticker, horizonte, estrategia)
  ├── Highcharts projection chart
  ├── Results table by asset
  └── Gemini recommendation card
```

### Nuevos Archivos
- `income-simulator.js` — Motor de proyeccion (DRIP, escenarios, agregacion)
- `src/views/IncomeSimulator.vue` — Vista completa del simulador
- `src/services/incomeSimulatorApi.js` — Servicio frontend
- `src/components/IncomeProjectionChart.vue` — Grafico Highcharts dedicado

### Archivos a Modificar
- `server.js` — Nuevo endpoint
- `llm-provider.js` — Nuevo prompt template para recomendaciones
- `src/App.vue` — Nueva ruta en router
- `src/components/BottomNavbar.vue` — Nuevo item de navegacion (o sub-menu)

---

## Open Questions

| # | Pregunta | Owner | Blocking? |
|---|----------|-------|-----------|
| 1 | El simulador vive como vista propia (nueva ruta) o como seccion dentro de PortfolioView? | Jose (UX) | Si — afecta navegacion |
| 2 | Para DRIP, usamos precio actual o proyectamos precio futuro tambien? (Proyectar precio es mucho mas complejo e incierto) | Jose (product) | Si — v1 usar precio actual constante, iterar despues |
| 3 | Los datos de CAGR de dividendo de Geraldine cubren suficientes anos para proyecciones a 10 anos? | Jose (tech) | No — usar lo disponible, indicar confianza |
| 4 | Debemos limitar las recomendaciones Gemini a activos que el usuario ya tiene en watchlist, o sugerir nuevos? | Jose (product) | No — v1 solo portfolio + watchlist |

---

## Timeline

| Semana | Milestone |
|--------|-----------|
| Semana 4, Lun-Mar (May 5-6) | Motor de proyeccion + escenarios + endpoint |
| Semana 4, Mie-Jue (May 7-8) | Vista Vue + Highcharts + Gemini recommendations |
| Semana 4, Vie (May 9) | Integracion + testing end-to-end + demo |
