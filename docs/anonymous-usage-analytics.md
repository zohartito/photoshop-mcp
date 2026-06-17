# Anonymous Usage Analytics

This project collects **anonymous, aggregated usage events** to understand how the
MCP server and standalone UI are used and to improve the product. Analytics are
**enabled by default** and can be turned off at any time.

← Back to [README](../README.md)

## What we collect

- App version, operating system, and Node.js version
- Startup signals (MCP server or UI server started, Photoshop detected or not)
- Setup funnel events (provider chosen, auth method, validation success/failure
  codes — not credentials)
- Generic UI events (app loaded, onboarding completed)

Events use a random anonymous identifier stored locally at
`~/.photoshop-mcp/` (SQLite `kv` table and/or `analytics-store.json`). That ID
is registered with PostHog via `identify()` so MCP, UI server, and browser
events merge under one anonymous person per install (`person_profiles:
identified_only` — no email, name, or other PII).

## What we do **not** collect (unless you opt into beta team sharing)

- API keys or OAuth tokens
- Chat messages, prompts, or model responses **by default**
- Photoshop document or layer names, file paths, or image content
- CLI account labels, email addresses, or other account identifiers
- Tool call arguments or results

## Beta team content sharing (opt-in)

On first launch of the standalone UI, you are asked whether you want to **join the
beta team**. This is separate from anonymous usage analytics above.

If you accept:

- Your **prompts**, **assistant responses**, **reasoning text**, and **tool names**
  (not arguments or results) may be sent to PostHog after each chat turn
- Content is truncated for very long messages
- Requires anonymous analytics to remain enabled

If you decline, no chat content is logged. You can change this later in
**Settings → General → Privacy → Beta team content sharing**.

Existing installs that have not answered yet are prompted once on the next launch.

## Processor and hosting

Analytics are processed by [PostHog](https://posthog.com/). Events are sent to a
managed reverse proxy at `https://a.alisait.com`; the PostHog project UI is
hosted in the EU (`https://eu.posthog.com`). See the
[PostHog privacy policy](https://posthog.com/privacy) for how PostHog handles
data on their side.

## How to opt out

1. **Standalone UI:** Settings → General → Privacy → set **Anonymous usage
   analytics** to **Off** (also disables beta content sharing).
2. **Beta content only:** Settings → General → Privacy → set **Beta team content
   sharing** to **Off** (anonymous analytics can stay on).
3. **Environment variable:** set `POSTHOG_DISABLED=1` before starting
   `photoshop-mcp` or `photoshop-mcp-ui` (disables all analytics for that
   process and persists opt-out in local storage).
