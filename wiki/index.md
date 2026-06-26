# SIM Argentina Wiki — Index

Content catalog. Read this first on every query to find relevant pages, then drill into them.

---

## Overview

- [overview](pages/overview.md) — What SIM Argentina is: simulators, revenue streams, core modules, Spanish domain vocabulary

---

## Architecture

- [tech-stack](pages/architecture/tech-stack.md) — Next.js 16, Supabase, Mercado Pago; what's absent (no ORM, no form lib, no auth lib) and why
- [auth](pages/architecture/auth.md) — Cookie-based admin auth; two roles; limitations (no expiry, no per-user accounts)
- [data-access](pages/architecture/data-access.md) — Direct Supabase client pattern; server-only DB access; no-transaction gap
- [api-patterns](pages/architecture/api-patterns.md) — Route handler conventions; all ~31 endpoints grouped by domain

---

## Entities

- [reservas](pages/entities/reservas.md) — Simulator booking records; fields, pricing, availability logic, cancellation
- [campeonatos](pages/entities/campeonatos.md) — Championship config; Oro/Plata/Bronce categories; enrollment gate
- [campeonato-registros](pages/entities/campeonato-registros.md) — Lap time records; source of truth for all standings
- [campeonato-inscripciones](pages/entities/campeonato-inscripciones.md) — Pilot registrations; two payment paths
- [codigos-descuento](pages/entities/codigos-descuento.md) — Discount codes; auto-deactivation on usage limit

---

## Features

- [booking-system](pages/features/booking-system.md) — Public reservation flow; slot availability; pricing
- [championships](pages/features/championships.md) — Full championship feature: rankings, points, constructor standings, admin ops
- [payment-flow](pages/features/payment-flow.md) — Mercado Pago integration; webhook confirmation; webhook-as-truth concern
- [admin-panel](pages/features/admin-panel.md) — Back-office sections; auth; UX patterns (modals, FullCalendar, Recharts)

---

## Decisions

- [rankings-on-demand](pages/decisions/rankings-on-demand.md) — Why standings are recomputed per request; when this will need to change and how
- [payment-duality](pages/decisions/payment-duality.md) — Why two payment paths exist; how to interpret `metodo_pago` in reporting
- [quota-removal](pages/decisions/quota-removal.md) — Why the cupos system was removed; how to re-add if needed

---

## Operations

*(No pages yet — add as needed: deployment, env vars, Mercado Pago webhook monitoring, Supabase project config)*
