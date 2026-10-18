# Nibras — Plateforme de cours en ligne avec sessions vidéo en direct

## Source of truth
- `PRD.md` — product requirements (v2.1, French). Authoritative spec.
- `docs/superpowers/specs/` — design summaries (entry point for planning).
- `docs/superpowers/plans/` — implementation plans, one per sub-project (see the PRD section "Plan de découpage pour l'implémentation").
- `docs/archive/PRD-v1.0.md` — original PRD, read-only.

## Workflow (obra/superpowers)
brainstorming → spec → `superpowers:writing-plans` → `superpowers:subagent-driven-development`.
Install once: `/plugin marketplace add obra/superpowers-marketplace` then `/plugin install superpowers@superpowers-marketplace`.

## Model policy (owner decision)
- **Planning** (specs, PRD changes, implementation plans, architecture decisions): use **Fable** (`model: "fable"`).
- **Implementation subagents** (implementer, task reviewer, re-reviewer, fixers, final reviewer): use **Opus** (`model: "opus"`).
- Always pass the model explicitly when dispatching a subagent.

## Stack (owner decision)
TypeScript monorepo (pnpm + Turborepo): Next.js (web/PWA), NestJS API, PostgreSQL + Prisma, Redis + BullMQ, S3-compatible storage, managed VOD, LiveKit (WebRTC). UI languages: FR (default), AR (RTL), EN. Multi-tenant: independent teachers + organizations.
