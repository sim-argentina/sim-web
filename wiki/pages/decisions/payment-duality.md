---
title: "Decision: Dual Payment Paths"
tags: [decision]
updated: 2026-06-07
---

# Decision: Dual Payment Paths

## What

Two distinct paths exist for recording a payment:

1. **Mercado Pago** — automated checkout + webhook confirmation; used for public self-registration
2. **Manual** — admin enters payment method directly (cash, debit, credit, QR, transfer); used for in-person or transfer payments

## Why

In the Argentine market, in-person payment is common. Pilots often come to the venue and pay cash or bank transfer. Forcing them through an online checkout would create friction and lost registrations. The manual path lets admins accept any payment method and immediately mark a registration paid without waiting for an MP flow.

## Implication

`campeonato_inscripciones.metodo_pago` must always be interpreted:
- `mercadopago` → system-confirmed via webhook
- anything else → admin-vouched; no second verification exists

When reading payment data for reporting, distinguish these two paths — the confidence level differs.

## Related

- [[campeonato-inscripciones]]
- [[payment-flow]]
- [[championships]]
