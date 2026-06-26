---
title: "Payment Flow"
tags: [feature]
updated: 2026-06-07
---

# Payment Flow

All online payment processing goes through **Mercado Pago** — Argentina's dominant payment gateway.

## Reservations Flow

1. POST `/api/reservas` — server creates a Mercado Pago payment preference
2. Server returns `init_point` (checkout URL)
3. User redirected to Mercado Pago hosted checkout
4. On payment: Mercado Pago calls `/api/webhooks/mercadopago`
5. Webhook handler updates `reservas.estado` to `activa`

## Championship Registration Flow

1. Pilot submits registration form
2. Server calls `/api/admin/campeonatos/[id]/payment-preference` → creates MP preference
3. Same webhook path updates `campeonato_inscripciones.estado_pago` to `pagado`

## Webhook as Source of Truth

The webhook is the only confirmation mechanism. If Mercado Pago fails to deliver it, the reservation stays pending. There is no success-redirect fallback that also updates status (verify this — it may have been added).

> **QUESTION:** Does the Mercado Pago success redirect URL also update payment status, or is the webhook truly the only path?

## Manual Payments

Admins can bypass Mercado Pago entirely and record payments as cash, debit, credit, QR, or transfer. See [[payment-duality]].

## Related

- [[reservas]]
- [[campeonato-inscripciones]]
- [[payment-duality]]
- [[api-patterns]]
