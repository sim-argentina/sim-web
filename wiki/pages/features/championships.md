---
title: "Championships Feature"
tags: [feature]
updated: 2026-06-07
---

# Championships (Campeonatos)

Multi-round racing league system. The largest feature module.

## Public Pages (`/campeonatos`)

- Championship listing with status badges (Próximo / Activo / Finalizado)
- Per-championship views:
  - **Rankings** — best lap times per pilot per category, filterable by circuit
  - **Points standings** — cumulative F1-style points across all rounds per category
  - **Constructor standings** — team points aggregated from all pilots
  - **Results history** — searchable by championship, category, circuit, and week
  - **Registration** — Mercado Pago enrollment form (visible only when `inscripciones_abiertas = true`)
  - **Sorteos** — raffles tied to the championship

## Points System

Standard F1 allocation: **25-18-15-12-10-8-6-4-2-1** for positions 1–10. All computed at query time from `campeonato_registros`. See [[rankings-on-demand]].

## Category Segregation

Oro, Plata, Bronce are fully separate pools. All views are filtered by category. A pilot in Plata never affects Oro standings.

## Admin Operations (in `/admin/(panel)/campeonatos`)

- Create / edit championships (name, image, categories, pricing, status)
- Toggle `inscripciones_abiertas`
- Enter race results via Turnero-style form (with pilot name autocomplete)
- View and manage pilot inscriptions
- Override payment status (mark registrations as manually paid)

## Related

- [[campeonatos]]
- [[campeonato-registros]]
- [[campeonato-inscripciones]]
- [[rankings-on-demand]]
- [[payment-flow]]
- [[payment-duality]]
- [[admin-panel]]
