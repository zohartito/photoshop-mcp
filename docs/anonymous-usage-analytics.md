# Anonymous Usage Analytics

This project collects **anonymous, aggregated usage events** to understand how the
MCP server and standalone UI are used and to improve the product. Analytics are
**enabled by default** and can be turned off at any time.

← Back to [README](../README.md)

## What we collect

- App version, operating system (platform, type, release), CPU count, memory tier
  (bucketed GB), Node.js version, launch method, system locale/timezone, and whether
  optional env overrides are configured (flags only — never paths or values).
  **App version is attached to every server-side event** via `buildRuntimeProperties()`,
  not only `mcp_session_started`.
- **MCP-only usage** (no UI required): process lifecycle, MCP client identity
  (name/version from the initialize handshake), virtual page views, Photoshop
  connection status, **batched** tool usage summaries (tool names and counts per
  agent turn — never arguments or results), and prompt template names when requested
- **UI server** startup and setup funnel events (provider chosen, auth method,
  validation success/failure codes — not credentials), plus **active provider/model**
  on the anonymous person profile when a chat is created or the model changes
- **Browser UI** events (app loaded, onboarding completed, page views on route
  changes)

Events use a random anonymous identifier stored locally at
`~/.photoshop-mcp/` (SQLite `kv` table and/or `analytics-store.json`). That ID
is registered with PostHog via `identify()` so MCP, UI server, and browser
events merge under one anonymous person per install (`person_profiles:
identified_only` — no email, name, or other PII).

The person profile also stores **total installed RAM (GB)** and the **detected
Photoshop version** when available, so cohort reports can segment by hardware
and Photoshop release without repeating those fields on every event.

Country/region signals come from PostHog GeoIP on outbound requests (when enabled)
and from `system_locale_region` / `browser_locale_region` as a secondary hint.

## MCP events

When you run `photoshop-mcp` directly (e.g. via Cursor MCP config), these events
are sent:

| Event | When | Key properties |
| --- | --- | --- |
| `$pageview` | MCP session start | Virtual URL `photoshop-mcp://mcp`, `usage_surface: mcp` |
| `mcp_session_started` | MCP process start (stdio server up) | `app_version`, `photoshop_detected`, `tools_registered_count` |
| `mcp_client_connected` | MCP client completed initialize handshake | `mcp_client_name`, `mcp_client_version`, `mcp_client_connect_count` |
| `mcp_client_disconnected` | MCP transport closed | `mcp_client_name?`, `mcp_client_version?` |
| `mcp_session_startup_failed` | Startup error | `ok: false`, `error_code` |
| `mcp_photoshop_connection` | Initial connect or failed reconnect | `ok`, `photoshop_connected`, `error_code?` |
| `mcp_tool_batch` | 3s after last tool, 60s max hold, client disconnect, or session end | `tools_called_count`, `tools_error_count`, `unique_tools_count`, `tool_usage_summary`, `error_codes_summary?`, `batch_flush_reason`, `mcp_client_name?` |
| `mcp_prompt_requested` | Prompt template fetch | `prompt_name` |
| `$pageleave` | Graceful shutdown (SIGINT/SIGTERM/stdio close) | `duration_ms`, `shutdown_reason` |
| `mcp_session_ended` | Graceful shutdown | `duration_ms`, `shutdown_reason` |

Tool usage is **not** sent per call. Calls are aggregated in memory and flushed as
`mcp_tool_batch` when the MCP client pauses for 3 seconds after the last tool in a
burst (typical IDE agent turn), after 60 seconds of continuous tool activity, or
when the session ends or the MCP client disconnects.

## Model tracking

| Surface | Where to see model | Notes |
| --- | --- | --- |
| **Cursor / Claude Desktop MCP** | Not available | The LLM runs inside the IDE; `photoshop-mcp` never sees the model name |
| **Standalone UI** (all users) | Person `active_provider` / `active_model`, event `ui_model_selected` | Set when a chat is created or provider/model changes — no prompt content |
| **Standalone UI** (beta opt-in) | `beta_chat_turn` event `model` property | Includes truncated prompt/response text |

## UI events (standalone server)

| Event | When | Key properties |
| --- | --- | --- |
| `ui_model_selected` | Chat created or model/provider changed | `provider_id`, `model` |

MCP-only installs appear in PostHog Web Analytics via the virtual `$pageview` at
`photoshop-mcp://mcp`, even when the standalone UI is never opened.

## What we do **not** collect (unless you opt into beta team sharing)

- API keys or OAuth tokens
- Chat messages, prompts, or model responses **by default**
- Photoshop document or layer names, file paths, or image content
- CLI account labels, email addresses, or other account identifiers
- Tool call **arguments** or **results** (MCP logs tool **names** only)

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

### GeoIP and the reverse proxy

PostHog enriches server-side events with `$geoip_country_code` from the client IP
when GeoIP is enabled (`disableGeoip: false` in `posthog-node`). The reverse proxy
at `https://a.alisait.com` **must forward the end-user IP** (e.g. via
`X-Forwarded-For` / `X-Real-IP`) to PostHog ingest. If all MCP users appear in one
country, fix proxy headers before investigating application code.

## PostHog dashboard recipes (maintainers)

| Insight | Configuration |
| --- | --- |
| MCP active users | `$pageview` where `$current_url = photoshop-mcp://mcp` |
| MCP client breakdown | `mcp_client_connected` breakdown by `mcp_client_name` |
| Country breakdown | Breakdown by `$geoip_country_code` on `mcp_tool_batch` or `$pageview` |
| Tool error rate | `mcp_tool_batch` where `tools_error_count > 0`, breakdown by `error_codes_summary` |
| Photoshop reachability | `mcp_photoshop_connection` where `ok = false` |
| Session duration | Average `duration_ms` on `mcp_session_ended` |
| MCP vs UI usage | Person property `usage_surfaces` (comma-separated: `mcp`, `server`, `web`) |
| Standalone UI model | Person `active_provider` / `active_model` or event `ui_model_selected` |

## How to opt out

1. **Standalone UI:** Settings → General → Privacy → set **Anonymous usage
   analytics** to **Off** (also disables beta content sharing).
2. **Beta content only:** Settings → General → Privacy → set **Beta team content
   sharing** to **Off** (anonymous analytics can stay on).
3. **Environment variable:** set `POSTHOG_DISABLED=1` before starting
   `photoshop-mcp` or `photoshop-mcp-ui` (disables all analytics for that
   process and persists opt-out in local storage).
