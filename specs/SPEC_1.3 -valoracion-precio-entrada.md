# SPEC — Módulo de valoración: precio de entrada de una acción de dividendo

**Versión:** 1.4 · Agosto 2026
**Cambios v1.4:** (1) toda la valoración se condensa en **una sola card** con una barra de rango de precios tipo bullet en lugar del gráfico de cotización histórica (§6.5) — desaparecen las cards separadas de Gordon, múltiplos y el chart "Cotización y puntos de entrada"; Gordon y múltiplos pasan a filas compactas dentro de la card única. (2) Nuevos defaults de Gordon: `r_exigente = 8%` y `r_flexible = 5%` (antes 10%/8%). (3) Nueva card **"Modelo de Gordon" en la vista de configuración** para editar ambas rentabilidades exigidas (§2.1).
**Cambios v1.3:** detector de **régimen de yield obsoleto** (§3.1). Cuando el yield no toca la banda alta clásica desde hace ≥5 años, la banda está anclada a un régimen antiguo (años lejanos con yields estructuralmente más altos dominan la media) y la zona de compra se vuelve inalcanzable salvo crash; en ese caso la síntesis usa como fallback una banda por percentil del yield diario de 10 años, y lo señala. Caso motivador: MCD con drawdown del −20% (de los mayores de su década fuera de 2020) seguía a +26,5% de la entrada.
**Cambios v1.2:** Gordon sale del `min()` de la síntesis y pasa a ser check de coherencia (§4.4, §6.1) — con el criterio anterior, Gordon conservador era siempre el limitante en empresas de calidad con yield bajo y producía entradas inservibles (p.ej. JNJ: entrada 92,91 € cotizando a 268 €, −66%). Los escenarios de entrada ahora se construyen sobre múltiplos (percentil bajo vs. media). Nota UI: en Gordon, "conservador" (r 10%) siempre da un precio MÁS BAJO que "optimista" (r 8%) — exigir más rentabilidad implica pagar menos; es correcto, no un bug. Para evitar la confusión, en la UI los escenarios se etiquetan **"Exigente (r 10%)"** y **"Flexible (r 8%)"**.
**Ámbito:** cálculo de los valores de **2 cards nuevas** (Modelo de Gordon y Múltiplos vs. historia) y **1 card de síntesis** (Precio óptimo de entrada). El método de Weiss **ya está implementado** en la app (cards Indicadores, Geraldine Band, Yields y Pago de dividendos): esta spec no lo duplica, sino que define el contrato de datos para reutilizar sus valores (§3).
**Fuente de datos:** Yahoo Finance vía librería `yahoo-finance2` (Node/JS).
**Metodología de referencia:** bandas de yield de Geraldine Weiss (existente) y múltiplos contra la propia historia fijan el precio de entrada (criterio: el más exigente de los dos, más el tope opcional de yield mínimo). El modelo de Gordon actúa como **herramienta de coherencia, no como oráculo** (rol que le asigna el propio capítulo): horquilla de precio justo, crecimiento implícito y veredicto sobre el precio de entrada propuesto.

---

## 0. Resumen de las cards

| # | Card | Estado | Valor principal | Valores secundarios |
|---|------|--------|-----------------|---------------------|
| — | Indicadores / Geraldine Band / Yields / Pago de dividendos | **Existente** — no se toca | Precio infravalorado y sobrevalorado, yields alto/medio/bajo, señal COMPRA | Esta spec solo consume sus valores (§3) |
| 1 | **Precio óptimo de entrada** (card única) | **Nueva** | Precio de entrada conservador y optimista + barra de rango tipo bullet (§6.5) | Semáforo, método limitante, fila compacta de múltiplos (PER, EV/EBITDA, P/FCF vs. historia), fila compacta de Gordon (horquilla + coherencia), avisos |
| 2 | Modelo de Gordon (en la **vista de configuración**) | **Nueva** | Edición de `r_exigente` y `r_flexible` con preview | §2.1 |

Las cards separadas de Gordon, múltiplos y el gráfico de cotización histórica de versiones anteriores quedan **eliminadas**: los §4 y §5 siguen definiendo sus cálculos, pero su salida se renderiza como filas dentro de la card única (§6.4-§6.6).

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
| `r_exigente` | **0,08** (8%) | 0,05–0,15 | Rentabilidad exigida, escenario exigente (editable en §2.1) |
| `r_flexible` | **0,05** (5%) | 0,03–0,12 | Rentabilidad exigida, escenario flexible (editable en §2.1). Nota: con 5% y `SPREAD_MIN` = 2 p.p., `g` queda limitado al 3% en este escenario — `gRecortado = true` siempre que el CAGR supere el 3% |
| `G_CAP_OPT` | 0,06 (6%) | — | Techo de `g` en escenario optimista |
| `G_CAP_CONS` | 0,04 (4%) | — | Techo de `g` en escenario conservador |
| `G_FLOOR` | 0,00 | — | Suelo de `g` (nunca negativo en Gordon) |
| `SPREAD_MIN` | 0,02 (2 p.p.) | — | Mínimo exigido para `r − g` (evita explosión de la fórmula) |
| `HISTORY_YEARS` | 10 | 5–15 | Años de historia para bandas y múltiplos |
| `MULT_PCTL_CONS` | 25 | 10–50 | Percentil histórico del múltiplo usado en el escenario conservador de entrada (§5.3); 50 = mediana |
| `REGIME_LOOKBACK_YEARS` | 5 | 3–8 | Años sin tocar la banda alta a partir de los cuales se declara régimen obsoleto (§3.1) |
| `YIELD_PCTL_ALTO` | 90 | 75–95 | Percentil del yield diario (10 años) usado como banda alta de fallback cuando el régimen es obsoleto |
| `yield_min_exigido` | opcional (null) | 0–0,08 | Yield inicial mínimo que exige el usuario; añade un tope de precio extra (§6.2) |

Todos los parámetros son editables por el usuario en la app; los valores anteriores son los defaults. `r_exigente`/`r_flexible` solo afectan al bloque de Gordon (horquilla y coherencia), no al precio de entrada (§6).

### 2.1 Card "Modelo de Gordon" en la vista de configuración (v1.4)

Nueva card dentro de la vista de configuración de la app para editar las rentabilidades exigidas:

| Campo | Control | Default | Validación |
|-------|---------|---------|------------|
| Rentabilidad exigida — Exigente (`r_exigente`) | slider o input numérico, en % con 1 decimal, paso 0,5 | **8,0%** | rango 5–15%; debe cumplir `r_exigente ≥ r_flexible + 0,01` (mín. 1 p.p. de separación) |
| Rentabilidad exigida — Flexible (`r_flexible`) | slider o input numérico, en % con 1 decimal, paso 0,5 | **5,0%** | rango 3–12%; `r_flexible < r_exigente` |

Comportamiento:

- **Preview en vivo:** bajo los controles, la card muestra la horquilla de Gordon resultante para el ticker activo (o para un ejemplo con `D0 = 2,00 €` y `g = CAGR` si no hay ticker), recalculada al mover el control, con el `g` efectivo de cada escenario tras clamps (p.ej. con `D0 = 2,00` y CAGR 5%: "Exigente r 8%: g 4,0% → 52,00 €" · "Flexible r 5%: g 3,0% → 103,00 €"). Así el usuario ve la sensibilidad antes de guardar.
- **Aviso de recorte:** si el valor elegido fuerza `g = r − SPREAD_MIN` (p.ej. r_flexible 5% con CAGR > 3%), la card lo indica en línea: "con r 5%, el crecimiento usado se limita al 3%".
- **Botón "Restaurar por defecto"** (8% / 5%).
- **Persistencia:** ajuste global del usuario (localStorage o perfil), aplicado a todos los tickers; al guardar se invalida la caché de valoración para recalcular las cards. No hay override por ticker en v1.
- Los cambios NO alteran el precio de entrada (§6.1) — la card lo recuerda con una nota: "estas rentabilidades afectan a la horquilla de Gordon y al check de coherencia, no al precio de entrada".

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

### 3.1 Detector de régimen de yield obsoleto (v1.3)

**Problema.** La banda alta es un promedio de 10 años: si los años lejanos tuvieron yields estructuralmente más altos que los recientes (rerating de la acción, crecimiento del precio por encima del dividendo), la media queda anclada a un régimen que ya no existe y la zona de compra se vuelve inalcanzable salvo crash — la señal deja de discriminar: TODO parece "lejos". Es el caso MCD: drawdown del −20% (de los mayores de su década fuera de 2020) y aun así +26,5% sobre la entrada.

**Detección.** Con la serie diaria de yield de 10 años (computable del `chart()` de §1.2: `yieldDiario[t] = divTTM(t) / close(t)`, donde `divTTM(t)` = dividendos de los 365 días previos a `t`):

```
ultimoToque   = max fecha t con yieldDiario[t] ≥ weiss.yieldAlto      // null si nunca
regimenObsoleto = (ultimoToque == null) || (hoy − ultimoToque ≥ REGIME_LOOKBACK_YEARS)
```

**Fallback.** Si `regimenObsoleto`:

```
yieldAltoEfectivo   = percentil(yieldDiario[últimos 10 años], YIELD_PCTL_ALTO)   // p90 por defecto
P_weiss_compra_efectivo = D0 / yieldAltoEfectivo
```

El p90 del yield diario es, por construcción, un nivel que la acción SÍ visita (~10% de las sesiones de la década), así que la zona de compra vuelve a ser alcanzable sin dejar de ser exigente. Si no es obsoleto, `P_weiss_compra_efectivo = weiss.precioInfravalorado` sin cambios.

Reglas:

- La síntesis (§6) usa siempre `P_weiss_compra_efectivo`. Las cards Weiss existentes (Indicadores, Geraldine Band, Yields) **no cambian**: siguen mostrando la banda clásica.
- Cuando el fallback está activo, la card de síntesis muestra el aviso: *"Banda de Weiss anclada a un régimen antiguo (último toque de la banda alta: mm/aaaa o 'nunca en 10 años'); entrada calculada con el percentil 90 del yield de la década"*, y `metodoLimitante` reporta `WEISS_P90` en lugar de `WEISS`.
- Sanidad: exigir `yieldAltoEfectivo > weiss.yieldBajo` y `P_weiss_compra_efectivo < weiss.precioSobrevalorado`; si no se cumple (historia degenerada), no aplicar fallback y mantener la banda clásica con aviso `HISTORIA_DEGENERADA`.
- El detector corrige bandas inalcanzables por rerating; **no** convierte en compra un deterioro real: el aviso `POSIBLE_TRAMPA_DE_VALOR` (§7.10) y el veredicto de Gordon (§4.4) siguen aplicando sobre la entrada efectiva.

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

- **Exigente:** `r = r_exigente (8%)`, `g = g_cons` → precio justo exigente (el más bajo).
- **Flexible:** `r = r_flexible (5%)`, `g = g_opt` (recortado a `r − SPREAD_MIN` = 3% cuando el CAGR lo supera) → precio justo amable.

### 4.3 Fórmula invertida (crecimiento implícito)

Termómetro de cuánta fantasía descuenta el mercado al precio actual, con la `r` conservadora:

```
g_implicito = (r_exigente × P_actual − D0) / (P_actual + D0)
```

(Derivada de `P = D0(1+g)/(r−g)` despejando `g`.) Se muestra como "el mercado descuenta un crecimiento perpetuo del X% con r = 10%".

### 4.4 Veredicto de coherencia sobre el precio de entrada

Gordon **no fija el precio de entrada** (§6); su papel es juzgar si la entrada propuesta por Weiss + múltiplos exige supuestos heroicos. Con `P_entrada_optimista` de §6:

```
g_entrada = (r_exigente × P_entrada_optimista − D0) / (P_entrada_optimista + D0)
// crecimiento perpetuo que habría que creerse para justificar la entrada con r conservador
```

| Veredicto | Condición | Lectura en UI |
|-----------|-----------|----------------|
| `COHERENTE` | `P_entrada_optimista ≤ P_gordon_optimista` | "La entrada no exige supuestos por encima del escenario flexible" |
| `AJUSTADO` | `P_gordon_optimista < P_entrada_optimista ≤ P_gordon_optimista × 1.15` | "La entrada roza el límite de lo justificable por dividendos" |
| `EXIGE_FANTASIA` | resto | "Ni el escenario flexible de Gordon justifica esa entrada: Weiss/múltiplos pueden estar reflejando euforia histórica" — aviso replicado en la card de síntesis |

### 4.5 Salida del bloque Gordon (fila compacta en la card única, §6.6)

```json
{
  "exigente": { "r": 0.08, "g": 0.04, "d1": 5.57, "precioJusto": 139.4, "gRecortado": false },
  "flexible": { "r": 0.05, "g": 0.03, "d1": 5.52, "precioJusto": 276.0, "gRecortado": true },
  "gImplicitoPct": 5.9,
  "gEntradaPct": 4.5,
  "cagr5Pct": 5.2,
  "coherencia": "COHERENTE" | "AJUSTADO" | "EXIGE_FANTASIA"
}
```

(Ejemplo con `D0 = 5,36` y CAGR 5,2%: exigente 5,36×1,04/0,04 = 139,36; flexible con g recortado al 3%: 5,36×1,03/0,02 = 276,04.)

**Reglas de presentación:** (1) Gordon se muestra siempre como horquilla (exigente–flexible), nunca como cifra única con decimales de falsa precisión — un punto de `g` mueve el resultado un 25-35%. (2) Las etiquetas de UI son **"Exigente"** y **"Flexible"** con la `r` vigente entre paréntesis (defaults: 8% y 5%), no "conservador/optimista": exigir más rentabilidad da un precio más bajo por construcción, y el par conservador/optimista lleva a leerlo como error. (3) Junto a la horquilla, siempre el crecimiento implícito: es el termómetro de cuánta fantasía hay en el precio actual.

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

Para cada múltiplo disponible se calculan **dos agregados históricos**, uno por escenario de entrada (§6):

```
multiploMedia_m = media(multiploHist_m[])                       // escenario optimista
multiploP25_m   = percentil(multiploHist_m[], MULT_PCTL_CONS)   // escenario conservador (percentil interpolado)
```

y el precio al que cotizaría la acción a ese múltiplo con las métricas actuales:

```
P_per_esc   = PER_esc × trailingEps
P_fcf_esc   = P_FCF_esc × FCF_porAccion
P_ev_esc    = (EV_EBITDA_esc × ebitda − deudaNeta) / sharesOutstanding
              // deudaNeta = totalDebt − totalCash
```

```
P_multiplos_media = mediana(P_per_media, P_fcf_media, P_ev_media)   // con los que existan; si solo hay uno, ese
P_multiplos_p25   = mediana(P_per_p25,   P_fcf_p25,   P_ev_p25)
```

Con pocos años de historia (4-5), el percentil 25 interpolado queda cerca del segundo valor más bajo: es deliberadamente exigente sin ser el mínimo absoluto.

Si ningún múltiplo fundamental es computable, `P_multiplos_* = null` y el método queda fuera de la síntesis (§6) — la card lo indica ("sin historia suficiente de fundamentales; entrada basada solo en Weiss") y los dos escenarios de entrada colapsan en uno.

### 5.4 Salida del bloque múltiplos (fila compacta en la card única, §6.6)

```json
{
  "multiplos": [
    { "nombre": "PER",       "actual": 15.5, "mediaHist": 17.0, "primaPct": -8.8, "precioImplicito": 168.3 },
    { "nombre": "P/FCF",     "actual": 16.0, "mediaHist": 18.0, "primaPct": -11.1, "precioImplicito": 178.4 },
    { "nombre": "EV/EBITDA", "actual": 12.0, "mediaHist": 13.0, "primaPct": -7.7, "precioImplicito": 175.1 }
  ],
  "precioImplicitoMedia": 175.1,
  "precioImplicitoP25": 158.9,
  "aniosUsados": 5,
  "lectura": "DESCUENTO" | "EN_LINEA" | "PRIMA"   // vs. media: <−5%, ±5%, >+5%
}
```

**Regla de presentación:** un múltiplo nunca se muestra en términos absolutos ("PER 22, caro"); siempre relativo a la propia historia. La comparación sectorial queda fuera del alcance de esta versión.

---

## 6. Card única — Precio óptimo de entrada (síntesis + Gordon + múltiplos)

### 6.1 Criterio: mínimo de Weiss y múltiplos; Gordon como veredicto

El precio de entrada es el que cumple a la vez las condiciones de los métodos **de mercado** (Weiss y múltiplos):

```
P_entrada_conservador = min( P_weiss_compra_efectivo, P_multiplos_p25* )
P_entrada_optimista   = min( P_weiss_compra_efectivo, P_multiplos_media* )
```

`P_weiss_compra_efectivo` = banda clásica del módulo existente, o el fallback por percentil si el régimen de yield es obsoleto (§3.1).

**Gordon queda deliberadamente fuera del mínimo.** Motivo (v1.2): con r = 10% y g ≤ 4%, Gordon conservador es siempre el limitante en empresas de calidad con yield bajo y produce entradas a −50/−70% de la cotización que anulan la utilidad de la card (caso real: JNJ a 268 € con entrada 92,91 €). El capítulo asigna a Gordon el papel de coherencia, no de fijador de precio; aquí entra como `coherencia` (§4.4): si el veredicto es `EXIGE_FANTASIA`, la card de síntesis muestra el aviso de forma prominente, pero el precio no cambia.

`P_weiss_compra` viene del módulo Weiss existente (`weiss.precioInfravalorado`, §3) — nunca se recalcula aquí. `P_multiplos_*`: solo si es computable (§5.3); si no lo es, ambos escenarios = `P_weiss_compra` (colapsan en uno, con aviso). Weiss es obligatorio: si el módulo existente no puede calcular bandas para el ticker (sin historia de dividendos suficiente), la síntesis devuelve `NO_VALORABLE` (§7.1).

Los dos escenarios difieren solo en la pata de múltiplos (percentil 25 vs. media histórica); Weiss es común. Por construcción `P_entrada_conservador ≤ P_entrada_optimista`, y la diferencia entre ambos es acotada (misma historia de múltiplos), a diferencia de la horquilla de Gordon.

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
  "conservador": { "precioEntrada": 158.9, "distanciaPct": 68.7, "metodoLimitante": "MULTIPLOS_P25" },
  "optimista":   { "precioEntrada": 161.2, "distanciaPct": 66.3, "metodoLimitante": "WEISS" },
  "precioActual": 268.0,
  "semaforo": "LEJOS",
  "metodosUsados": ["WEISS", "MULTIPLOS"],
  "gordonCoherencia": { "veredicto": "COHERENTE", "gEntradaPct": 4.5, "horquilla": [139.4, 276.0] },
  "regimenYield": { "obsoleto": false, "ultimoToqueBandaAlta": "2026-03-14" },
  "avisos": []
}
```

`metodoLimitante` ∈ `WEISS | WEISS_P90 | MULTIPLOS_P25 | MULTIPLOS_MEDIA | YIELD_MIN` (qué condición fijó el mínimo; `WEISS_P90` = banda de fallback por régimen obsoleto, §3.1) se muestra en la UI: es información valiosa ("la banda de Weiss es quien te frena"). `gordonCoherencia` se muestra como línea secundaria: veredicto + "a la entrada propuesta, el mercado descontaría un g del X%".

**Aviso obligatorio en UI (siempre visible en esta card):** el precio óptimo es una condición necesaria, no una recomendación de compra; presupone que la empresa pasa el análisis cualitativo. Material educativo, no asesoramiento financiero.

### 6.5 Barra de rango de precios (sustituye al gráfico de cotización histórica)

El gráfico "Cotización y puntos de entrada" con todo el histórico se elimina: la referencia visual pasa a ser una **barra horizontal tipo bullet** dentro de la card, de altura compacta (~48-64 px con etiquetas), sin ejes de tiempo.

**Escala.** Lineal en precio, ascendente de izquierda a derecha:

```
minEscala = min(P_entrada_conservador, P_gordon_exigente) × 0.95
maxEscala = max(P_actual, P_weiss_venta) × 1.05
```

(Nótese que es un bullet "a la inversa" en sentido semántico: la zona buena queda a la IZQUIERDA, porque en un precio de entrada menos es mejor.)

**Zonas de fondo (bandas de color, de izquierda a derecha):**

| Zona | Rango | Color semántico |
|------|-------|------------------|
| Zona de compra | `minEscala → P_entrada_conservador` | verde |
| Zona de entrada flexible | `P_entrada_conservador → P_entrada_optimista` | verde suave / ámbar |
| Zona intermedia | `P_entrada_optimista → P_weiss_venta` | neutro |
| Sobrevaloración | `P_weiss_venta → maxEscala` | rojo suave |

**Marcadores sobre la barra:**

- `P_actual` — marcador principal (aguja/triángulo con etiqueta "Hoy €X"), el único elemento grande.
- `P_entrada_conservador` y `P_entrada_optimista` — ticks etiquetados (los dos números clave de la card).
- Horquilla de Gordon — segmento fino translúcido bajo la barra (de exigente a flexible), sin etiqueta salvo hover: contexto de coherencia, no señal.
- `P_multiplos_p25`–`P_multiplos_media` — segundo segmento fino, ídem.
- Si `yield_min_exigido` está activo, tick adicional `P_tope_yield`.

**Reglas:** tooltips con el valor exacto en hover; colisiones de etiquetas se resuelven alternando arriba/abajo; si `maxEscala/minEscala > 4` (marcadores muy dispersos, p.ej. horquilla de Gordon extrema), los segmentos finos que salgan de escala se recortan al borde con indicador "→"; la barra nunca usa escala logarítmica. Estados: en `NO_VALORABLE` la barra no se renderiza; sin múltiplos, se omite su segmento.

### 6.6 Layout de la card única

Orden vertical dentro de la card (todo lo demás desaparece de la vista principal):

1. **Cabecera:** "Precio óptimo de entrada" + chip de semáforo (`EN_ZONA / CERCA / LEJOS`).
2. **Cifra principal:** `P_entrada_conservador` grande + subtítulo "Cotiza hoy a €X · ±Y% sobre la entrada"; al lado, `P_entrada_optimista` como cifra secundaria. Cada una con su `metodoLimitante` en microcopy ("Limita: banda de Weiss / múltiplos p25...").
3. **Barra de rango** (§6.5).
4. **Fila múltiplos** (compacta, una línea por múltiplo o una línea total colapsable): "Múltiplos: PER 21,5 vs 25,6 · P/FCF 29,9 vs 30,1 · EV/EBITDA 16,2 vs 17,7 → €243,91–€256,95 (con descuento)". El detalle por múltiplo (§5.4) puede vivir en un desplegable/hover.
5. **Fila Gordon** (compacta): "Gordon (check de coherencia): horquilla €139,4–€276,0 · el mercado descuenta g 5,9% · a la entrada propuesta g 4,5% → COHERENTE". Con `EXIGE_FANTASIA`, esta fila se resalta como aviso.
6. **Avisos** (§7: régimen obsoleto, trampa de valor, dividendo recortado, gRecortado...) + disclaimer educativo.

Los payloads de §4.5 y §5.4 no cambian: son las mismas estructuras, consumidas ahora por una sola card.

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
| 7.12 | Régimen de yield obsoleto | banda alta sin tocar ≥ `REGIME_LOOKBACK_YEARS` (§3.1) | Fallback a banda percentil p90 en la síntesis, aviso visible y `metodoLimitante = WEISS_P90`; las cards Weiss existentes no cambian |

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
  // 4. CAGR5 → exigente = gordon(D0, cfg.r_exigente, CAGR5 - 0.01, cfg.G_CAP_CONS, cfg)
  //            flexible = gordon(D0, cfg.r_flexible,  CAGR5,        cfg.G_CAP_OPT,  cfg)
  //    gImplicito = (cfg.r_exigente * P - D0) / (P + D0)
  // 5. múltiplos (§5): por múltiplo, media y percentil MULT_PCTL_CONS →
  //    P_multiplos_media, P_multiplos_p25 (medianas de los disponibles)
  // 5b. régimen (§3.1): yieldDiario 10a → ultimoToque → pWeissEfectivo
  //     (= weiss.precioInfravalorado, o D0/percentil90 si obsoleto)
  // 6. síntesis (§6): cons = min(pWeissEfectivo, P_multiplos_p25)
  //                   opt  = min(pWeissEfectivo, P_multiplos_media)
  //    + tope yield_min_exigido + semáforo. GORDON NO ENTRA EN EL MIN.
  // 7. coherencia Gordon (§4.4): gEntrada + veredicto sobre opt
  // 8. adjuntar avisos acumulados
}
```

---

## 9. Casos de prueba (fixtures del material de referencia)

Los tests unitarios usan datos fijos (no red). Tolerancia: ±0,5% salvo indicación.

**T1 — Coherencia del módulo Weiss existente (ejercicio 1 del capítulo; test opcional, no de este módulo).** Con `D0 = 3,60`, banda alta 4,0%, banda baja 2,5%, la fórmula canónica da `P_compra = 90,00` y `P_venta = 144,00`; con `P_actual = 102` → yield 3,53%, zona `INTERMEDIA`; si `D0` sube a 3,80 → `P_compra = 95,00`. Sirve para contrastar que el `WeissSnapshot` consumido es del orden esperado; si la implementación existente usa otra variante de banda (§3, nota), las cifras pueden diferir y el test se ajusta a esa variante.

**T2 — Gordon y sensibilidad (ejercicio 2).** `D0 = 2,50`, `r = 9%`: con `g = 4%` → `D1 = 2,60`, `P = 52,00`; con `g = 5%` → `D1 = 2,625`, `P = 65,63` (+26%). El test verifica ambos valores y que la salida siempre exponga los dos escenarios.

**T3 — Caso JNJ (agosto 2026, ilustrativo).** `D0 = 5,20`, bandas 3,3% / 2,4% → `P_compra ≈ 157,6`, `P_venta ≈ 216,7`. Gordon `r = 9%`: `g = 4,5%` → `P ≈ 120,7`; `g = 5,5%` → `P ≈ 156,7`. Invertida a `P = 165`, `r = 9%` → `g_implicito ≈ 5,6%`.

**T4 — Síntesis por mínimo (sin Gordon).** Con `P_weiss_compra = 158`, `P_multiplos_media = 168`, `P_multiplos_p25 = 149` y Gordon exigente `= 121` → `P_entrada_conservador = 149` (`metodoLimitante = MULTIPLOS_P25`), `P_entrada_optimista = 158` (`metodoLimitante = WEISS`). Gordon NO altera ninguno de los dos precios (regresión del bug v1.1); solo aporta `gordonCoherencia`.

**T4b — Regresión JNJ (datos de la app, ago 2026, defaults v1.4).** `P_actual = 268,04`, `D0 = 5,36`, CAGR 5,2%, `P_weiss_compra = 161,20`, `P_multiplos_media = 170,03`. Esperado: `P_entrada_optimista = 161,20` (`WEISS`), conservador = `min(161,20, P_multiplos_p25)`, semáforo `LEJOS`; Gordon con defaults 8%/5%: horquilla `139,36–276,04` (flexible con `gRecortado`), coherencia `COHERENTE` (161,20 ≤ 276,04). El resultado v1.1 (entrada 92,91, −66% de distancia) queda explícitamente como comportamiento erróneo que este test previene.

**T5 — Tope por yield mínimo (ejercicio 3).** `D0 = 4,00`, `yield_min_exigido = 4%` → tope `100,00`; banda alta 4,2% → Weiss `95,24`; múltiplos media `102`. Entrada optimista = `min(95,24; 102)` con tope 100 → `95,24`, `metodoLimitante = WEISS` (la condición operativa del capítulo, "100 € o menos", se cumple; el criterio min de esta spec es más exigente y elige 95,24 — documentado como decisión de diseño).

**T6 — Degradaciones.** (a) EPS negativo → PER excluido, mediana con los restantes; (b) sin ningún múltiplo → entrada = `P_weiss_compra` en ambos escenarios (colapsan en uno) con aviso; (c) `CAGR5 = 8%` → `g_opt = 6%`, `g_cons = 4%` (clamps); (d) con el default `r_flexible = 5%` y `CAGR5 = 6%` → `g_opt = 3%` y `gRecortado = true` (caso habitual, no excepcional); (e) 4 años de dividendos → `NO_VALORABLE`.

**T7 — Splits (integración, con snapshot grabado).** Ticker con split (AAPL): las bandas no deben mostrar discontinuidad artificial en el año del split.

**T8 — Régimen de yield obsoleto (caso MCD).** Fixture con serie diaria de yield cuyo último toque de la banda alta clásica fue hace 7 años, `D0 = 7,08`, `weiss.precioInfravalorado = 180,73`, percentil 90 del yield diario = 3,30% → `regimenObsoleto = true`, `P_weiss_compra_efectivo = 7,08 / 0,033 = 214,5`, entrada optimista = `min(214,5, P_multiplos_media = 256,95) = 214,5`, `metodoLimitante = WEISS_P90`, aviso de régimen visible. Variantes: (a) último toque hace 2 años → sin fallback, entrada 180,73 con `WEISS`; (b) `yieldAltoEfectivo ≤ weiss.yieldBajo` → no aplicar fallback, aviso `HISTORIA_DEGENERADA`; (c) el fallback nunca produce `P_weiss_compra_efectivo ≥ weiss.precioSobrevalorado`.

**T9 — Card de configuración de Gordon (§2.1).** (a) Defaults 8%/5% al primer arranque; (b) intentar `r_flexible ≥ r_exigente` → validación bloquea el guardado; (c) `r_flexible = 4%` con CAGR 5% → preview muestra g recortado al 2% y el aviso en línea; (d) guardar nuevos valores → invalida caché y la fila Gordon de la card única se recalcula con las nuevas `r`; el precio de entrada NO cambia; (e) "Restaurar por defecto" vuelve a 8%/5%.

**T10 — Barra de rango (§6.5).** Con el fixture T4b: zonas en orden `[compra ≤ 161,20−p25... ]`, marcador "Hoy" en 268,04 dentro de la zona de sobrevaloración solo si `≥ P_weiss_venta`; los segmentos de Gordon (139,36–276,04) y múltiplos se renderizan bajo la barra; con horquilla fuera de escala, recorte con indicador "→"; en `NO_VALORABLE`, la barra no se renderiza.

---

## 10. Fuera de alcance (v1)

Comparación de múltiplos contra el sector; conversión de divisas; empresas sin dividendo; sugerencia de strikes de cash-secured puts sobre el precio de entrada (candidata natural a v2, el precio de entrada de la card 4 sería el strike de referencia).
