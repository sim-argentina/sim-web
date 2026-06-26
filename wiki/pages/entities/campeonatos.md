---
title: "Campeonatos (Championships)"
tags: [entity]
updated: 2026-06-07
---

# Campeonatos

Championship/league configuration record.

## Key Fields

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | Primary key |
| nombre | text | Championship name |
| descripcion | text | |
| imagen_url | text | Banner/hero image |
| estado | text | `proximo` \| `activo` \| `finalizado` |
| precio_inscripcion | numeric | Registration fee (ARS) |
| fecha_inicio | date | |
| categorias | text[] / jsonb | e.g. `['oro', 'plata', 'bronce']` |
| inscripciones_abiertas | boolean | Controls public registration availability |

## Category System

Championships support multiple skill-based categories: **Oro** (Gold), **Plata** (Silver), **Bronce** (Bronze). Categories are fully segregated — separate rankings, points standings, and results per category. A pilot registered in Plata never appears in Oro standings.

## Enrollment Gate

`inscripciones_abiertas` is the only cap on registrations. The quota (cupos) system was removed — see [[quota-removal]]. Any number of pilots may register while this flag is true.

## Related

- [[campeonato-registros]]
- [[campeonato-inscripciones]]
- [[championships]]
- [[payment-flow]]
- [[quota-removal]]
