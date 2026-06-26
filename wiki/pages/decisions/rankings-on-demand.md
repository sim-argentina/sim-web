---
title: "Decision: Rankings Computed On Demand"
tags: [decision]
updated: 2026-06-07
---

# Decision: Rankings Computed On Demand

## What

Championship standings (lap-time rankings, F1 points, constructor standings) are recomputed on every GET request. Nothing is materialized or cached.

## Why

- **Simplicity**: no background job, trigger, or denormalized table to maintain
- **Correctness**: standings always reflect the current state of `campeonato_registros`; correcting a result updates standings immediately
- **Scale is small**: championship pilot counts and round counts are low enough that recomputing is fast

## Trade-off

At larger scale, these queries will become slow. Watch for standings endpoint response times exceeding 500ms.

When that happens, options in order of preference:

1. **Postgres materialized view** — recomputed on insert/update to `campeonato_registros` via a trigger; zero application-layer changes
2. **Route-handler cache** — short TTL (e.g. 30s) on the standings response; simple but data can lag
3. **Denormalized standings table** — updated via Supabase triggers; most complex

## Related

- [[campeonato-registros]]
- [[championships]]
