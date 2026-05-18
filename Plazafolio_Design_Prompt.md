# PLAZAFOLIO — Prompt de Diseño Completo para Claude Design

> Este documento describe exhaustivamente la UI de Plazafolio, una herramienta de análisis de inversión en dividendos construida con Vue.js. Úsalo como referencia para generar mockups, rediseños o nuevos componentes que respeten el sistema de diseño existente.

---

## SISTEMA DE DISEÑO GLOBAL

### Paleta de colores
- **Primary**: `#415BFF` (azul) — botones activos, badges, barras de score, enlaces
- **Primary transparente**: `rgba(65, 91, 255, 0.XX)` — fondos sutiles, bordes
- **Emerald**: `#34d399` — ingresos, crecimientos positivos, barras de income
- **Foreground**: `white/90` — texto principal
- **Muted-foreground**: `white/50-70` — texto secundario, labels
- **Background**: `rgb(14, 14, 22)` con patrón de puntos (`dot-pattern`)
- **Heat scale (0-5)**: `#ef4444` → `#f87171` → `#fb923c` → `#fbbf24` → `#6ee7b7` → `#34d399`
- **Danger**: `#f87171` — pérdidas, valores negativos, alertas

### Glass Card (patrón principal)
```css
background: rgba(255, 255, 255, 0.04);
backdrop-filter: blur(20px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 12px;
box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
```

### Tipografía
- **Fuente**: Inter, system-ui, sans-serif
- **Tamaños**: xs (12px), sm (14px), base (16px), lg (18px), xl (20px)
- **Pesos**: medium (500), semibold (600), bold (700)
- **Tracking**: `tracking-wider` (0.05em) para labels uppercase, `tracking-widest` (0.1em) para micro-labels

### Breakpoints responsive
- Mobile: < 640px (sin prefijo `sm:`)
- Tablet: ≥ 640px (`sm:`)
- Desktop: ≥ 1024px (`lg:`)

### Patrones de interacción
- **Expand/Collapse**: max-height 0.3s ease, flecha rota 180°
- **Hover cards**: `group-hover:opacity-100`, border highlight sutil
- **Skeleton loader**: pulse animation (opacity 1→0.4→1)
- **Modales**: Teleport a body, backdrop `fixed inset-0 bg-black/60 backdrop-blur-sm`, z-50
- **Swipe mobile**: Touch gesture para revelar acciones edit/delete, threshold 40px
- **Transiciones**: 0.2s ease (estándar), 0.5s ease (largo), `cubic-bezier(0.22, 1, 0.36, 1)` (barras)

---

## SECCIÓN 1: RANKING ("Ranking de Activos")

### Propósito
Lista de activos ordenados por score de inversión en dividendos (método Geraldine Weiss, 0-100 puntos, 7 factores).

### Layout
- Container: `max-w-5xl mx-auto`
- Título: "Ranking de Activos" + subtítulo "Prioridad de compra según método Geraldine Weiss"
- Acciones header (derecha): botón info scoring + botón sync

### Popover de Scoring (al pulsar info)
- Modal glassmórfico: `w-[calc(100vw-2rem)] sm:w-80`, `rgba(14, 14, 22, 0.95)`, blur(20px)
- Contenido: título "Cómo se calcula el Score", 7 factores con abreviatura + rango de puntos + descripción
- Leyenda de señales: 6 niveles con dot de color + nombre + rango
  - Compra fuerte (≥75), Compra (60-74), Vigilar (45-59), Mantener (30-44), Caro (15-29), Vender (<15)

### Estado vacío
- Centrado: icono paquete en `primary/10`, texto "No hay activos guardados"

### Skeleton loader
- 6 filas con pulse: badge posición (8×8) + logo (9×9) + líneas de texto + métricas

### Lista de activos (cada fila)
- Card: `glass-card p-4 cursor-pointer group`

**Elementos de cada asset:**
1. **Badge posición**: 8×8 rounded-lg, número de ranking, color según heat scale (5 niveles)
2. **Logo**: 9×9 rounded-lg, imagen o fallback con iniciales del ticker (10px bold)
3. **Info**: Nombre (sm semibold), Ticker (10px muted), Badge categoría ("Active"=primary/10, "Watchlist"=white/5, 9px uppercase)
4. **Yield**: Label "Yield" (10px uppercase zinc) + valor `X.XX%` (sm bold primary)
5. **CAGR**: Label "CAGR" (10px uppercase zinc) + valor `+X.XX%` (sm semibold, emerald si ≥0, red si <0)
6. **Score bar**: Señal texto (10px semibold uppercase, heatColor) + score número (xs bold)
   - Barra: h-1.5 rounded-full bg-white/5, fill con gradiente `linear-gradient(90deg, color40, color)`
   - Breakdown tags (8px zinc tabular-nums): Y:XX C:XX S:XX K:XX P:XX F:XX (negativos en red)

**Responsive:**
- Mobile: Layout vertical — posición + contenido apilado, métricas en fila debajo
- Desktop: Layout horizontal single-row — posición | logo+info | yield | CAGR | score bar + breakdown

---

## SECCIÓN 2: PORTFOLIO ("Portfolio")

### Propósito
Distribución visual y métricas clave de las posiciones del portfolio.

### Header
- Título: "Portfolio" + subtítulo + botón sync

### Estado vacío
- Icono maletín en primary/10, texto "No hay activos en tu portfolio"

### Gráfico circular (Donut)
- Card: `glass-card p-5 mb-4`
- Toggle: "Por activo" / "Por sector" (11px, activo=`bg-primary/15 text-primary font-semibold`)
- Highcharts donut: innerSize 60%, height 260px
- Tooltip custom: `rgba(14,14,22,0.9)`, formato "Nombre · $valor · XX.X%"
- Data labels: 10px zinc-400, distancia 15px, connector 1px rgba(255,255,255,0.1)

### KPIs (grid 2×2 → 4 columnas en desktop)
- Cada card: `glass-card p-4 text-center`
1. **Valor Total**: `€XX,XXX` (foreground)
2. **Ingreso Anual**: `€X,XXX` (emerald-400)
3. **Yield on Cost**: `X.XX%` (primary)
4. **Rentabilidad**: `±X.XX%` (emerald si ≥0, red si <0)
- Todos usan AnimatedNumber (transición suave de valores)

### Lista de activos
- Card por asset: `glass-card p-4 cursor-pointer group`
- Fila: Logo(9×9) + Nombre/Ticker/Sector + columnas métricas + flecha
- **Columnas desktop** (w-20 sm:w-24 text-right): Acciones, Valor, YoC (primary bold), Ingreso/año (emerald), P&L o Signal
- **Mobile**: grid-cols-5 debajo del nombre, border-t separador

---

## SECCIÓN 3: DETALLE PORTFOLIO ("PortfolioDetail")

### Propósito
Vista detallada de un activo individual: transacciones, gráficos, proyecciones.

### Header
- Botón back + Logo (11×11) + Nombre (xl bold) + Ticker + Sector

### Formulario de transacción (colapsable)
- Card: `glass-card p-5`, borde `rgba(65, 91, 255, 0.2)`
- Toggle Buy/Sell: 2 botones flex-1, Buy=emerald, Sell=red
- Grid 2→4 columnas: Fecha (DatePicker), Acciones (number), Precio (currency toggle + input), Nota (text)
- Botones: Cancelar (zinc) + Submit (color según tipo)

### KPIs del activo
- Card: `glass-card p-4`
- **Fila 1 (mercado)**: Precio, Yield (primary), Zona (color-coded), CAGR Div.
- **Fila 2 (posición, si tiene)**: Valor + acciones, YoC + vs current, Ingreso/año (emerald) + por acción, P&L (color condicional)

### Dividend Safety Card (componente embebido)
- Score ring SVG (64×64): círculo progreso con strokeDasharray animado
- 7 factores con barra de progreso (h-3px, señal color)
- Análisis Gemini expandible: `bg-primary/5 border-primary/10`, texto 13px zinc-300
- Badges: "REIT" en violeta si aplica

### Earnings Call Brief (componente embebido)
- Icono micrófono + título "Earnings Call" + periodo
- Badge tono: Confiado/Entusiasta (emerald), Neutral (zinc), Cauteloso (amber), Evasivo (red)
- Badge fuente: "Transcript" (emerald) o "Búsqueda" (amber)
- Texto brief expandible

### Gráfico de cotización
- Card: `glass-card p-4`
- Timeframes: 1A, 3A, 5A, 10A (botones toggle, activo=`bg-primary/15 text-primary`)
- Highcharts area (280px): precio #415BFF con gradiente, compras (scatter emerald triangles), ventas (scatter red triangles-down), precio medio entrada (dashed amarillo)

### Transacciones
- Card: `glass-card p-4`, header con badge count + botón add
- Filas: Badge tipo (C verde/V rojo, 6×6) + fecha + cálculo + total
- Mobile: swipe para revelar edit/delete (32×32 botones)
- Desktop: menú 3-dots hover
- Modal confirmación delete: w-72 rounded-2xl, icono trash destructive

### Proyección DCA
- Slider inversión mensual: rango 10-100, thumb #34d399 (16×16 circle), hover scale(1.2) + glow
- Highcharts column (260px): income actual (emerald sólido), proyectado (emerald 30% dashed), YoC spline (amarillo dashed)
- KPIs resumen: 5, 10, 15 años — income/año + acciones (grid-cols-3)

---

## SECCIÓN 4: DIVIDENDOS ("Dividendos")

### Propósito
Calendario de cobros de dividendos e ingresos proyectados.

### Header
- Título: "Dividendos" + subtítulo + botón sync

### Estado vacío
- Icono calendario en primary/10, "No hay posiciones con dividendos"

### KPIs (grid 2→4 columnas)
1. **Ingreso anual**: valor (primary)
2. **Media mensual**: valor
3. **Activos pagando**: número
4. **Este mes**: valor (primary si >0, muted si 0)

### CTA Simulador
- Card: `glass-card p-5 flex items-center gap-4 cursor-pointer`
- SVG animado: grid sutil + curva parabólica (#415BFF) con draw animation (2s) + dot glow pulsante
- Texto: "Simulador de Inversión" (sm semibold, group-hover:primary)

### Calendario mensual (strip)
- Card: `glass-card p-4`
- Navegación: botones prev/next + nombre mes
- Barra de 12 meses (flex gap-1, h-40px): barras proporcionales al ingreso
  - Mes seleccionado: #34d399
  - Otros con ingreso: rgba(52,211,153,0.25)
  - Sin ingreso: rgba(255,255,255,0.04)
- Pagos del mes: filas con logo + ticker + cálculo + total
- Separador total: `border-top 1px solid rgba(255,255,255,0.06)`

### Gráfico flujo de ingresos
- Card: `glass-card p-4`
- Título: "Flujo de ingresos por dividendos"
- Highcharts column (280px): ingresos reales (#34d399 sólido) + proyectado (emerald 30% dashed), eje X años

### Tabla desglose mensual
- Card: `glass-card p-3 sm:p-4`
- Tabla responsive: Activo (sticky left) + Ene-Dic + Total
- Celdas: dot indicador (#34d399) si hay pago, "·" si no
- Footer: border-t semibold primary (totales)

---

## SECCIÓN 5: SIMULADOR ("SimulatorPage")

### Propósito
Optimizador de asignación de inversión potenciado por Gemini AI.

### Layout
- `dot-pattern flex-1 overflow-y-auto p-3 sm:p-6`, container `max-w-5xl mx-auto`
- Back button + Título "Simulador de Inversión"

### Formulario input
- Card: `glass-card p-3 flex flex-col sm:flex-row gap-2 sm:gap-3`
- Input importe: símbolo moneda (left), `pl-7 pr-2 py-2.5`, tabular-nums, placeholder "5000"
- Timeframe: 3 botones (3a, 5a, 10a), h-[42px], activo=`bg-primary/20 text-primary`
- Botón simular: h-[42px] px-5, loading=`bg-primary/10 text-primary/50` con spinner, idle=`bg-primary/15 text-primary`
- Mobile: botón full-width debajo

### Card asignación recomendada
- Barra apilada: flex h-8 rounded-lg, segmentos con width=weight%, color HSL rotado (i*60+220)
- Pills: flex wrap gap-1.5, cada pill con ticker + peso + importe, hsla(hue, 60%, 50%, 0.12)
- KPIs (grid-cols-3 border-t): Income Año 1, Income Año N (primary), Valor final (emerald)
- Análisis Gemini colapsable: icono pirámide #415BFF + texto 13px zinc-300

### Card proyección income
- Toggle "Por activo" para vista stacked vs agregada
- IncomeProjectionChart: area spline, 220px
- Explicación narrativa: "Con €X repartidos... cobrarías ~€X/mes..."
- 3 escenarios (grid-cols-3): Pesimista (red), Base (primary), Optimista (emerald)

### Card "¿Por qué estos activos?"
- Filas por asset: dot color + peso | ticker + role badge + señal Weiss | métricas | income contribución
- Role badges: "Alto yield" (amber), "Alto crecimiento" (emerald), "Infravalorado" (primary), "Defensivo" (violet), "Equilibrado" (cyan), "Diversificación" (zinc)
- Señal Weiss: 9px bold, bg/text condicional según nivel

### Card impacto en cartera
- Gradiente fondo: `linear-gradient(135deg, rgba(65,91,255,0.04) 0%, rgba(16,16,20,0.6) 50%, rgba(52,211,153,0.03) 100%)`
- Header: "Impacto en tu cartera" + leyenda (Actual □ blanco/10, +€X □ primary/40)
- 3 columnas de barras pareadas (grid-cols-3 gap-3):
  - Barra ghost (actual): `rgba(255,255,255,0.07)`, border `rgba(255,255,255,0.08)`
  - Barra nueva: gradiente `rgba(65,91,255,0.5) → rgba(65,91,255,0.18)`, border `rgba(65,91,255,0.3)`
  - Altura max 56px, container 72px, transición 0.7s cubic-bezier
  - Métricas: Valor total, Income anual, Yield medio — con delta en emerald
- Footer tags: "N nuevo(s)" (emerald), "Refuerza N" (primary), "X activos en cartera" (zinc)

### Estado vacío
- Icono monedas en primary/10, "Indica cuánto quieres invertir"

---

## GRÁFICOS (componentes reutilizables)

| Componente | Tipo | Datos | Colores principales |
|---|---|---|---|
| YieldsChart | Line/Area | Yields históricos | #415BFF gradiente |
| ProjectionChart | Area spline | Dividendos proyección | #34d399 sólido + transparente |
| DividendHistoryChart | Column | Dividendos anuales/trimestrales | #415BFF |
| DividendsChart | Bar horizontal | Breakdown por asset | Hue rotado |
| SustainabilityChart | Line/Area | Payout ratio | Verde si sostenible, rojo si riesgo |
| GeraldineChart | Radar/Scatter | 7 factores scoring | Heat scale |
| FinancialOverviewChart | Multi-area | Revenue, expenses, net income | Colores distintos |
| RevenueChart | Column | YoY revenue | Primary + secondary |
| MarginsChart | Area spline | Gross, operating, net margins | Primary → emerald gradiente |
| EvFcfChart / EvEbitdaChart | Scatter/Line | EV ratios | Primary |
| DebtChart | Area spline | Debt ratios | Red-themed |
| ValuationChart | Line | P/E, P/B históricos | Primary + secondary |
| IncomeProjectionChart | Area spline | Income base + per asset | Emerald + multi-color stacked |

---

## NOTAS PARA EL DISEÑADOR

1. **Tema oscuro exclusivo** — no hay modo claro, todo el diseño se basa en glassmorphism sobre fondo oscuro con dot-pattern
2. **Datos numéricos siempre en `tabular-nums`** — alineación consistente de cifras
3. **AnimatedNumber** en todos los KPIs — transición suave al cambiar valores
4. **Heat scale consistente** — el mismo sistema de 6 colores se usa en ranking, señales Weiss, y badges de zona
5. **Mobile-first con swipe** — las transacciones usan gestos touch, las cards se apilan verticalmente
6. **Highcharts con tema custom** — fondo transparente, grid dotted rgba(255,255,255,0.04), tooltips glassmórficos
7. **Logo SVG de Plazafolio**: azul #405BFF con trazo teal #00A19A, forma de "P" estilizada en cuadrado 519×519
