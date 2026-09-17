# SPEC — Módulo de valoración: precio de entrada de una acción de dividendo

**Versión:** 1.1 · Agosto 2026
**Ámbito:** cálculo de los valores de **2 cards nuevas** (Modelo de Gordon y Múltiplos vs. historia) y **1 card de síntesis** (Precio óptimo de entrada). El método de Weiss **ya está implementado** en la app (cards Indicadores, Geraldine Band, Yields y Pago de dividendos): esta spec no lo duplica, sino que define el contrato de datos para reutilizar sus valores (§3).
**Fuente de datos:** Yahoo Finance vía librería `yahoo-finance2` (Node/JS).
**Metodología de referencia:** bandas de yield de Geraldine Weiss (existente), modelo de descuento de dividendos de Gordon y análisis de múltiplos contra la propia historia. Los tres métodos se sintetizan en un único precio óptimo de entrada (criterio: el más exigente de los tres).

---

## 0. Resumen de las cards

| # | Card | Estado | Valor principal | Valores secundarios |
|---|------|--------|-----------------|---------------------|
| — | Indicadores / Geraldine Band / Yields / Pago de dividendos | **Existente** — no se toca | Precio infravalorado y sobrevalorado, yields alto/medio/bajo, señal COMPRA | Esta spec solo consume sus valores (§3) |
| 1 | Modelo de Gordon | **Nueva** | Precio justo (escenario conservador) | Precio justo (escenario optimista), crecimiento implícito descontado por el mercado |
| 2 | Múltiplos vs. historia | **Nueva** | Precio implícito por múltiplos | PER, EV/EBITDA y P/FCF actuales vs. media histórica, % prima/descuento |
| 3 | **Precio óptimo de entrada** | **Nueva** (síntesis) | Precio de entrada (conservador) | Precio de entrada (optimista), método limitante, distancia vs. precio actual, semáforo |

Convención en todo el documento: `P` = precio, `D0` = dividendo anual actual por acción, `D1` = dividendo esperado del próximo año, `r` = rentabilidad exigida, `g` = crecimiento anual del dividendo a perpetuidad.

---

## 1. Datos de entrada (yahoo-finance2)

### 1.1 Snapshot actual — `quoteSummary(symbol, { modules: [...] })`

| Dato | Módulo | Campo | Uso |
|------|--------|-------|-----|
| Precio actual | `price` | `regularMarketPrice` | Todos los cálculos |
| Divisa | `price` | `currency` | Mostrar y validar coherencia |
| Dividendo anual actual (forward) | `summaryDetail` | `dividendRate` | `D0` preferente |
| Dividendo anual trailing | `summaryDetail` | `trailingAnnualDividendRate` | `D0` fallback |
| Yield actual | `summaryDetail` | `dividendYield` | Contraste con el módulo Weiss existente |
| Yield medio 5 años | `summaryDetail` | `fiveYearAvgDividendYield` | Contraste de las bandas |
| Payout ratio | `summaryDetail` | `payoutRatio` | Validaciones (§7) |
| PER trailing | `summaryDetail` | `trailingPE` | Card múltiplos |
| BPA trailing (EPS) | `defaultKeyStatistics` | `trailingEps` | Card múltiplos |
| Acciones en circulación | `defaultKeyStatistics` | `sharesOutstanding` | Card múltiplos (EV/EBITDA, P/FCF) |
| Enterprise Value | `defaultKeyStatistics` | `enterpriseValue` | Card múltiplos |
| EV/EBITDA actual | `defaultKeyStatistics` | `enterpriseToEbitda` | Card múltiplos |
| EBITDA (ttm) | `financialData` | `ebitda` | Card múltiplos |
| Deuda total | `financialData` | `totalDebt` | Card múltiplos (EV → precio) |
| Caja total | `financialData` | `totalCash` | Card múltiplos (EV → precio) |
| Free cash flow (ttm) | `financialData` | `freeCashflow` | Card múltiplos |
| Capitalización | `price` | `marketCap` | Card múltiplos |

```ts
const qs = await yahooFinance.quoteSummary(symbol, {
  modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData'],
});
```

> Nota: los nombres exactos de campo deben validarse contra la versión instalada de `yahoo-finance2` (los tipos TS de la librería son la referencia). Algunos campos llegan `undefined` según el ticker: todo acceso es opcional (§7).

### 1.2 Histórico de precios y dividendos — `chart()`

Se necesitan **10 años** de historia (configurable `HISTORY_YEARS = 10`, mínimo aceptable 5).

```ts
const chart = await yahooFinance.chart(symbol, {
  period1: tenYearsAgo,          // Date o 'YYYY-MM-DD'
  period2: today,
  interval: '1d',                // diario para máx/mín anuales precisos
  events: 'div',                 // incluye events.dividends
});
// chart.quotes: [{ date, open, high, low, close, adjclose }]
// chart.events.dividends: [{ date, amount }]
```

`historical()` está deprecado en la librería; usar siempre `chart()`.

### 1.3 Series derivadas del histórico

Para cada año natural `y` de los últimos `HISTORY_YEARS`:

- `divPaid[y]` = suma de `events.dividends.amount` con fecha dentro de `y` (dividendo ordinario pagado en el año; ver §7.6 sobre especiales).
- `priceMax[y]` = máximo de `quotes.high` del año (fallback: máx de `close`).
- `priceMin[y]` = mínimo de `quotes.low` del año (fallback: mín de `close`).

El año en curso se excluye de las bandas si lleva menos de 9 meses de datos (año incompleto sesga máx/mín y suma de dividendos).

---

## 2. Parámetros de configuración

| Parámetro | Por defecto | Rango | Descripción |
|-----------|------------|-------|-------------|
| `r_conservador` | **0,10** (10%) | 0,06–0,15 | Rentabilidad exigida, escenario conservador |
| `r_optimista` | **0,08** (8%) | 0,05–0,12 | Rentabilidad exigida, escenario optimista |
| `G_CAP_OPT` | 0,06 (6%) | — | Techo de `g` en escenario optimista |
| `G_CAP_CONS` | 0,04 (4%) | — | Techo de `g` en escenario conservador |
| `G_FLOOR` | 0,00 | — | Suelo de `g` (nunca negativo en Gordon) |
| `SPREAD_MIN` | 0,02 (2 p.p.) | — | Mínimo exigido para `r − g` (evita explosión de la fórmula) |
| `HISTORY_YEARS` | 10 | 5–15 | Años de historia para bandas y múltiplos |
| `yield_min_exigido` | opcional (null) | 0–0,08 | Yield inicial mínimo que exige el usuario; añade un tope de precio extra (§6.2) |

Ambos escenarios son editables por el usuario en la app; los valores anteriores son los defaults.

---

## 3. Método Weiss — YA IMPLEMENTADO: contrato de datos

El método de Weiss ya existe en la app (cards Indicadores, Geraldine Band, Yields, Pago de dividendos). **No se implementa ninguna card nueva de Weiss.** Este módulo lo consume como dependencia a través de la siguiente interfaz, que el módulo existente debe exponer (o un adaptador sobre él):

```ts
interface WeissSnapshot {
  precioInfravalorado: number;   // el "Infravalorado" de la card Indicadores (p.ej. €38,98) → P_weiss_compra
  precioSobrevalorado: number;   // el "Sobrevalorado" (p.ej. €201,77)                       → P_weiss_venta
  yieldAlto: number;             // banda alta de la card Yields (p.ej. 0.0363)
  yieldBajo: number;             // banda baja (p.ej. 0.0070)
  yieldActual: number;           // p.ej. 0.0414
  d0: number;                    // dividendo anual actual usado para trazar las bandas
  precioActual: number;          // cotización usada por la card (misma fecha de datos)
  aniosUsados: number;
  zona: 'COMPRA' | 'INTERMEDIA' | 'VENTA';   // la señal ya calculada (COMPRA en la card Indicadores)
}
```

Reglas de consumo:

- `P_weiss_compra = weiss.precioInfravalorado` y `P_weiss_venta = weiss.precioSobrevalorado`. La síntesis (§6) usa estos valores tal cual: **una sola fuente de verdad**; este módulo nunca recalcula las bandas por su cuenta, para que la card de síntesis no contradiga a la Geraldine Band que el usuario ya ve.
- `D0` para Gordon (§4) es el mismo `weiss.d0` de las bandas. Solo si el módulo existente no lo expone, fallback: `summaryDetail.dividendRate` → `trailingAnnualDividendRate` → suma de dividendos del último año completo.
- `precioActual` de todas las cards nuevas = `weiss.precioActual` (misma fecha "Cotización · dd mmm"), no una nueva llamada a Yahoo, para que las cuatro cifras de la pantalla sean coherentes entre sí.
- Los datos de §1.2-§1.3 (chart, series anuales) siguen siendo necesarios para el CAGR del dividendo (§4.1) y los múltiplos históricos (§5.2); si el módulo Weiss ya descarga ese histórico, reutilizar su caché en vez de repetir la llamada.

> Nota metodológica (no bloqueante): las fórmulas canónicas de Weiss (banda alta = media de `divPaid[y]/priceMin[y]`, banda baja = media de `divPaid[y]/priceMax[y]`, precios = `D0/banda`) quedan en el apéndice de tests (T1) solo como validación de coherencia del módulo existente. Si la implementación actual usa otra variante (p.ej. percentiles de la serie diaria de yield), es válida: el contrato es la interfaz de arriba, no la fórmula.

---

## 4. Card nueva 1 — Modelo de Gordon (dos escenarios)

### 4.1 Estimación del crecimiento `g`

Base: CAGR del dividendo de los últimos 5 años completos:

```
CAGR5 = (divPaid[último] / divPaid[último−5])^(1/5) − 1
```

Escenarios (recordar: `g` es a perpetuidad, se recorta siempre):

```
g_opt  = clamp(CAGR5,          G_FLOOR, G_CAP_OPT)    // techo 6%
g_cons = clamp(CAGR5 − 0.01,   G_FLOOR, G_CAP_CONS)   // 1 p.p. menos, techo 4%
```

Restricción dura en ambos escenarios: `g ≤ r − SPREAD_MIN`. Si el clamp la activa, se marca `gRecortado = true` en la salida (la UI lo señala).

### 4.2 Precio justo

```
D1_esc      = D0 × (1 + g_esc)
P_gordon_esc = D1_esc / (r_esc − g_esc)
```

- **Conservador:** `r = r_conservador (10%)`, `g = g_cons` → precio justo exigente.
- **Optimista:** `r = r_optimista (8%)`, `g = g_opt` → precio justo amable.

### 4.3 Fórmula invertida (crecimiento implícito)

Termómetro de cuánta fantasía descuenta el mercado al precio actual, con la `r` conservadora:

```
g_implicito = (r_conservador × P_actual − D0) / (P_actual + D0)
```

(Derivada de `P = D0(1+g)/(r−g)` despejando `g`.) Se muestra como "el mercado descuenta un crecimiento perpetuo del X% con r = 10%".

### 4.4 Salida de la card

```json
{
  "conservador": { "r": 0.10, "g": 0.035, "d1": 5.38, "precioJusto": 82.8, "gRecortado": false },
  "optimista":   { "r": 0.08, "g": 0.05,  "d1": 5.46, "precioJusto": 182.0, "gRecortado": false },
  "gImplicitoPct": 5.6,
  "cagr5Pct": 5.0
}
```

**Regla de presentación:** Gordon se muestra siempre como horquilla (conservador–optimista), nunca como cifra única con decimales de falsa precisión. Un punto de `g` mueve el resultado un 25-35%.

---

## 5. Card nueva 2 — Múltiplos contra la propia historia

### 5.1 Múltiplos actuales

```
PER_actual      = summaryDetail.trailingPE            // o P_actual / trailingEps
EV_EBITDA_actual = defaultKeyStatistics.enterpriseToEbitda   // o enterpriseValue / ebitda
FCF_porAccion   = financialData.freeCashflow / sharesOutstanding
P_FCF_actual    = P_actual / FCF_porAccion
```

### 5.2 Media histórica de cada múltiplo

Limitación de Yahoo: no expone series largas de PER/EV/EBITDA históricos. La app aproxima la historia con lo que sí es computable:

1. **Vía preferente — yield invertido (siempre disponible):** las bandas de Weiss del módulo existente ya son la comparación histórica sistematizada del "múltiplo" más fiable del inversor en dividendos. El precio ancla histórico es `weiss.precioInfravalorado`.
2. **Vía fundamental (si hay datos):** `fundamentalsTimeSeries()` de yahoo-finance2 devuelve varios años de EPS, EBITDA y FCF anuales (habitualmente ~4-5). Con ellos:
   - `PER_hist[y] = precioMedio[y] / EPS[y]`, donde `precioMedio[y] = (priceMax[y] + priceMin[y]) / 2`
   - análogo para EV/EBITDA (EV ≈ capitalización media del año + deuda neta del año) y P/FCF
   - `multiploMedio = media(los años disponibles)`; exigir `≥ 4` años, si no → múltiplo `no disponible`
3. Como contraste adicional siempre disponible: `fiveYearAvgDividendYield` vs. yield actual.

### 5.3 Precio implícito por múltiplos

Para cada múltiplo disponible, precio al que la acción cotizaría a su media histórica con las métricas actuales:

```
P_per   = PER_medio × trailingEps
P_fcf   = P_FCF_medio × FCF_porAccion
P_ev    = (EV_EBITDA_medio × ebitda − deudaNeta) / sharesOutstanding
          // deudaNeta = totalDebt − totalCash
```

```
P_multiplos = mediana(P_per, P_fcf, P_ev)   // con los que existan; si solo hay uno, ese
```

Si ningún múltiplo fundamental es computable, `P_multiplos = null` y el método queda fuera de la síntesis (§6) — la card lo indica ("sin historia suficiente de fundamentales; usando solo Weiss + Gordon").

### 5.4 Salida de la card

```json
{
  "multiplos": [
    { "nombre": "PER",       "actual": 15.5, "mediaHist": 17.0, "primaPct": -8.8, "precioImplicito": 168.3 },
    { "nombre": "P/FCF",     "actual": 16.0, "mediaHist": 18.0, "primaPct": -11.1, "precioImplicito": 178.4 },
    { "nombre": "EV/EBITDA", "actual": 12.0, "mediaHist": 13.0, "primaPct": -7.7, "precioImplicito": 175.1 }
  ],
  "precioImplicitoMultiplos": 175.1,
  "aniosUsados": 5,
  "lectura": "DESCUENTO" | "EN_LINEA" | "PRIMA"   // vs. media: <−5%, ±5%, >+5%
}
```

**Regla de presentación:** un múltiplo nunca se muestra en términos absolutos ("PER 22, caro"); siempre relativo a la propia historia. La comparación sectorial queda fuera del alcance de esta versión.

---

## 6. Card nueva 3 — Precio óptimo de entrada (síntesis)

### 6.1 Criterio: el mínimo de los métodos disponibles

El precio de entrada es el que cumple todas las condiciones a la vez, es decir, el más exigente:

```
P_entrada_conservador = min( P_weiss_compra, P_gordon_conservador, P_multiplos* )
P_entrada_optimista   = min( P_weiss_compra, P_gordon_optimista,  P_multiplos* )
```

`P_weiss_compra` viene del módulo Weiss existente (`weiss.precioInfravalorado`, §3) — nunca se recalcula aquí. `P_multiplos*`: se incluye solo si es computable (§5.3). Weiss es obligatorio: si el módulo existente no puede calcular bandas para el ticker (sin historia de dividendos suficiente), la síntesis devuelve `NO_VALORABLE` (§7.1).

Los dos escenarios difieren solo en la pata de Gordon (r y g); Weiss y múltiplos son comunes.

### 6.2 Tope opcional por yield mínimo exigido

Si el usuario configuró `yield_min_exigido`:

```
P_tope_yield = D0 / yield_min_exigido
P_entrada_esc = min(P_entrada_esc, P_tope_yield)
```

### 6.3 Distancia y semáforo

```
distanciaPct_esc = (P_actual − P_entrada_esc) / P_entrada_esc × 100
```

| Semáforo | Condición (sobre el escenario conservador) |
|----------|--------------------------------------------|
| 🟢 `EN_ZONA` | `P_actual ≤ P_entrada_conservador` |
| 🟡 `CERCA` | `P_actual ≤ P_entrada_optimista` o distancia conservadora ≤ 10% |
| 🔴 `LEJOS` | resto |

Este semáforo es el **global** de la app y puede discrepar de la señal `COMPRA` de la card Indicadores (que solo mira Weiss): p.ej. yield en zona de infravaloración pero Gordon conservador muy por debajo del precio actual → Indicadores dice `COMPRA` y esta card dice `LEJOS`. Esa discrepancia es información, no un bug: la UI la explica mostrando el `metodoLimitante` ("Weiss da compra, pero Gordon conservador exige X €").

### 6.4 Salida de la card

```json
{
  "conservador": { "precioEntrada": 82.8, "distanciaPct": 99.3, "metodoLimitante": "GORDON" },
  "optimista":   { "precioEntrada": 157.6, "distanciaPct": 4.7, "metodoLimitante": "WEISS" },
  "precioActual": 165.0,
  "semaforo": "LEJOS",
  "metodosUsados": ["WEISS", "GORDON", "MULTIPLOS"],
  "avisos": ["gRecortado en escenario optimista"]
}
```

`metodoLimitante` (qué método fijó el mínimo) se muestra en la UI: es información valiosa ("Gordon conservador es quien te frena").

**Aviso obligatorio en UI (siempre visible en esta card):** el precio óptimo es una condición necesaria, no una recomendación de compra; presupone que la empresa pasa el análisis cualitativo. Material educativo, no asesoramiento financiero.

---

## 7. Validaciones y casos límite

| # | Caso | Detección | Comportamiento |
|---|------|-----------|----------------|
| 7.1 | Sin dividendo o historia < 5 años completos con dividendo | `D0` nulo/0 o años válidos < 5 | Módulo devuelve `NO_VALORABLE` con motivo; las cards muestran estado vacío explicativo (metodología solo válida para pagadores consolidados) |
| 7.2 | `r − g < SPREAD_MIN` tras clamps | comprobación en §4.1 | Recortar `g` y marcar `gRecortado`; nunca lanzar error ni devolver precios negativos/infinitos |
| 7.3 | Dividendo recortado en la historia | `divPaid[y] < divPaid[y−1] × 0.95` en algún año | Cards de Gordon y síntesis muestran aviso `DIVIDENDO_RECORTADO_EN_HISTORIA`; `CAGR5` puede salir negativo → `g` cae al suelo 0 |
| 7.4 | Campos de Yahoo ausentes (`trailingEps`, `ebitda`, `freeCashflow`…) | `undefined`/null | Excluir ese múltiplo; degradar según §5.3. Nunca imputar valores |
| 7.5 | EPS o FCF negativos | valor ≤ 0 | PER / P/FCF no computables (excluir), no mostrar múltiplos negativos |
| 7.6 | Dividendos especiales/extraordinarios | `amount > 3 × mediana(últimos 8 pagos)` | Excluir el pago de `divPaid[y]` y de `CAGR5`; registrar aviso |
| 7.7 | Splits | `chart()` devuelve precios ajustados por split; los importes de dividendo de `events.dividends` ya vienen ajustados | Verificar en tests con un ticker con split reciente (p.ej. AAPL 2020) |
| 7.8 | Divisa incoherente (ADR, ticker en otra plaza) | `price.currency` ≠ divisa de dividendos | Mostrar divisa junto a cada precio; no convertir en v1 |
| 7.9 | Año en curso | < 9 meses de datos | Excluir de bandas y CAGR (§1.3) |
| 7.10 | Payout > 90% o `weiss.yieldActual > weiss.yieldAlto × 1.3` | snapshot | Aviso `POSIBLE_TRAMPA_DE_VALOR` en la card de síntesis: yield en máximos puede ser deterioro, exigir checklist cualitativo |
| 7.11 | Caché / rate limits | — | Cachear `quoteSummary` 15 min y `chart` 24 h por ticker; reintento con backoff |

Redondeo de presentación: precios con 2 decimales; yields y porcentajes con 1-2 decimales. Los cálculos internos no se redondean.

---

## 8. Pseudocódigo de referencia (TypeScript)

```ts
interface Escenario { r: number; g: number; d1: number; precioJusto: number; gRecortado: boolean }

function gordon(D0: number, r: number, gBase: number, capG: number, cfg: Config): Escenario {
  let g = Math.min(Math.max(gBase, cfg.G_FLOOR), capG);
  let gRecortado = false;
  if (g > r - cfg.SPREAD_MIN) { g = r - cfg.SPREAD_MIN; gRecortado = true; }
  const d1 = D0 * (1 + g);
  return { r, g, d1, precioJusto: d1 / (r - g), gRecortado };
}

function valorar(sym: string, cfg: Config, weiss: WeissSnapshot): Promise<Valoracion> {
  // 1. weiss viene del módulo EXISTENTE (§3): P_weiss_compra = weiss.precioInfravalorado,
  //    D0 = weiss.d0, P = weiss.precioActual. NO recalcular bandas aquí.
  // 2. fetch quoteSummary; reutilizar el histórico (chart, 10 años, events:'div') ya
  //    cacheado por el módulo Weiss; si no existe, descargarlo
  // 3. series anuales: divPaid, priceMax, priceMin (excluir año en curso incompleto,
  //    filtrar especiales §7.6); validar §7.1 → NO_VALORABLE si procede
  // 4. CAGR5 → cons = gordon(D0, cfg.r_conservador, CAGR5 - 0.01, cfg.G_CAP_CONS, cfg)
  //            opt  = gordon(D0, cfg.r_optimista,  CAGR5,        cfg.G_CAP_OPT,  cfg)
  //    gImplicito = (cfg.r_conservador * P - D0) / (P + D0)
  // 5. múltiplos (§5): precios implícitos disponibles → mediana
  // 6. síntesis: min(weiss.precioInfravalorado, gordon_esc, multiplos) por escenario
  //    + tope yield_min_exigido + semáforo
  // 7. adjuntar avisos acumulados
}
```

---

## 9. Casos de prueba (fixtures del material de referencia)

Los tests unitarios usan datos fijos (no red). Tolerancia: ±0,5% salvo indicación.

**T1 — Coherencia del módulo Weiss existente (ejercicio 1 del capítulo; test opcional, no de este módulo).** Con `D0 = 3,60`, banda alta 4,0%, banda baja 2,5%, la fórmula canónica da `P_compra = 90,00` y `P_venta = 144,00`; con `P_actual = 102` → yield 3,53%, zona `INTERMEDIA`; si `D0` sube a 3,80 → `P_compra = 95,00`. Sirve para contrastar que el `WeissSnapshot` consumido es del orden esperado; si la implementación existente usa otra variante de banda (§3, nota), las cifras pueden diferir y el test se ajusta a esa variante.

**T2 — Gordon y sensibilidad (ejercicio 2).** `D0 = 2,50`, `r = 9%`: con `g = 4%` → `D1 = 2,60`, `P = 52,00`; con `g = 5%` → `D1 = 2,625`, `P = 65,63` (+26%). El test verifica ambos valores y que la salida siempre exponga los dos escenarios.

**T3 — Caso JNJ (agosto 2026, ilustrativo).** `D0 = 5,20`, bandas 3,3% / 2,4% → `P_compra ≈ 157,6`, `P_venta ≈ 216,7`. Gordon `r = 9%`: `g = 4,5%` → `P ≈ 120,7`; `g = 5,5%` → `P ≈ 156,7`. Invertida a `P = 165`, `r = 9%` → `g_implicito ≈ 5,6%`.

**T4 — Síntesis por mínimo.** Con `P_weiss_compra = 158`, `P_gordon_cons = 121`, `P_multiplos = 168` → `P_entrada_conservador = 121`, `metodoLimitante = GORDON`.

**T5 — Tope por yield mínimo (ejercicio 3).** `D0 = 4,00`, `yield_min_exigido = 4%` → tope `100,00`; banda alta 4,2% → Weiss `95,24`; múltiplos `102`. Entrada = `min(95,24; 102; 100) = 95,24` (sin tope de yield la condición operativa del capítulo, 100 €, corresponde al criterio "cumplir las tres condiciones", que con el tope queda en 100 o menos; el criterio min de esta spec es más exigente y elige 95,24 — documentado como decisión de diseño).

**T6 — Degradaciones.** (a) EPS negativo → PER excluido, mediana con los restantes; (b) sin ningún múltiplo → síntesis solo Weiss+Gordon con aviso; (c) `CAGR5 = 8%` → `g_opt = 6%`, `g_cons = 4%` (clamps); (d) `r_optimista = 5%` y `CAGR5 = 6%` → `g_opt = 3%` y `gRecortado = true`; (e) 4 años de dividendos → `NO_VALORABLE`.

**T7 — Splits (integración, con snapshot grabado).** Ticker con split (AAPL): las bandas no deben mostrar discontinuidad artificial en el año del split.

---

## 10. Fuera de alcance (v1)

Comparación de múltiplos contra el sector; conversión de divisas; empresas sin dividendo; sugerencia de strikes de cash-secured puts sobre el precio de entrada (candidata natural a v2, el precio de entrada de la card 4 sería el strike de referencia).
