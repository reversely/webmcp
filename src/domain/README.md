# Domain layer

Every actor (UI, PlanningAgent, WebMCP agent, Playwright) mutates project state through the
operations in this directory. See `docs/prd.md` section 4. Each module ships with a `*.test.ts`
next to it, and `npm test` runs them all.
