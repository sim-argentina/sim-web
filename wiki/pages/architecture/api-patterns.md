---
title: "API Patterns"
tags: [architecture]
updated: 2026-06-07
---

# API Patterns

## Route Structure

Next.js App Router conventions: `app/api/<resource>/route.ts` for collections, `app/api/<resource>/[id]/route.ts` for individual items. Admin-only routes live under `app/api/admin/`.

## ~31 Route Handlers

| Group | Routes |
|-------|--------|
| Reservations | GET (list + filters), POST (create), DELETE |
| Discount codes | GET (validate), POST (increment usage) |
| Campeonatos | GET (public listing/detail), POST admin CRUD |
| Inscripciones | GET/POST (pilot registrations) |
| Registros | GET/POST/DELETE (race results) |
| Pilotos | GET (name suggestions from history) |
| Payment preference | POST (`/api/admin/campeonatos/[id]/payment-preference`) |
| Tienda | CRUD + image upload |
| Auth | POST `/api/admin/login`, GET `/api/admin/me` |
| Sorteos | CRUD |
| Webhooks | POST `/api/webhooks/mercadopago` |

## Request / Response Format

- All endpoints accept and return JSON
- Errors: `{ error: "message" }` with appropriate HTTP status (400, 401, 404, 500)
- No API versioning (no `/v1/` prefix)

## Auth Enforcement

Admin routes check the cookie. See [[auth]].

## Related

- [[data-access]]
- [[auth]]
- [[payment-flow]]
