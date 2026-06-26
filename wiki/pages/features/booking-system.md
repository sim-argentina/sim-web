---
title: "Booking System"
tags: [feature]
updated: 2026-06-07
---

# Booking System

Public-facing reservation flow at `/reservas`.

## User Flow

1. Select a date (15-day rolling window)
2. Select an available time slot (separate lists for weekday vs weekend)
3. Select one or more simulators (Ferrari, McLaren, Red Bull, Alpine)
4. Enter name and phone; accept conditions
5. Optionally enter a discount code
6. Checkout via Mercado Pago
7. Reservation confirmed on webhook receipt

## Availability Logic

`getFreeCount()` queries `reservas` to count existing bookings per slot per simulator. Each simulator is an independent unit — selecting Ferrari and McLaren for the same slot is always valid (two separate bookings created).

## Pricing

ARS 12,000 per simulator per session. Discount codes reduce this amount per-booking.

## Time Slots

Defined as two arrays (weekday / weekend) of time strings. The UI only renders slots that have at least one simulator free.

## Related

- [[reservas]]
- [[codigos-descuento]]
- [[payment-flow]]
