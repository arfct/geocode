# CLAUDE.md

This repo follows the Artifact Primer: https://github.com/arfct/ops/tree/main/primer

- Standards (style, commits, branches): https://github.com/arfct/ops/blob/main/primer/standards.md
- Work tracking: Linear workspace `arfct`, team Artifact (A) — https://github.com/arfct/ops/blob/main/primer/linear.md
- Bugs: https://github.com/arfct/ops/blob/main/primer/bugs.md · Deployment: https://github.com/arfct/ops/blob/main/primer/deployment.md
- Agent conventions and boundaries: https://github.com/arfct/ops/blob/main/primer/agents.md

## This repo

geocode is a set of browser-side tools for manipulating geographical data — coordinate conversion
first, more to follow. It's a SvelteKit app (Svelte 5, runes mode) deployed to Cloudflare Workers
with `@sveltejs/adapter-cloudflare`: `npm run dev` to work on it, `npm run deploy` to ship it. Keep
the geographic maths in `src/lib/geo/` as pure functions with tests, and the Svelte routes thin —
that split is what makes the conversions testable without a browser.
