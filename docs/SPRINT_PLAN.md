# Sprint Plan: Gemini Dividend Intelligence Features

**Dates:** Abril 14 — Mayo 9, 2026 (4 semanas)
**Team:** 1 desarrollador full-stack (Jose)
**Sprint Goal:** Entregar tres features de inteligencia de dividendos potenciadas por Gemini que transformen Plazafolio de un analizador estático a un asistente proactivo de inversión en dividendos.

---

## Capacidad

| Persona | Dias Disponibles | Asignacion | Notas |
|---------|-----------------|------------|-------|
| Jose | 20 de 20 | ~120h efectivas | Solo developer, full-stack |
| **Total** | **20** | **~120h** | Buffer 20% = ~96h planificables |

---

## Sprint Backlog

### Fase 1: Dividend Safety Radar (Semanas 1-2)

| Prioridad | Item | Estimacion | Dependencias |
|-----------|------|------------|--------------|
| P0 | Disenar prompt de analisis de seguridad del dividendo para Gemini | 4h | Ninguna |
| P0 | Crear endpoint `/api/dividend-safety/:ticker` en server.js | 8h | Prompt listo |
| P0 | Implementar logica de scoring (payout ratio, FCF coverage, debt trends) | 6h | Datos FMP existentes |
| P0 | Integrar Google Search grounding para noticias de riesgo | 4h | Pipeline Gemini existente |
| P0 | Crear componente `DividendSafetyCard.vue` con score visual 1-10 | 8h | Endpoint listo |
| P1 | Cache en Supabase `dividend_safety` con TTL 24h | 4h | Tabla migration |
| P1 | Integrar en PortfolioDetail.vue y SecReportDetail.vue | 4h | Componente listo |
| P2 | Alertas push cuando safety score baja >2 puntos | 6h | Score historico |

**Subtotal Fase 1: ~44h**

### Fase 2: Earnings Call Dividend Decoder (Semana 3)

| Prioridad | Item | Estimacion | Dependencias |
|-----------|------|------------|--------------|
| P0 | Investigar acceso a transcripts de earnings calls (SEC 8-K / APIs gratuitas) | 4h | Ninguna |
| P0 | Crear servicio de extraccion de transcripts `earnings-calls.js` | 8h | Fuente de datos confirmada |
| P0 | Disenar prompt Gemini para analisis de lenguaje sobre dividendos | 4h | Transcripts disponibles |
| P0 | Endpoint `/api/earnings-call/:ticker` con analisis y citas | 6h | Servicio + prompt |
| P0 | Componente `EarningsCallBrief.vue` con resumen + citas clave | 6h | Endpoint listo |
| P1 | Generar audio TTS del brief (reutilizar pipeline existente) | 3h | Pipeline TTS existente |
| P1 | Integrar en vista de informes con tab/seccion dedicada | 3h | Componente listo |

**Subtotal Fase 2: ~34h**

### Fase 3: Portfolio Income Simulator (Semana 4)

| Prioridad | Item | Estimacion | Dependencias |
|-----------|------|------------|--------------|
| P0 | Crear modelo de proyeccion de income (DRIP, crecimiento historico) | 8h | Datos dividendos FMP |
| P0 | Disenar prompt Gemini para recomendaciones contextuales | 4h | Modelo de proyeccion |
| P0 | Endpoint `/api/income-simulator` con escenarios | 6h | Modelo + prompt |
| P0 | Componente `IncomeSimulator.vue` con inputs interactivos | 10h | Endpoint listo |
| P1 | Grafico Highcharts de proyeccion a 1/3/5/10 anos | 6h | Datos de simulacion |
| P1 | Sugerencias de diversificacion basadas en portfolio actual | 4h | Scoring Geraldine |
| P2 | Comparativa de escenarios side-by-side | 6h | Componente base |

**Subtotal Fase 3: ~44h**

---

## Capacidad Planificada vs Carga

| Metrica | Valor |
|---------|-------|
| Capacidad disponible | 96h (con 20% buffer) |
| Carga P0 | 82h |
| Carga P0 + P1 | 106h |
| Carga total (P0+P1+P2) | 122h |
| Utilizacion P0 | 85% de capacidad |

**Recomendacion:** Completar todos los P0 es alcanzable. Los P1 se priorizan segun velocidad real de cada fase. Los P2 pasan al siguiente sprint.

---

## Riesgos

| Riesgo | Impacto | Mitigacion |
|--------|---------|------------|
| Rate limits de Gemini Free Tier (15 RPM / 500 RPD) | Bloquea Safety Radar para portfolios grandes | Implementar cola con backoff + cache agresivo (24h TTL) |
| Transcripts de earnings calls no disponibles gratis | Feature 2 no viable sin datos | Investigar primero (P0, dia 1 semana 3). Alternativa: analizar 8-K filing text |
| Complejidad del Income Simulator UI | Overengineering la UI | MVP con 3 inputs: monto, horizonte, estrategia. Iterar despues |
| Gemini grounding quota (15 RPD para search) | Pocas consultas con noticias por dia | Separar: safety score mecanico (sin quota) + news layer (con grounding, cached) |

---

## Dependencias Tecnicas

| Dependencia | Estado | Accion |
|-------------|--------|--------|
| Pipeline Gemini narrativas (llm-provider.js) | Funcional | Reutilizar y extender |
| Pipeline TTS (generateAudio) | Funcional | Reutilizar para Earnings Call |
| Datos FMP (fundamentals, dividends, cash flow) | Funcional | Base para Safety Radar + Simulator |
| Supabase Storage + DB | Funcional | Nuevas tablas/columnas para safety scores |
| SEC EDGAR XBRL | Funcional | Extender para 8-K (earnings calls) |
| Google Search Grounding | Funcional (con limites) | Clave para Safety Radar news layer |

---

## Orden de Ejecucion Recomendado

```
Semana 1: Safety Radar backend (prompt + endpoint + scoring)
Semana 2: Safety Radar frontend (componente + integracion + cache)
Semana 3: Earnings Call Decoder (investigacion datos + pipeline completo)
Semana 4: Income Simulator (modelo + UI + Gemini recommendations)
```

**Criterio de corte:** Si la Fase 2 se bloquea por falta de datos de transcripts, pivotar a "Dividend News Monitor" — un feed de noticias filtrado por Gemini que detecta eventos que afectan dividendos usando solo Google Search grounding.

---

## Definition of Done

- [ ] Endpoint funcional con tests manuales
- [ ] Componente Vue integrado en la vista correspondiente
- [ ] Cache en Supabase con TTL configurado
- [ ] Manejo de errores (rate limits, datos faltantes, API keys)
- [ ] Audio TTS opcional donde aplique
- [ ] Funciona en mobile (responsive)

---

## Key Dates

| Fecha | Evento |
|-------|--------|
| 14 Abril | Sprint start — comenzar Safety Radar backend |
| 21 Abril | Mid-sprint — Safety Radar completo, iniciar Earnings Call |
| 28 Abril | Earnings Call completo, iniciar Income Simulator |
| 9 Mayo | Sprint end — Demo de las 3 features |
| 12 Mayo | Retro + priorizar P1/P2 pendientes |
