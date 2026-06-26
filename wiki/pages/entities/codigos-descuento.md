---
title: "Codigos_Descuento (Discount Codes)"
tags: [entity]
updated: 2026-06-07
---

# Codigos_Descuento

Promotional discount codes applied to reservations at checkout.

## Key Fields

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | |
| codigo | text | Code string (e.g. `VERANO20`) |
| descuento | numeric | Discount amount in ARS |
| activo | boolean | Whether the code can be redeemed |
| usos_maximos | integer | Max redemptions (null = unlimited) |
| usos_actuales | integer | Current redemption count |

## Auto-Deactivation

When `usos_actuales` reaches `usos_maximos`, the route handler sets `activo = false` atomically on redemption. No background job needed.

## Validation & Redemption Flow

1. User enters code at checkout
2. GET `/api/codigos-descuento?codigo=X` — returns discount or error
3. If valid, discount shown in the UI; total price updated
4. On reservation creation, code usage incremented; deactivated if limit reached

## Related

- [[reservas]]
- [[booking-system]]
