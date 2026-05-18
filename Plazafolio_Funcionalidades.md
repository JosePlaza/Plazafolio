# PLAZAFOLIO — Mapa Funcional Completo

> Descripción exhaustiva de todas las funcionalidades de Plazafolio, organizada por sección. Sin referencias a estilos visuales, colores ni CSS.

---

## SECCIÓN 1: RANKING ("Ranking de Activos")

### Funcionalidad principal
Sistema de puntuación y clasificación de activos por atractivo de inversión en dividendos, basado en el método Geraldine Weiss (score 0-100).

### Acciones disponibles
- **Ver ranking ordenado** de todos los activos (cartera + watchlist) por score descendente
- **Consultar desglose del score** mediante popover informativo que explica los 7 factores y sus pesos:
  - Y (Yield position): 0-45 pts — posición del yield actual respecto a su rango histórico
  - C (CAGR): 0-12 pts — tasa de crecimiento compuesto del dividendo
  - S (Consistency): 0-8 pts — consistencia en el pago de dividendos
  - M (Margin of safety): 0-5 pts — margen de seguridad en la valoración
  - K (Streak): 0-12 pts — racha consecutiva de incrementos
  - P (Payout): -8 a +5 pts — ratio de payout (penaliza si es excesivo)
  - F (Fundamentals): -7 a +5 pts — salud financiera fundamental
- **Ver leyenda de señales**: 6 niveles de recomendación (Compra fuerte ≥75, Compra 60-74, Vigilar 45-59, Mantener 30-44, Caro 15-29, Vender <15)
- **Sincronizar análisis** manualmente con botón refresh
- **Navegar al detalle** de cualquier activo haciendo clic en su fila

### Datos mostrados por activo
- Posición en el ranking (numérica)
- Logo o iniciales del ticker
- Nombre completo + ticker + categoría (Activo / Watchlist)
- Yield actual (%)
- CAGR del dividendo (%)
- Score total + señal textual + barra de progreso
- Desglose abreviado de los 7 factores (Y, C, S, M, K, P, F)

### Estados
- **Vacío**: sin activos guardados, indica ir a Análisis para añadir
- **Cargando**: skeleton de 6 filas
- **Sin análisis**: mensaje individual por activo indicando que necesita ser analizado primero

---

## SECCIÓN 2: PORTFOLIO ("Portfolio")

### Funcionalidad principal
Vista general del portfolio: distribución de capital, métricas agregadas y listado de posiciones.

### Acciones disponibles
- **Visualizar distribución** en gráfico donut con dos modos:
  - "Por activo": peso de cada posición
  - "Por sector": agrupación sectorial
- **Consultar KPIs agregados**:
  - Valor total del portfolio (en moneda de visualización)
  - Ingreso anual por dividendos
  - Yield on Cost medio ponderado
  - Rentabilidad total (P&L %)
- **Sincronizar datos** manualmente
- **Navegar al detalle** de cualquier activo

### Datos mostrados por activo
- Logo + nombre + ticker + sector
- Badge "Sin posición" si no tiene transacciones
- Número de acciones
- Valor de la posición
- Yield on Cost (%)
- Ingreso anual estimado
- P&L (% y absoluto) si tiene posición, o señal Weiss si no tiene

### Estados
- **Vacío**: sin activos en portfolio
- **Cargando**: skeleton de 5 filas

---

## SECCIÓN 3: DETALLE DE PORTFOLIO ("PortfolioDetail")

### Funcionalidad principal
Análisis profundo de un activo individual: gestión de transacciones, métricas de posición, seguridad del dividendo, earnings calls, cotización histórica y proyecciones DCA.

### 3.1 Gestión de transacciones
- **Registrar compra o venta**: formulario con tipo (compra/venta), fecha, número de acciones, precio unitario (con toggle de moneda EUR/USD/GBP), nota opcional
- **Editar transacción existente**: rellena el formulario con los datos de la transacción seleccionada
- **Eliminar transacción**: con modal de confirmación que muestra detalles antes de borrar
- **Ver historial completo**: lista cronológica con tipo, fecha, acciones × precio = total
- **Expandir/colapsar** lista si hay muchas transacciones (show more/less)
- **Acciones mobile**: swipe lateral para revelar botones de editar/eliminar
- **Acciones desktop**: menú contextual de 3 puntos al hacer hover

### 3.2 KPIs del activo
**Métricas de mercado** (siempre visibles):
- Precio actual (con conversión de moneda)
- Yield actual (%)
- Zona de valoración (infravalorado / justo / sobrevalorado)
- CAGR del dividendo (%)

**Métricas de posición** (si tiene transacciones):
- Valor de la posición + desglose en acciones
- Yield on Cost (%) + comparativa vs yield actual
- Ingreso anual estimado + ingreso por acción
- P&L en porcentaje y valor absoluto

### 3.3 Dividend Safety Card
- **Score de seguridad del dividendo** (0-100): anillo de progreso con puntuación
- **Factores individuales**: lista de factores con barra de progreso, señal (+/~/!) y peso
- **Análisis Gemini**: texto generado por IA explicando la sostenibilidad del dividendo, con fuentes citadas
- **Actualizar análisis**: botón de refresh + indicador de fecha de caché
- **Badge REIT**: indica si el activo es un REIT (afecta la evaluación)
- **Expandir/colapsar**: card colapsable con flecha

### 3.4 Earnings Call Brief
- **Resumen del earnings call**: texto generado por IA con los puntos clave
- **Tono detectado**: Confiado, Entusiasta, Neutral, Cauteloso, Evasivo
- **Periodo**: trimestre/año del reporte
- **Fuente**: badge indicando si viene de transcripción directa o búsqueda web
- **Fuentes citadas**: enlaces a las fuentes originales
- **Expandir/colapsar**: card colapsable

### 3.5 Gráfico de cotización
- **Precio histórico** en gráfico de área con selección de timeframe: 1 año, 3 años, 5 años, 10 años
- **Marcadores de transacciones**: compras (triángulos verdes) y ventas (triángulos rojos) superpuestos sobre el precio
- **Precio medio de entrada**: línea horizontal punteada amarilla
- **Tooltip interactivo**: fecha + precio + datos de series al hacer hover

### 3.6 Proyección DCA (Dollar Cost Averaging)
- **Slider de inversión mensual**: ajustable de €10 a €100 (step €5)
- **Gráfico de proyección**: columnas con income actual vs proyectado + línea de YoC
- **KPIs de proyección**: income anual estimado + número de acciones a 5, 10 y 15 años
- **Basado en**: CAGR del dividendo del activo

### Estados y feedback
- Toast de confirmación tras acciones (guardar/eliminar transacción)
- Indicador de carga en acciones asíncronas

---

## SECCIÓN 4: DIVIDENDOS ("Dividendos")

### Funcionalidad principal
Calendario de cobros de dividendos, proyección de ingresos y desglose mensual.

### 4.1 KPIs de dividendos
- Ingreso anual total por dividendos
- Media mensual de ingresos
- Número de activos pagando dividendos
- Ingreso esperado del mes actual

### 4.2 CTA Simulador
- Acceso directo al Simulador de Inversión desde la vista de Dividendos

### 4.3 Calendario mensual
- **Navegación mes a mes**: botones anterior/siguiente + nombre del mes
- **Barra de 12 meses**: visualización rápida del ingreso relativo de cada mes (clicable para seleccionar)
- **Detalle de pagos del mes seleccionado**: lista de activos que pagan ese mes con:
  - Logo + ticker
  - Cálculo: acciones × dividendo por acción
  - Total a cobrar
- **Total del mes**: suma de todos los pagos

### 4.4 Gráfico de flujo de ingresos
- **Ingresos históricos**: columnas con datos reales de dividendos cobrados por año
- **Proyección a 5 años**: columnas con estimación futura basada en CAGR de dividendos

### 4.5 Tabla desglose mensual
- **Matriz activo × mes**: tabla con todos los activos en filas y los 12 meses en columnas
- **Indicador de pago**: punto en los meses donde se espera cobro
- **Columna total**: ingreso anual por activo
- **Fila total**: ingreso mensual agregado
- **Año seleccionable**: muestra datos del año del calendario activo
- **Scroll horizontal**: para acomodar los 12 meses + total en mobile

---

## SECCIÓN 5: SIMULADOR DE INVERSIÓN ("SimulatorPage")

### Funcionalidad principal
Optimizador de asignación de capital potenciado por Gemini AI. Dado un importe y horizonte temporal, recomienda cómo distribuir la inversión entre los activos disponibles para maximizar income por dividendos.

### 5.1 Input del usuario
- **Importe a invertir**: campo numérico con símbolo de moneda
- **Horizonte temporal**: selector de 3, 5 o 10 años
- **Botón simular**: lanza el análisis (muestra estado de carga durante el proceso)

### 5.2 Asignación recomendada
- **Barra apilada de distribución**: representación visual del peso de cada activo en la asignación
- **Pills por activo**: ticker + peso (%) + importe asignado
- **KPIs del mix**:
  - Income estimado Año 1
  - Income estimado Año N (horizonte seleccionado)
  - Valor final estimado del portfolio
- **Análisis Gemini** (colapsable): explicación en texto generada por IA de la lógica detrás de la asignación, con fuentes citadas

### 5.3 Proyección de income
- **Gráfico de proyección**: income anual estimado a lo largo del horizonte temporal
- **Toggle "Por activo"**: alterna entre vista agregada y desglose por activo (stacked)
- **Explicación narrativa**: texto que contextualiza los números ("Con €X repartidos... cobrarías ~€X/mes el primer año, subiendo a ~€X/mes en el año Y...")
- **3 escenarios**: Pesimista, Base y Optimista — cada uno con income estimado y nota explicativa

### 5.4 Justificación por activo ("¿Por qué estos activos?")
Por cada activo en la asignación:
- Peso asignado (%)
- Ticker + rol en el portfolio (Alto yield, Alto crecimiento, Infravalorado, Defensivo, Equilibrado, Diversificación)
- Señal Weiss (del scoring Geraldine)
- Métricas clave: Yield, CAGR, Upside estimado
- Contribución al income: cuánto aporta al ingreso en el año N

### 5.5 Impacto en la cartera
Comparativa visual antes/después de la inversión simulada:
- **Valor total**: actual vs nuevo + variación (delta)
- **Income anual**: actual vs nuevo + variación
- **Yield medio**: actual vs nuevo + variación
- **Tags resumen**: cuántos activos son nuevos, cuántos se refuerzan, total de activos en cartera
- **Datos reales del portfolio**: lee del composable usePortfolio (no parte de 0)

### 5.6 Composite Score del Simulador
El simulador usa un score compuesto de 4 factores (cada uno 25%):
- **Adjusted Yield**: rendimiento ajustado
- **Growth**: potencial de crecimiento del dividendo
- **Safety**: seguridad/sostenibilidad del dividendo
- **Valuation**: valoración relativa (infra/sobrevalorado)

### Estados
- **Vacío**: sin resultado ni error, indica cuántos activos candidatos tiene disponibles
- **Error**: mensaje de error si falla el análisis
- **Cargando**: skeleton de 4 cards

---

## FUNCIONALIDADES TRANSVERSALES

### Conversión de moneda
- Soporte multi-moneda (EUR, USD, GBP)
- Toggle de moneda de visualización
- Conversión automática de precios y valores

### Caché de análisis
- Los análisis (scoring, safety, earnings) se cachean localmente
- Indicador de fecha del último análisis
- Botón de refresh manual para forzar actualización

### AnimatedNumber
- Transición numérica suave cuando cambian los KPIs (no salto brusco)

### Navegación
- 4 tabs principales: Análisis, Ranking, Portfolio, Dividendos
- Navegación a detalle de activo desde Ranking y Portfolio
- Acceso al Simulador desde Dividendos (CTA) y como vista independiente
- Botón back en vistas de detalle

### Gestión de activos
- Activos en cartera ("Active") vs lista de seguimiento ("Watchlist")
- Añadir activos desde la vista de Análisis
- Los activos sin transacciones se muestran con badge "Sin posición"

### Datos en tiempo real
- Precios de mercado actualizados
- Yields calculados sobre precio actual
- P&L calculado sobre precio de compra medio vs precio actual
