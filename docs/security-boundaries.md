# Security-boundary compatibility tombstones

Two Photoshop MCP capabilities are intentionally unavailable until they can be
rebuilt with a reviewed security boundary:

- macOS ExtendScript execution is disabled. The former direct script-delivery
  path generated executable automation source from discovered application and
  file identities.
- `photoshop_recipe_prepare_for_web` is disabled. Photoshop saves to a pathname,
  not an atomically held file capability, so a model-selected destination cannot
  currently be authorized without a replacement export design.
- Preview export uses a newly-created private temporary directory. Node opens the
  exact expected file once with `O_NOFOLLOW`, validates that descriptor with
  `fstat`, streams that descriptor under a byte ceiling, then removes only the
  owned directory after closing it.

The optional UXP bridge uses protocol version 4. Its plugin and server must be
updated together; the dedicated initial handshake binds one session ID to a
per-server-session bearer token. Every poll, uncertainty report, and result must
match that owner exactly. A lease that expires after dispatch quarantines the
whole bridge, is terminally `uxp_bridge_execution_uncertain`, and is never
dispatched again because a Photoshop mutation may still be running. Only a bridge
process restart followed by plugin reload and a fresh initial handshake clears quarantine;
a plugin reload alone or late session cannot take ownership. Settled uncertain IDs become bounded
TTL replay tombstones, so an exact late replay is rejected.
