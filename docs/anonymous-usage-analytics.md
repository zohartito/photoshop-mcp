# Anonymous Usage Analytics

This project collects **anonymous, aggregated MCP usage events** to improve the
product. Analytics are **enabled by default** and can be turned off at any time.
The standalone browser UI is security-disabled and emits no UI-server or browser
analytics events.

← Back to [README](../README.md)

## What we collect

- App version, operating system (platform, type, release), CPU count, Node.js version,
  launch method, system locale/timezone, and whether optional env overrides are
  configured (flags only — never paths or values).
  **App version is attached to every server-side event** via `buildRuntimeProperties()`,
  not only `mcp_session_started`.
- **MCP usage**: process lifecycle, MCP client identity
  (name/version from the initialize handshake), virtual page views, Photoshop
  connection status, **batched** tool usage summaries (tool names and counts per
  agent turn — never arguments or results), and prompt template names when requested

Events use a random anonymous identifier stored locally at
`~/.photoshop-mcp/` (SQLite `kv` table and/or `analytics-store.json`). That ID
is registered with Mixpanel via `identify()` for the MCP process — no email,
name, or other PII.

The person profile also stores **install cohort** fields (via `people.set_once` /
PostHog `$set_once`): `first_install_at`, `first_usage_surface` (`mcp`), and
`first_mcp_client_name` when an MCP client first connects. It also
stores **total installed RAM (GB)**, **memory tier (bucketed GB)**, and the
**detected Photoshop version** when available — these hardware fields are on the
person profile only, not repeated on every event.

Country/region signals come from Mixpanel geolocation on Node server egress
(`geolocate: true`) and from `system_locale_region` as a secondary hint.

## MCP events

When you run `photoshop-mcp` directly (e.g. via Cursor MCP config), these events
are sent:

| Event                           | When                                                                | Key properties                                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$pageview`                     | MCP session start                                                   | Virtual URL `photoshop-mcp://mcp`, `usage_surface: mcp`                                                                                                                                                 |
| `mcp_session_started`           | MCP process start (stdio server up)                                 | `app_version`, `photoshop_detected`, `tools_registered_count`                                                                                                                                           |
| `mcp_client_connected`          | MCP client completed initialize handshake                           | `mcp_client_name`, `mcp_client_version`, `mcp_client_connect_count`                                                                                                                                     |
| `mcp_client_disconnected`       | MCP transport closed                                                | `mcp_client_name?`, `mcp_client_version?`                                                                                                                                                               |
| `mcp_session_startup_failed`    | Startup error                                                       | `ok: false`, `error_code`                                                                                                                                                                               |
| `mcp_photoshop_connection`      | Initial connect or failed reconnect                                 | `ok`, `photoshop_connected`, `error_code?`                                                                                                                                                              |
| `mcp_photoshop_first_connected` | First successful Photoshop connection (once per install)            | `event_source: mcp`                                                                                                                                                                                     |
| `mcp_first_tool_success`        | First successful tool call (once per install)                       | `tool_name`, `event_source: mcp`                                                                                                                                                                        |
| `mcp_tool_batch`                | 3s after last tool, 60s max hold, client disconnect, or session end | `tools_called_count`, `tools_error_count`, `unique_tools_count`, `tool_usage_summary`, `tools_used[]`, `had_errors`, `error_codes[]?`, `error_codes_summary?`, `batch_flush_reason`, `mcp_client_name?` |
| `mcp_prompt_requested`          | Prompt template fetch                                               | `prompt_name`                                                                                                                                                                                           |
| `$pageleave`                    | Graceful shutdown (SIGINT/SIGTERM/stdio close)                      | `duration_ms`, `shutdown_reason`                                                                                                                                                                        |
| `mcp_session_ended`             | Graceful shutdown                                                   | `duration_ms`, `shutdown_reason`                                                                                                                                                                        |

Tool usage is **not** sent per call. Calls are aggregated in memory and flushed as
`mcp_tool_batch` when the MCP client pauses for 3 seconds after the last tool in a
burst (typical IDE agent turn), after 60 seconds of continuous tool activity, or
when the session ends or the MCP client disconnects.

One-time funnel milestones (`mcp_first_tool_success`, `mcp_photoshop_first_connected`)
use a persisted local flag plus Mixpanel `$insert_id` deduplication.

## Model tracking

The MCP host owns the LLM, so `photoshop-mcp` does not receive a model name from
Cursor, Claude Desktop, or other stdio MCP clients.

## What we do **not** collect

- API keys or OAuth tokens
- Chat messages, prompts, or model responses
- Photoshop document or layer names, file paths, or image content
- CLI account labels, email addresses, or other account identifiers
- Tool call **arguments** or **results** (MCP logs tool **names** only)

## Processor and hosting

Analytics are processed by [Mixpanel](https://mixpanel.com/). Events are sent to
the **EU ingest endpoint** at `https://api-eu.mixpanel.com` (Node server).
Server-side events include a per-event `$insert_id` (UUID) for ingest
deduplication; one-time milestones use a deterministic `$insert_id` per install.
See the [Mixpanel privacy policy](https://mixpanel.com/legal/privacy-policy/)
for how Mixpanel handles data on their side.

### Geolocation

Mixpanel enriches server-side events with country/region from the client IP when
`geolocate: true` is set on the Node SDK.

To roll back to the legacy PostHog processor, set `ANALYTICS_PROVIDER=posthog`.
PostHog events then go through the managed reverse proxy at `https://a.alisait.com`
with the project UI at `https://eu.posthog.com`.

## Mixpanel dashboard recipes (maintainers)

These insights must be rebuilt manually in Mixpanel — they are not auto-migrated
from any prior PostHog setup.

| Insight                      | Mixpanel approach                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| MCP active users             | Filter `$pageview` where `$current_url = photoshop-mcp://mcp`                                 |
| MCP client breakdown         | `mcp_client_connected` segmented by `mcp_client_name`                                         |
| Install cohorts              | Person `first_usage_surface`, `first_mcp_client_name`, `first_install_at`                     |
| First tool / Photoshop reach | Funnel on `mcp_first_tool_success`, `mcp_photoshop_first_connected`                           |
| Country breakdown            | Segment `mcp_tool_batch` or `$pageview` by country property                                   |
| Tool error rate              | `mcp_tool_batch` where `had_errors = true`, segment by `error_codes` or `error_codes_summary` |
| Photoshop reachability       | `mcp_photoshop_connection` where `ok = false`                                                 |
| Session duration             | Average `duration_ms` on `mcp_session_ended`                                                  |

## How to opt out

Set `ANALYTICS_DISABLED=1` (or the legacy alias `POSTHOG_DISABLED=1`) before
starting `photoshop-mcp`. This disables analytics for that process and persists
the opt-out in local storage.
