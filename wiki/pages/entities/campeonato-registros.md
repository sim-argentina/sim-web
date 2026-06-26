---
title: "Campeonato_Registros (Race Results)"
tags: [entity]
updated: 2026-06-07
---

# Campeonato_Registros

Lap time records for championship rounds. Source of truth for all standings and rankings — nothing is pre-computed.

## Key Fields

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | Primary key |
| campeonato_id | uuid | FK → campeonatos |
| nombre | text | Pilot name |
| categoria | text | `oro` \| `plata` \| `bronce` |
| circuito | text | Track/circuit name |
| tiempo | numeric | Lap time in seconds |
| constructor | text | F1 team the pilot represents |
| semana | integer | Round/week number within the championship |

## Derived Standings (computed on demand)

All three standing types are computed fresh on every GET — they are not stored:

- **Rankings**: pilots sorted by best lap time per category/circuit
- **Points standings**: F1-style points (25-18-15-12-10-8-6-4-2-1) accumulated across all `semana` values
- **Constructor standings**: total points per constructor, summed across all pilots

See [[rankings-on-demand]] for the trade-off analysis.

## Admin Entry

Admins enter results via a Turnero-style form. Pilot name suggestions are fetched from `/api/admin/campeonatos/pilotos` (historical data) to reduce typos and maintain consistent naming.

## Related

- [[campeonatos]]
- [[championships]]
- [[rankings-on-demand]]
