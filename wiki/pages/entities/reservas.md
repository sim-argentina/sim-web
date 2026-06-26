---
title: "Reservas (Reservations)"
tags: [entity]
updated: 2026-06-07
---

# Reservas

Core revenue entity. Represents a single simulator session booking.

## Key Fields

| Field | Type | Notes |
|-------|------|-------|
| id | uuid | Primary key |
| fecha | date | Booking date |
| hora | time | Start time |
| simulador | text | `ferrari` \| `mclaren` \| `red_bull` \| `alpine` |
| nombre | text | Customer name |
| telefono | text | Customer phone |
| precio | numeric | ARS; base 12,000, reduced if discount applied |
| codigo_descuento | text | Applied code (nullable) |
| estado | text | `activa` \| `cancelada` |
| condiciones_aceptadas | boolean | |
| mercadopago_id | text | Payment preference/order ID |

## Business Rules

- **Availability**: slots vary by weekday vs weekend; 15-day rolling booking window
- **Per-simulator bookings**: selecting two simulators creates two separate `reservas` rows
- **Discount codes**: validated and consumed at checkout; code deactivates when usage limit is hit — see [[codigos-descuento]]
- **Payment confirmation**: `estado` set to `activa` on Mercado Pago webhook receipt — see [[payment-flow]]
- **Cancellation**: admin deletes via Turnero panel

## Related

- [[booking-system]]
- [[codigos-descuento]]
- [[payment-flow]]
