---
title: "Decision: Removed Enrollment Quota System"
tags: [decision]
updated: 2026-06-07
---

# Decision: Removed Enrollment Quota System

## What

A `cupos` (enrollment quota) system was built, then removed:

- `525e4b7` — first added an "unlimited" option alongside the cap
- `315406c` — removed the quota system entirely
- `89a3e8b` — fixed a TypeScript build error caused by a dangling `cupos_disponibles` reference

## Why (inferred from git history)

The quota system introduced build errors and likely caused operational friction. Running without a cap and managing capacity manually is simpler. The `inscripciones_abiertas` boolean flag is now the only registration gate.

## Current State

No enrollment cap exists. Admins open/close registration by toggling `inscripciones_abiertas` on the `campeonatos` record.

## If Quotas Are Needed Again

Add a `cupos_maximos` column to `campeonatos` (nullable = unlimited). Count current inscriptions with `estado_pago = 'pagado'` and compare before accepting a new registration.

## Related

- [[campeonatos]]
- [[campeonato-inscripciones]]
