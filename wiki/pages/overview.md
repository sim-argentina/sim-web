---
title: "SIM Argentina — Project Overview"
tags: [overview]
updated: 2026-06-07
---

# SIM Argentina

F1 and GT simulator experience center in Córdoba, Argentina. The platform manages bookings, championship leagues, a merchandise store, and an admin back-office.

## Revenue Streams

| Stream | Mechanism | Price |
|--------|-----------|-------|
| Simulator sessions | 20-min bookings per simulator | ARS 12,000 |
| Championships | Paid pilot registration | Varies by category |
| Rentals (Alquiler) | Private/corporate events | Custom |

## Simulators

Four units, each branded after an F1 team: **Ferrari**, **McLaren**, **Red Bull**, **Alpine**. Each can be booked independently — selecting two simulators creates two separate bookings.

## Core Modules

- **Reservas** — public booking flow with real-time slot availability, discount codes, and Mercado Pago checkout. See [[booking-system]].
- **Campeonatos** — multi-round racing championships with categories (Oro/Plata/Bronce), F1-style points standings, lap-time rankings, and pilot registration. See [[championships]].
- **Tienda** — product showcase (display only; no cart/checkout).
- **Admin Panel** — back-office: booking calendar, championship management, store CRUD, discount codes, metrics dashboard. See [[admin-panel]].

## Tech Summary

Next.js 16 App Router + TypeScript + Supabase (PostgreSQL) + Mercado Pago. No ORM; direct Supabase client. See [[tech-stack]].

## Domain Language (Spanish)

The codebase and UI are entirely in Spanish:

| Term | Meaning |
|------|---------|
| `reservas` | bookings / reservations |
| `campeonatos` | championships |
| `inscripciones` | pilot registrations |
| `registros` | race result records |
| `codigos_descuento` | discount codes |
| `turnero` | booking/scheduling admin interface |
| `novedades` | news / announcements |
| `sorteos` | raffles / giveaways |
| `cupos` | enrollment quotas (removed — see [[quota-removal]]) |
