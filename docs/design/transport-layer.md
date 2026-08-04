# Transport Layer Design — Swappable Backends

- **Status:** proposed (M1 deliverable, 2026-07-05)
- **Fork:** `zohartito/photoshop-mcp` ← upstream `alisaitteke/photoshop-mcp` v1.4.0 (`d76e822`)
- **Context:** vault ADR `2026-07-05_photoshop-mcp-adopt-then-extend.md`, research note `2026-07-05_photoshop-mcp-landscape.md`
- **Verification note:** historical design record. Its live Photoshop claims are
  unverified for the current checkout; owner live-harness verification is pending.

## 1. Goal

Keep all **85 current MCP tool signatures** stable while making HOW a command reaches Photoshop
swappable:

- **Backend A — ExtendScript** (today): Windows COM. macOS direct ExtendScript
  execution is security-disabled pending a reviewed replacement transport.
- **Backend B — UXP batchPlay** (migration path): companion UXP plugin + local bridge.
  UXP plugins can only dial **out** as clients — they can never listen — so any bridge is
  "server on our side, plugin polls/connects in" (same constraint that shapes
  mikechambers/adb-mcp's `ws://localhost:3001` proxy).

Secondary goal (designed here, built later): a **headless batch mode** — queue N files
through a recipe and export — which sits _above_ the transport and works on either backend.

## 2. What v1.4.0 already has (codebase map)

The surprise of M1: upstream already runs **two transports**, ad-hoc.

### Path A — ExtendScript (Windows-supported atomic tools)

```
src/tools/*.ts            20 of 22 tool files generate ExtendScript strings
                          (helpers + snippet library: src/api/extendscript.ts, 2,467 lines)
        │  runSnippet(connection, script)          src/tools/atomic-shared.ts
        ▼
src/api/photoshop-api.ts  PhotoshopAPIFactory — determineAPIType() HARDCODES 'ExtendScript';
                          ExtendScriptPhotoshopAPI.wrapInErrorHandling() adds:
                          px/pt unit forcing, DialogModes.NO, alert/confirm/prompt shims,
                          strict JSON result serialization
        ▼
src/platform/connection.ts  PhotoshopConnection — detect / launch / delegate
        ▼
src/platform/script-executor.ts  interface ScriptExecutor { execute(script), … }
        ├─ macos-executor.ts    security-disabled tombstone; no script delivery
        └─ windows-executor.ts  temp .jsx + temp .vbs → cscript → COM Photoshop.Application
```

### Path B — UXP bridge (3 tools: neural filters + part of enhance-portrait)

```
src/tools/neural-tools.ts / recipes/enhance-portrait.ts
        ▼  invokeNeuralFilter()                    src/platform/uxp-bridge-client.ts
src/platform/uxp-bridge-server.ts   in-process HTTP server on 127.0.0.1:38452
                                    (env PHOTOSHOP_UXP_BRIDGE_PORT; EADDRINUSE fails closed)
                                    command queue + result map; caller polls results @250ms
        ▲  GET /poll (400ms loop) · POST /result
uxp-plugin/ (manifest minVersion 24.0, panel with manual Connect button)
        main.js: hardcoded per-filter switch → batchPlay(neuralDescriptors)
```

### Dead / aspirational code (evidence the author wants this too)

| File                                          | State                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/api/batch-play.ts`                       | descriptor helpers + `generateBatchPlayScript()` — **imported by nothing**      |
| `photoshop-api.ts` `UXPPhotoshopAPI`          | stub, falls back to ExtendScript, "kept for future plugin-based implementation" |
| `macos-executor.ts` `executeViaDoShellScript` | unused alternate delivery                                                       |

### The injection point

`src/core/server.ts:113` — one `PhotoshopConnection` from `Session` is passed into all 18
`create*Tools(connection)` factories. **Single choke point**: swap what flows through here
and every tool follows.

## 3. Why the existing seam is at the wrong altitude

`ScriptExecutor` abstracts Windows COM delivery of an ExtendScript string. A UXP
backend cannot execute ExtendScript at all — batchPlay consumes ActionDescriptor JSON.
Two concerns are conflated today:

| Concern              | Backend A                  | Backend B                             |
| -------------------- | -------------------------- | ------------------------------------- |
| **Payload language** | ExtendScript source string | batchPlay descriptors / UXP JS        |
| **Delivery channel** | Windows COM, temp files    | localhost HTTP poll (or WS) to plugin |

The swappable seam must sit at the **command** level — above payload generation — not at
the script-string level. `ScriptExecutor` survives unchanged as an internal detail _inside_
the ExtendScript backend; the HTTP bridge survives as the channel _inside_ the UXP backend.

## 4. Proposed design

### 4.1 Interfaces

```ts
// src/transport/types.ts
export interface PsCommand {
  name: string; // e.g. 'create_layer_mask'
  params: Record<string, unknown>; // validated with zod (already a dep, ^4.4.3)
  timeoutMs?: number;
}

export interface PhotoshopTransport {
  readonly id: 'extendscript' | 'uxp'; // room for 'firefly' later
  isAvailable(): Promise<boolean>; // PS detected / plugin connected — see caveat below
  capabilities(): Promise<TransportCapabilities>;
  run(command: PsCommand): Promise<unknown>; // parsed JSON result — never raw strings
  // One-undo recipes need a boundary ABOVE single commands: the whole sequence runs
  // inside one history scope (ExtendScript: suspendHistory around the full script;
  // UXP: one executeAsModal + history suspension around all descriptors).
  runOperation(name: string, commands: PsCommand[]): Promise<unknown>;
}
```

**`isAvailable()` must be truthful (Codex finding #3):** the bridge HTTP server is
in-process and always answers `/health` — that proves nothing about the plugin. UXP
availability = "plugin hit `/poll` within the last ~2s" (track last-poll timestamp
server-side), not "server is up".

Result normalization moves inside each transport: structured ExtendScript results use
strict JSON parsing only (never source-text evaluation), and the UXP backend keeps bridge
JSON envelopes internal. Tools stop knowing which they got.

### 4.2 Command registry

Each command registers per-backend implementations. The existing 2,467-line snippet
library and per-tool script generation are **reused verbatim** as the `extendscript`
implementations — no rewrite:

```ts
// src/transport/commands/create-layer-mask.ts
registerCommand({
  name: 'create_layer_mask',
  meta: { mutatesActiveLayer: false, requiresSelection: true, requiresNonBackgroundLayer: true }, // see §6
  extendscript: (p) => ExtendScriptSnippets.createLayerMask(p), // today's code, moved
  uxp: (p) => ({ action: 'batch_play', descriptors: makeMaskDescriptors(p) }),
});
```

**Where command specs live (revised per Codex finding #1):** per-backend implementations
are **co-located with the tool files** that own them — the ExtendScript generator is
already there — not authored in a parallel `src/transport/commands/` tree. The registry is
_derived_ at registration time, avoiding a second 85-entry taxonomy to keep in sync. The
central router stays (that part of the seam is non-negotiable: env override, pins, and
capability gating need one place to live).

The UXP plugin gains **one generic `batch_play` action** (execute a descriptor array via
`executeAsModal`, return the result) replacing the hardcoded per-filter switch. Porting a
command to backend B then means writing descriptors on the server side only — no plugin
release per command. Raw batchPlay results do **not** match today's friendly outputs
(`get_state`, `get_layers`, …); every UXP implementation owes a normalization step to the
same result shape as its ExtendScript twin.

### 4.3 Router

```
PHOTOSHOP_MCP_TRANSPORT = extendscript | uxp | auto   (default: auto)
```

- **auto:** per-command preferred backend → `isAvailable()` check → fall back to the other.
- **Pinned commands:** no generic script-execution tool is exposed. Preview/export
  operations currently stay `extendscript`-only; neural filters and future generative APIs
  stay `uxp`-only. Pins are command-registry metadata, which is exactly why routing must be
  per-command, not a global switch.
- Global env override exists for the side-by-side verification harness (§5).

### 4.4 Tool-factory migration

`create*Tools(connection: PhotoshopConnection)` →
`create*Tools(transport: TransportRouter)`. One mechanical sweep; tool names, schemas,
descriptions, and error envelopes are untouched. MCP clients cannot tell the difference.

## 5. Phasing

| Milestone               | Content                                                                                                                                                                                                                                                                                                                                                                                 | Verification                                                                                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1 (done)**           | fork, map, live-verify A, this doc                                                                                                                                                                                                                                                                                                                                                      | §10 matrix                                                                                                                                                                                                                                                      |
| **M2**                  | `src/transport/` interfaces + `ExtendScriptTransport` wrapping existing code + router with **one global queue**; truthful UXP `isAvailable()`; move neural bridge behind `UxpTransport`; routing table 100% extendscript except neural. **Precondition for M3 parity testing (Codex #4):** normalize tool results to stable JSON envelopes — several tools still emit ad-hoc prose+JSON | `scripts/test-all-mcp-tools.ts` passes unchanged (zero behavior change)                                                                                                                                                                                         |
| **M3 (code-half done)** | generic `batch_play` plugin action + poll lease/ack + handshake-file port fix (§6.7); `hasMask` in `get_layers` (§6.6); §6.8 layer-family target-identity groundwork (layerId in descriptors); port read-only commands first (`get_state`, `get_layers`, `get_document_info`) then mutating families                                                                                    | **Current checkout:** owner live harness pending. Backend-B parity remains deferred: run the same tool calls with `PHOTOSHOP_MCP_TRANSPORT=extendscript` and `uxp`, then compare normalized JSON after loading the plugin through UXP Developer Tool + Connect. |
| **M4**                  | batch mode (§8)                                                                                                                                                                                                                                                                                                                                                                         | recipe over 10 files, count exports, spot-check pixels                                                                                                                                                                                                          |
| **M5**                  | plugin distribution as signed `.ccx` (double-click install) to kill the UXP-Developer-Tool manual-load tax; until then backend B is opt-in                                                                                                                                                                                                                                              | fresh-machine install test                                                                                                                                                                                                                                      |

Upstream strategy: upstream is active (v1.4.0 July 2026). Build on branches, keep `master`
tracking upstream, and offer the transport layer as a PR series once M3 proves parity —
Zohar's call when the time comes.

## 6. Contracts the transport must pin (found in M1 live testing)

These are cross-tool semantics that must hold **identically on both backends**, encoded as
command-registry metadata (`meta` in §4.2) so the router, batch mode, and docs all consume
one source of truth:

1. **Active-layer coupling (live bug found today):** DOM `layer.duplicate()` does _not_
   activate the duplicate. In the M1 test, `duplicate_layer` → `select_subject` →
   `create_layer_mask` silently masked the auto-converted Background ("Layer 0"), not the
   duplicate — the composite looked unchanged because the unmasked copy sat on top.
   Candidate upstream fix: `duplicate_layer` should activate the copy. Until then the
   metadata (`mutatesActiveLayer`, `requiresNonBackgroundLayer`, `requiresSelection`)
   makes the coupling machine-checkable.
2. **Serialization is ROUTER-level, not backend-level (revised per Codex #5/#7):**
   `MacOSExecutor`'s FIFO queue only serializes the ExtendScript channel, and
   `executeAsModal` only serializes within one UXP call. With two channels driving one PS
   instance, mixed-backend sequences (a UXP mutation followed by an ExtendScript export)
   can reorder. The router owns **one global command queue** across both backends.
3. **Single-undo recipes:** recipes rely on ExtendScript `doc.suspendHistory()` around the
   _whole multi-step script_ (`recipes/_shared.ts:194`) — one-undo is an **operation-scoped
   boundary, not a per-command capability**. Hence `runOperation()` in §4.1: the UXP twin
   is one `executeAsModal` + history suspension around the full descriptor sequence. An
   operation cannot span backends.
4. **Units:** backend A forces px/pt around every script; batchPlay descriptors must carry
   explicit `_unit: 'pixelsUnit'` etc. Pixel semantics are part of the command contract.
5. **Dialog suppression:** not symmetric today — backend A sets `DialogModes.NO` as a
   whole-script global; batchPlay only takes per-call options (`modalBehavior`,
   `dialogOptions: 'silent'` on descriptors). The UXP `batch_play` action must apply
   silent options to _every_ descriptor, not assume a global exists.
6. **Observability gap:** `get_layers` does not report mask presence — invisible state for
   an agent (made today's bug hard to see). Add `hasMask` when porting the command.
   **M3 (done, backend A):** each layer entry now carries `hasMask`. Detection uses an
   Action Manager `UsrM`-by-id probe, _not_ the DOM `layer.hasLayerMask` property — live
   testing on PS 27.8.0 found `hasLayerMask` returns `undefined` even for masks made via
   Action Manager, so the DOM property gives false negatives. UXP twin normalizes the
   `hasUserMask` batchPlay key to the same field.
7. **Bridge port ownership:** the bridge binds only its configured port. On
   `EADDRINUSE`, startup fails closed and writes no usable handshake; it never
   selects a fallback port. This avoids reconnecting a privileged plugin to an
   unexpected listener.
8. **Target identity, not just activity flags (Codex #2):** the §6.1 metadata _detects_
   active-layer coupling but doesn't _prevent_ the bug class. batchPlay targets layers by
   ID natively; the ExtendScript DOM leans on `activeLayer`. Contract: mutating commands
   **return the affected `layerId`**, and layer-targeting commands **accept an optional
   `layerId` param** (resolved per backend), so chains like duplicate → select-subject →
   mask can bind to the layer they mean instead of whatever happens to be active.
   **M3 groundwork (done, backend B descriptors + registry metadata; live-verify deferred):**
   the layer family gets `layerId`-aware batchPlay descriptor builders in
   `src/transport/uxp-commands/descriptors.ts`, each resolving `layerId` via a native
   `{ _ref:'layer', _id }` reference (falling back to the active layer when absent):
   - **`duplicate_layer`** — `duplicateLayerDescriptor(layerId?, newName?)`; batchPlay
     returns the new layer's `layerID` (the affected-id the contract requires).
   - **`select_layer`** — `selectLayerByIdDescriptor(layerId)` (the resolve-and-target
     primitive the others compose).
   - **`create_layer_mask`** — `addLayerMaskDescriptor(layerId?, reveal)`; selects by id
     first so the mask lands on the intended layer.
   - **`set_layer_properties`** — `setLayerPropertiesDescriptor({ layerId?, opacity?,
blendMode? })`.
     Registered in `COMMAND_REGISTRY` with §6.1 metadata. Not yet routed through
     `UxpTransport.run()` — that waits on a plugin-connected session to verify result
     parsing (especially reading the returned `layerID`). The tool-signature side (mutating
     tools returning `layerId`, layer-targeting tools accepting it) is the remaining
     backend-agnostic work once parsing is confirmed.
9. **Bridge delivery needs ack/lease semantics (Codex #6):** `GET /poll` moves a command
   into a session-owned lease. A missing terminal result is never dispatched again: it is
   execution-uncertain because Photoshop may still be mutating. The bridge quarantines
   dispatch until bridge-process restart, plugin reload, and a fresh initial handshake. A late actual settlement
   receives one exact acknowledgement, after which a bounded replay tombstone rejects any
   duplicate result. Same HTTP long-poll channel — no WebSocket.

## 7. Backend B channel: keep the HTTP long-poll, don't adopt ws://3001

Both designs respect "UXP dials out only". Comparison against the adb-mcp reference
(`~/adb-mcp`, local checkout):

|           | upstream bridge (have)                           | adb-mcp proxy (reference)                                                       |
| --------- | ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Channel   | HTTP poll, 400ms plugin loop + 250ms result poll | WebSocket `ws://localhost:3001` (hardcoded)                                     |
| Processes | **in-process** with the MCP server               | separate `node proxy.js` (session-bound, the #1 support pain per research note) |
| Deps      | zero                                             | ws stack both sides                                                             |
| Latency   | ≤ ~650ms overhead/command                        | ~ms                                                                             |

Interactive tools tolerate sub-second overhead; batch amortizes it. **Decision: keep the
poll bridge**, tighten the plugin loop when a command is pending, and revisit WebSocket
only if M3 measurements hurt. What adb-mcp _is_ the reference for: its `uxp/ps/` command
handlers are a proven catalog of batchPlay descriptor shapes to crib per command, and its
manual ritual (UXP Developer Tool load per PS restart + Connect click) is the UX we must
escape via M5 `.ccx` packaging — until then backend A stays the default.

## 8. Headless batch mode (design sketch — build in M4)

Verified gap: no existing server has it (landscape research). Sits **above** the
transport; backend-agnostic by construction.

- **Recipe** = JSON: ordered list of `{ name, params }` using the _same_ command names and
  schemas as the MCP tools, plus input glob / output template
  (`{stem}`, `{index}` substitution).
- **Surfaces:** `photoshop_batch_run` MCP tool _and_ `photoshop-mcp batch recipe.json`
  CLI subcommand (bin entry exists already; add a subcommand).
- **Execution:** serial per file (PS is single-instance; the router's global queue
  enforces it): open → commands → export → close(no-save). Error policy `skip | abort`;
  per-file JSON report; progress on stdout/MCP notifications.
- **Mixed-backend honesty (Codex #5):** with open/export/preview pinned to ExtendScript,
  a batch run over backend B is a _mixed-backend transaction_, not a pure-UXP one. This is
  safe only because of the router-level global queue (§6.2) and because state lives in the
  one PS instance — but a recipe step sequence is NOT a single operation across backends
  (§6.3), so batch mode's unit of undo is the _file_, not the recipe step.
- **"Headless" means agentless, not Photoshop-less** — the PS GUI must be running; macOS
  PS has no true headless mode. True headless = Firefly Services cloud (enterprise-gated),
  which the `PhotoshopTransport` string-union id deliberately leaves room for as a
  hypothetical backend C. Out of scope now.
- **Python angle:** recipes are plain JSON — authorable from Python; a thin Python driver
  (stdio MCP client looping files) is the natural place for Zohar-side orchestration.

## 9. TypeScript comfort verdict (flag requested in the brief)

**Stay in TypeScript — no Python wrapper.** The codebase is clean and small-file
(registry + factory + error-envelope patterns, strict tsc, 1.6s builds, zod v4 already
in); the fork work is interface extraction and call-site migration, not algorithm work. A
Python wrapper would add a second process and a protocol hop, duplicate 85 schemas, and
still leave the actual hairy part — ExtendScript/batchPlay payload generation — exactly
where it is. Python enters where it pays: batch-recipe authoring and an optional batch
driver (§8).

## 10. M1 verification record (2026-07-05)

Environment: Photoshop **27.8.0 (2026)**, macOS, fork at `d76e822` (= npm v1.4.0).

| Check                                   | Result                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm install && tsc`                    | clean build                                                                                                                        |
| Fork `dist/index.js` over stdio         | Historical baseline; the current server exposes **85 tools**, 11 recipes, and 18 prompts                                           |
| `photoshop_open_image` (4032×3024 JPEG) | ✅ doc id 59                                                                                                                       |
| `photoshop_select_subject`              | ✅ `autoCutout`, clean subject isolation (verified visually via `get_preview`)                                                     |
| `photoshop_create_layer_mask`           | ✅ mask created — **on the wrong layer** (§6.1); mask itself correct                                                               |
| `photoshop_save_document` PNG export    | ✅ 4032×3024 RGBA, real alpha channel (header-verified)                                                                            |
| Also exercised                          | ping, get_version, get_state, get_layers, duplicate_layer, select_layer_by_name, set_layer_visibility, get_preview, close_document |

Live tool calls ran through the registered `photoshop-local` server (same v1.4.0 code as
the fork) plus one `get_state` through the fork's own build; both reach the same PS 2026
instance by a now-retired macOS delivery path. The current macOS executor is security-disabled.

## 11. Codex cross-review disposition (2026-07-05, gpt-5.4 @ high, read-only)

8 findings; 7 accepted and folded in above, 1 accepted as amendment rather than
replacement:

| #   | Finding                                                                                      | Disposition                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Registry duplicative; prefer `runJsx`/`runBatchPlay` channel seam, migrate tools in place    | **Amended, not replaced** — impls now co-located with tool files, registry derived (§4.2); central router kept: a pure channel seam pushes routing/pins/env-override into 85 call sites |
| 2   | `meta` booleans detect but don't prevent the active-layer bug class                          | Accepted → §6.8 target-identity contract (layerId in results/params)                                                                                                                    |
| 3   | `isUxpBridgeReachable()` lies — `/health` proves server, not plugin                          | Accepted → §4.1 truthful availability (last-poll timestamp), M2 scope                                                                                                                   |
| 4   | Parity diffing noisy while outputs are ad-hoc prose+JSON                                     | Accepted → M2 precondition: normalized envelopes                                                                                                                                        |
| 5   | Batch over backend B is a mixed-backend transaction; semantics undefined                     | Accepted → §6.2 router-level global queue + §8 honesty note                                                                                                                             |
| 6   | `/poll` dequeues pre-ack → lost commands on plugin crash                                     | Accepted → §6.9 lease/ack in M3; doesn't reopen WebSocket call                                                                                                                          |
| 7   | `executeAsModal` ≠ transport serialization; one-undo is operation-scoped                     | Accepted → `runOperation()` in §4.1, §6.3 rewritten                                                                                                                                     |
| 8   | `DialogModes.NO` global ≠ per-call `modalBehavior`; raw batchPlay results need normalization | Accepted → §6.5 rewritten, §4.2 normalization note                                                                                                                                      |

## 12. Parity verification record (2026-07-05) — CLEAN 3/3

(Supersedes the same-day blocked-state snapshot. Its "one panel-open away" verdict
was optimistic: five root causes stood between the loaded plugin and a clean diff,
all found and fixed live in the parity session.)

**Environment:** Photoshop 27.8.0 (2026), macOS/Apple Silicon; fork @
`feat/transport-m3`; plugin **v1.1.1** loaded via UXP Developer Tools; harness
`scripts/parity-uxp.ts` (self-built fixture: 2 layers, one masked, active
selection; user documents untouched).

**Result: `PARITY CLEAN — 3/3` (23:28Z).** `get_state`, `get_document_info`,
`get_layers` return deep-identical normalized payloads on both backends — including
the positive `hasMask` and `hasSelection` cases and exact pixel bounds. Report:
`scripts/output/parity-uxp-report.json`.

**What stood between "plugin loaded" and "clean" — live-found root causes:**

| #   | Failure                                                                          | Root cause                                                                                                                 | Fix                                                                                                                           |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | First command hung 30s; plugin went deaf (poll loop frozen)                      | manifest lacked `manifestVersion: 5` → legacy API v1 → `core.executeAsModal` unusable; poll loop awaited command execution | manifest v5 (+ minVersion 26); poll loop fire-and-forget + per-action watchdog + in-flight dedupe (plugin v1.1)               |
| 2   | Under v5 the plugin crashed at load: `os.tmpdir is not a function`               | manifest-v5 UXP strips `os.tmpdir` (v4 still had it — why run 1 polled at all)                                             | no module-scope `os`/`path`; handshake moved to `~/.photoshop-mcp/bridge.json` on BOTH sides, lazily resolved + guarded       |
| 3   | Plugin logged polling but zero polls reached the server                          | v5 network permissions reject the v4-style `"domains": ["127.0.0.1"]` list — every fetch threw into a silent catch         | `"domains": "all"` (adb-mcp-proven); poll failures now logged (`poll failed (#N)`) so starvation can never be invisible again |
| 4   | UDT Reload executed stale code (`VM12` frames) after a load-crash                | UDT caches the module when a load fails                                                                                    | operational rule: Unload→Load after code changes; Remove→Add after manifest changes                                           |
| 5   | Two harnesses raced on 38452/38453; the handshake's last writer owned the plugin | a parallel session launched its own harness                                                                                | one-harness-at-a-time rule; §6.7 handshake arbitrated correctly (plugin retargets every poll cycle)                           |

**Action Manager ↔ DOM quirk catalog** (live-verified; encoded in
`uxp-commands/normalize.ts` + `descriptors.ts` — these are §6-grade contracts):

- AM layer `opacity` is raw 0–255; the DOM speaks percent 0–100 (255 ↔ 100).
- AM `layerLocking` always exists as an object; DOM `locked` ⇔ `protectAll === true`.
- AM document `numberOfLayers` EXCLUDES a Background layer; DOM `layerCount` includes it.
- AM layer `_index` space: background = 0, non-background = 1..N bottom→top; an
  index past N errors the whole sync batchPlay (which is how the model was proven).
- A `get` of the document `selection` property THROWS when no selection exists — so
  it runs as its own bridge command, failure ⇒ `hasSelection: false` (merge into one
  round-trip once the plugin passes `continueOnError`).

**Historical/unverified note:** the read-only port's live-verification claims below
must be rerun by the owner for this checkout. The remaining M3 work is the
mutating-family port (§6.8 descriptors already staged), using the same harness
pattern extended with mutation fixtures.

## 13. Read-only handler flip (M3 close-out)

The `get_state`, `get_document_info`, and `get_layers` tool handlers now call
`transport.run({ name, params: { script } })` instead of `transport.runScript(script)`.
The command **name** routes through `COMMAND_REGISTRY` (all three unpinned → `auto`);
`params.script` carries the ExtendScript snippet for backend A, and the UXP switch keys
on the name for backend B. This is the exact `PsCommand` shape the parity harness proved
3/3 clean (§12), and it makes `PHOTOSHOP_MCP_TRANSPORT=uxp` route these three tools
through the batchPlay bridge end-to-end.

- **Default path unchanged:** in `auto`, ExtendScript is always available, so `run()`
  funnels into the same backend-A call as the old `runScript` path; structured results are
  parsed as strict JSON and no source-text format is evaluated.
- **Gate:** owner live harness pending. Do not treat prior pass/fail/skip totals or prior
  Photoshop-version observations as evidence for this checkout.
- **Next:** mutating-family port (§6.8) — route `duplicate_layer` / `select_layer` /
  `create_layer_mask` / `set_layer_properties` through `run()` with the layerID read-back,
  verified by the parity harness extended with mutation fixtures.
