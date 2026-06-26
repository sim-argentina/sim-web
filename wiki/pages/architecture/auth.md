---
title: "Authentication"
tags: [architecture]
updated: 2026-06-07
---

# Authentication

## Mechanism

Cookie-based with hardcoded credential comparison. No JWT, no session table, no library.

1. User POSTs credentials to `/api/admin/login`
2. Server compares against env vars (`ADMIN_PASSWORD`, `STAFF_PASSWORD`)
3. On match, sets a cookie with the role (`admin` or `staff`)
4. Subsequent admin requests read the cookie to determine access level

## Roles

| Role | Access |
|------|--------|
| `admin` | Full panel access |
| `staff` | Limited access (exact scope depends on per-route guards) |

## Where Auth is Checked

- `/api/admin/me` — returns current role or 401; used by the client to gate the UI
- Individual admin route handlers — each checks the cookie independently

> **QUESTION:** Do all admin API routes enforce auth, or do some trust that only the panel UI calls them? Worth auditing `/api/admin/**` route handlers.

## Limitations

- No session expiry — cookie lives until the browser clears it
- No per-user accounts — one admin password, one staff password for the whole team
- No audit trail of who did what
- Changing a password immediately invalidates everyone's session

## Related

- [[tech-stack]]
- [[admin-panel]]
