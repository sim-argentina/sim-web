---
title: "Campeonato_Inscripciones (Pilot Registrations)"
tags: [entity]
updated: 2026-06-07
---

# Campeonato_Inscripciones

A pilot's registration in a championship. Created via either the public checkout flow or admin manual entry.

## Key Fields

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | Primary key |
| campeonato_id | uuid | FK → campeonatos |
| nombre | text | Pilot display name |
| categoria | text | `oro` \| `plata` \| `bronce` |
| equipo_favorito | text | Favorite F1 team |
| instagram | text | Handle (optional) |
| estado_pago | text | `pagado` \| `pendiente` |
| metodo_pago | text | `mercadopago` \| `efectivo` \| `debito` \| `credito` \| `qr` \| `transferencia` |
| mercadopago_id | text | Payment reference (null for manual methods) |
| created_at | timestamp | |

## Two Registration Paths

1. **Public self-registration**: pilot fills form → Mercado Pago checkout → webhook confirms → `estado_pago = pagado`
2. **Admin manual entry**: admin adds pilot directly, selects payment method, marks paid immediately — no Mercado Pago involved

`metodo_pago = 'mercadopago'` means system-confirmed; anything else means admin-vouched. See [[payment-duality]].

## Related

- [[campeonatos]]
- [[championships]]
- [[payment-flow]]
- [[payment-duality]]
