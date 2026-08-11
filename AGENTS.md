# photoshop-mcp — MCP server that lets AI assistants (Claude, Cursor) drive Adobe Photoshop via 85 tools, 11 recipes, 18 prompts.

## Run & test
TypeScript + ESM, Node >=18 (dev on 22). Docs use `npm`; package.json also declares `pnpm@10`.
- Build: `npm run build` (server tsc → `dist/` + web) · `npm run build:server` (server only) · `npm run dev` (`tsc --watch`).
- Run: `npm start` (= `node dist/index.js`, a stdio MCP server). Hosts normally launch it via `npx @alisaitteke/photoshop-mcp`.
- Lint/format: `npm run lint` (eslint src) · `npm run format` / `npm run format:check` (prettier).
- Offline tests (no Photoshop; `tsx`/`node` scripts, run one at a time e.g. `npm run test:p3-security`): `test:uxp-normalize`, `test:intent-expansion`, `test:extendscript-literals`, `test:extendscript-result`, `test:custom-script-disabled`, `test:tool-input-validation`, `test:ui-security-disabled`, `test:cli-account-capability-boundary`, `test:gemini-env-settings`, `test:p2-security`, `test:p3-security`, `test:uxp-quarantine`, `test:uxp-session-authority`, `test:uxp-replay-tombstones`, `verify:photoshop-prompts`.
- Integration (needs a running Photoshop): `test:mcp-local`, `test:mcp-all`, `spike:issue-2`, `spike:photoshop-actions`. There is no unit-test runner or CI test job — these scripts are the whole suite.

## Structure
- `src/index.ts` — entrypoint (builds to `dist/index.js`); boots `PhotoshopMCPServer` (`src/core/`) on stdio.
- `src/transport/` — `TransportRouter` is the single choke point to Photoshop: per-command routing between the ExtendScript and UXP-bridge backends behind one global FIFO queue.
- `src/tools/` — atomic `photoshop_*` tools + `recipes/` + `generative/`; `src/prompts/` — server instructions + 18 templates.
- `src/platform/` — OS detectors, script executors, UXP bridge client/server; `src/analytics/` — Mixpanel/PostHog telemetry.
- `web/` (security-disabled browser UI, kept as source), `uxp-plugin/` (companion Neural-Filter plugin), `docs/` (architecture, security-boundaries, development).

## Conventions & danger zones
- ESM only (`"type": "module"`); prettier + eslint enforced. Keep tool names, schemas, and error envelopes stable across the transport migration (the router facade exists so tool bodies are a mechanical type swap).
- Security tombstones (`docs/security-boundaries.md`) — do NOT "re-enable": macOS ExtendScript execution is disabled; `photoshop-mcp-ui` fails closed (no listener/browser); arbitrary caller-supplied scripts are unavailable; curves are preset-only; `recipe_prepare_for_web` is disabled.
- UXP bridge is protocol v4: plugin and server must be updated together (one session ID bound to a per-session bearer token; expired lease quarantines the whole bridge). Port via `PHOTOSHOP_UXP_BRIDGE_PORT` (default 38452).
- Analytics is ON by default — set `ANALYTICS_DISABLED=1` when running/testing.

## Agent rules (all harnesses)
- Determinism boundary: anything that must be EXACT (money, geometry, safety limits, scoring, pricing) lives in code; the model only orchestrates and judges.
- Keep this file current: when you change how this repo is run, tested, or structured, update AGENTS.md in the same commit. Keep it under ~150 lines.
