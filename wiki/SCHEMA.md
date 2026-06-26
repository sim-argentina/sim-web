---
title: "SIM Argentina Wiki — Schema"
---

# SIM Argentina Wiki

Living knowledge base for the sim-argentina codebase. Covers design decisions, architecture, domain entities, feature specs, and operational context. The LLM writes and maintains all wiki files; you browse, direct, and add sources.

## Directory Structure

```
wiki/
  SCHEMA.md           ← conventions and workflows (this file)
  index.md            ← content catalog (always read first on a query)
  log.md              ← append-only event log
  sources/            ← raw source documents (immutable; LLM reads, never writes)
  pages/
    overview.md       ← high-level project summary
    architecture/     ← tech stack, patterns, system design
    entities/         ← database tables and domain objects
    features/         ← user-facing and admin features
    decisions/        ← why specific choices were made
    operations/       ← deployment, env vars, integrations
```

## Conventions

- **File names**: lowercase kebab-case (`campeonato-registros.md`)
- **Cross-references**: `[[page-name]]` wikilinks; actual path is `wiki/pages/<category>/<page-name>.md`
- **Front matter**: each page has `title`, `tags`, and `updated`
- **Tags**: `architecture` | `entity` | `feature` | `decision` | `operation`
- **Stubs**: pages tagged `stub` are placeholders — fill when you have enough info
- **Conflicts**: mark with `> **CONFLICT:**` blockquote
- **Open questions**: mark with `> **QUESTION:**` blockquote

## Workflows

### Ingest a source
1. User provides a file (drop in `sources/`) or pastes content
2. Discuss key takeaways with user
3. Write or update pages; note the source they came from
4. Add new pages to `index.md`
5. Append to `log.md`: `## [YYYY-MM-DD] ingest | Source Title`

### Answer a query
1. Read `index.md` to find relevant pages
2. Read those pages
3. Synthesize an answer with wikilink citations
4. If the answer is non-trivial and reusable, file it as a new page
5. Append to `log.md`: `## [YYYY-MM-DD] query | Short question summary`

### Lint pass
Ask me to audit the wiki for: contradictions, stale info, orphan pages with no inlinks, stubs that can now be filled, important concepts without their own page.

## Category Reference

| Category | Directory | Use for |
|----------|-----------|---------|
| architecture | `pages/architecture/` | Tech stack, system patterns, data flow |
| entity | `pages/entities/` | Database tables, core domain objects |
| feature | `pages/features/` | User-facing and admin features |
| decision | `pages/decisions/` | Why we made a specific choice (ADR-style) |
| operation | `pages/operations/` | Deployment, env vars, integrations, monitoring |
