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

Curves adjustment remains preset-only with static control points; no caller-supplied
point array reaches sorting or generated ExtendScript.

CLI-account validation treats executable output as untrusted: combined stdout
and stderr capture stops at 64 KiB, closes both pipes, and terminates the child
process tree with TERM followed by a short forced-kill escalation. POSIX probes
run in an isolated process group; Windows resolves and validates the absolute
`%SystemRoot%\System32\taskkill.exe`, then awaits bounded `/T` and `/F /T`
tree commands before falling back to the leader. A final deadline resolves
fail-closed even when descendants hold inherited pipes. An exceeded cap or
timeout is a validation failure; partial output is never parsed as an account
assertion.

The release and release-note workflows hold write-capable GitHub permissions.
All third-party actions in those workflows are pinned to reviewed, immutable
commit IDs; update those pins only as a deliberate, reviewed maintenance change.
