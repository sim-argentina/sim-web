---
title: "Tech Stack"
tags: [architecture]
updated: 2026-06-07
---

# Tech Stack

## Core

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 16.2.2 (App Router) | Server and client components, route handlers |
| Language | TypeScript 5 | |
| React | 19.2.4 | |
| Styling | Tailwind CSS 4.2.2 | PostCSS pipeline |
| Database | Supabase (PostgreSQL) | Hosted; accessed via service role key |
| Auth | Custom cookie-based | No auth library — see [[auth]] |
| Payments | Mercado Pago SDK v2.12.0 | Argentina's dominant payment gateway |

## UI Libraries

| Library | Use |
|---------|-----|
| Lucide React 1.7.0 | Icons |
| Recharts 3.8.1 | Metrics/KPI charts in admin |
| FullCalendar 6.1.20 | Booking calendar in admin Turnero |
| XLSX 0.18.5 | Spreadsheet export |

## Intentional Absences

| Missing | Reason |
|---------|--------|
| ORM (Prisma/Drizzle) | Direct Supabase client is sufficient; see [[data-access]] |
| Form library (React Hook Form etc.) | Manual `useState` throughout |
| State management (Redux/Zustand) | React hooks only |
| Auth library (NextAuth etc.) | Simple cookie comparison against env vars — see [[auth]] |

## Related

- [[auth]]
- [[data-access]]
- [[api-patterns]]
