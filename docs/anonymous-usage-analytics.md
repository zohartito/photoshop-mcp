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
  changes). When analytics are enabled, the browser also records UI interactions
  via autocapture and session replay (see [Session replay and autocapture](#session-replay-and-autocapture))

Events use a random anonymous identifier stored locally at
`~/.photoshop-mcp/` (SQLite `kv` table and/or `analytics-store.json`). That ID
is registered with Mixpanel via `identify()` so MCP, UI server, and browser
events merge under one anonymous person per install — no email, name, or other
PII.

The person profile also stores **total installed RAM (GB)** and the **detected
Photoshop version** when available, so cohort reports can segment by hardware
and Photoshop release without repeating those fields on every event.

Country/region signals come from Mixpanel geolocation on Node server egress
(`geolocate: true`) and from `system_locale_region` / `browser_locale_region`
as a secondary hint.

## Session replay and autocapture

When anonymous usage analytics are **enabled**, the standalone browser UI
initializes Mixpanel with **autocapture** (automatic click and form interaction
tracking) and **session replay** at a **100% sample rate**
(`record_sessions_percent: 100`). This records UI interactions and session
replays to help maintainers understand how the product is used.

These features are **disabled** when you turn off anonymous usage analytics
(Settings → Privacy, or `ANALYTICS_DISABLED=1` / `POSTHOG_DISABLED=1`). The
previous PostHog integration did not record session replay and had autocapture
turned off.

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

MCP-only installs appear in Mixpanel via the virtual `$pageview` at
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
  (not arguments or results) may be sent to Mixpanel after each chat turn
- Content is truncated for very long messages
- Requires anonymous analytics to remain enabled

If you decline, no chat content is logged. You can change this later in
**Settings → General → Privacy → Beta team content sharing**.

Existing installs that have not answered yet are prompted once on the next launch.

## Processor and hosting

Analytics are processed by [Mixpanel](https://mixpanel.com/). Events are sent to
the **EU ingest endpoint** at `https://api-eu.mixpanel.com` (browser and Node
server). See the [Mixpanel privacy policy](https://mixpanel.com/legal/privacy-policy/)
for how Mixpanel handles data on their side.

### Geolocation

Mixpanel enriches server-side events with country/region from the client IP when
`geolocate: true` is set on the Node SDK. Browser events use Mixpanel's default
geo enrichment on ingest.

To roll back to the legacy PostHog processor, set `ANALYTICS_PROVIDER=posthog`.
PostHog events then go through the managed reverse proxy at `https://a.alisait.com`
with the project UI at `https://eu.posthog.com`.

## Mixpanel dashboard recipes (maintainers)

These insights must be rebuilt manually in Mixpanel — they are not auto-migrated
from any prior PostHog setup.

| Insight | Mixpanel approach |
| --- | --- |
| MCP active users | Filter `$pageview` where `$current_url = photoshop-mcp://mcp` |
| MCP client breakdown | `mcp_client_connected` segmented by `mcp_client_name` |
| Country breakdown | Segment `mcp_tool_batch` or `$pageview` by country property |
| Tool error rate | `mcp_tool_batch` where `tools_error_count > 0`, segment by `error_codes_summary` |
| Photoshop reachability | `mcp_photoshop_connection` where `ok = false` |
| Session duration | Average `duration_ms` on `mcp_session_ended` |
| MCP vs UI usage | User property `usage_surfaces` (comma-separated: `mcp`, `server`, `web`) |
| Standalone UI model | User `active_provider` / `active_model` or event `ui_model_selected` |
| Session replay | Mixpanel Session Replay — filter by users with browser UI events |

## How to opt out

1. **Standalone UI:** Settings → General → Privacy → set **Anonymous usage
   analytics** to **Off** (also disables beta content sharing).
2. **Beta content only:** Settings → General → Privacy → set **Beta team content
   sharing** to **Off** (anonymous analytics can stay on).
3. **Environment variable:** set `ANALYTICS_DISABLED=1` (or the legacy alias
   `POSTHOG_DISABLED=1`) before starting `photoshop-mcp` or `photoshop-mcp-ui`
   (disables all analytics for that process and persists opt-out in local
   storage).
