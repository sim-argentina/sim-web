---
title: "Admin Panel"
tags: [feature]
updated: 2026-06-07
---

# Admin Panel

Protected back-office at `/admin/(panel)/`. Requires login at `/admin/login`.

## Sections

| Route | Purpose |
|-------|---------|
| `campeonatos` | Championship CRUD, result entry, inscription management |
| `turnero` | Booking calendar (FullCalendar) — view/manage reservations |
| `tienda` | Product CRUD with image uploads |
| `codigos` | Discount code creation and usage tracking |
| `promociones` | Promotions (may overlap with codigos) |
| `novedades` | News/announcement content management |
| `metricas` | KPI dashboard (Recharts) — revenue, bookings |
| `calendario` | Calendar view for scheduling |

## Auth

Cookie-based, roles `admin` and `staff`. See [[auth]].

## UX Patterns

- Sidebar navigation (desktop nav link for Campeonatos added in commit `b40c6f8`)
- Modal-driven actions: inscription detail, result entry, feedback toasts
- Pilot name autocomplete in result entry (suggestions from historical data)
- Tables with inline actions (delete, edit, mark paid)
- FullCalendar for Turnero and Calendario views

## Related

- [[auth]]
- [[championships]]
- [[payment-duality]]
