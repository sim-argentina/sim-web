---
title: "Data Access Pattern"
tags: [architecture]
updated: 2026-06-07
---

# Data Access

## Pattern

No ORM. All database access goes through the Supabase JS client instantiated with the service role key in `lib/supabaseAdmin.ts`. Route handlers import this singleton.

```ts
// lib/supabaseAdmin.ts
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
export default supabase
```

## Usage in Route Handlers

```ts
const { data, error } = await supabase
  .from('campeonatos')
  .select('*')
  .eq('estado', 'activo')
```

Queries are written inline in route handlers — no repository layer or abstraction.

## Client-Side Fetching

Page components use `useEffect` + `fetch` to call the app's own API routes. No Supabase client runs in the browser — all DB access is server-side. The browser never sees the service role key.

## Transactions

Supabase JS client has no multi-statement transaction support. Complex operations spanning multiple tables are done as sequential awaits. If a later call fails, there is no automatic rollback — partial writes are possible. This is a known gap.

## Related

- [[tech-stack]]
- [[api-patterns]]
