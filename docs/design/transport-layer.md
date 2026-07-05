# Transport Layer Design — Swappable Backends

- **Status:** proposed (M1 deliverable, 2026-07-05)
- **Fork:** `zohartito/photoshop-mcp` ← upstream `alisaitteke/photoshop-mcp` v1.4.0 (`d76e822`)
- **Context:** vault ADR `2026-07-05_photoshop-mcp-adopt-then-extend.md`, research note `2026-07-05_photoshop-mcp-landscape.md`
- **Verified against:** Photoshop 27.8.0 (2026), macOS, Apple Silicon — see §10

## 1. Goal

Keep all **87 MCP tool signatures stable** while making HOW a command reaches Photoshop
swappable:

- **Backend A — ExtendScript** (today): AppleScript `do javascript` on macOS, COM on
  Windows. Works now; Adobe retired ESTK and could retire the engine, so it is the
  long-term-deprecation-risk path.
- **Backend B — UXP batchPlay** (migration path): companion UXP plugin + local bridge.
  UXP plugins can only dial **out** as clients — they can never listen — so any bridge is
  "server on our side, plugin polls/connects in" (same constraint that shapes
  mikechambers/adb-mcp's `ws://localhost:3001` proxy).

Secondary goal (designed here, built later): a **headless batch mode** — queue N files
through a recipe and export — which sits *above* the transport and works on either backend.

## 2. What v1.4.0 already has (codebase map)

The surprise of M1: upstream already runs **two transports**, ad-hoc.

### Path A — ExtendScript (84 of 87 tools)

```
src/tools/*.ts            20 of 22 tool files generate ExtendScript strings
                          (helpers + snippet library: src/api/extendscript.ts, 2,467 lines)
        │  runSnippet(connection, script)          src/tools/atomic-shared.ts
        ▼
src/api/photoshop-api.ts  PhotoshopAPIFactory — determineAPIType() HARDCODES 'ExtendScript';
                          ExtendScriptPhotoshopAPI.wrapInErrorHandling() adds:
                          px/pt unit forcing, DialogModes.NO, alert/confirm/prompt shims,
                          "ERROR:" string protocol, toSource() result serialization
        ▼
src/platform/connection.ts  PhotoshopConnection — detect / launch / delegate
        ▼
src/platform/script-executor.ts  interface ScriptExecutor { execute(script), … }
        ├─ macos-executor.ts    temp .jsx + temp .scpt → osascript
        │                       `tell app … do javascript $.evalFile(...)`;
        │                       FIFO queue serializes all script execution
        └─ windows-executor.ts  temp .jsx + temp .vbs → cscript → COM Photoshop.Application
```

### Path B — UXP bridge (3 tools: neural filters + part of enhance-portrait)

```
src/tools/neural-tools.ts / recipes/enhance-portrait.ts
        ▼  invokeNeuralFilter()                    src/platform/uxp-bridge-client.ts
src/platform/uxp-bridge-server.ts   in-process HTTP server on 127.0.0.1:38452
                                    (env PHOTOSHOP_UXP_BRIDGE_PORT; EADDRINUSE → port+1)
                                    command queue + result map; caller polls results @250ms
        ▲  GET /poll (400ms loop) · POST /result
uxp-plugin/ (manifest minVersion 24.0, panel with manual Connect button)
        main.js: hardcoded per-filter switch → batchPlay(neuralDescriptors)
```

### Dead / aspirational code (evidence the author wants this too)

| File | State |
|---|---|
| `src/api/batch-play.ts` | descriptor helpers + `generateBatchPlayScript()` — **imported by nothing** |
| `photoshop-api.ts` `UXPPhotoshopAPI` | stub, falls back to ExtendScript, "kept for future plugin-based implementation" |
| `macos-executor.ts` `executeViaDoShellScript` | unused alternate delivery |

### The injection point

`src/core/server.ts:113` — one `PhotoshopConnection` from `Session` is passed into all 18
`create*Tools(connection)` factories. **Single choke point**: swap what flows through here
and every tool follows.

## 3. Why the existing seam is at the wrong altitude

`ScriptExecutor` abstracts *delivery of an ExtendScript string* (osascript vs COM). A UXP
backend cannot execute ExtendScript at all — batchPlay consumes ActionDescriptor JSON.
Two concerns are conflated today:

| Concern | Backend A | Backend B |
|---|---|---|
| **Payload language** | ExtendScript source string | batchPlay descriptors / UXP JS |
| **Delivery channel** | osascript / COM, temp files | localhost HTTP poll (or WS) to plugin |

The swappable seam must sit at the **command** level — above payload generation — not at
the script-string level. `ScriptExecutor` survives unchanged as an internal detail *inside*
the ExtendScript backend; the HTTP bridge survives as the channel *inside* the UXP backend.

## 4. Proposed design

### 4.1 Interfaces

```ts
// src/transport/types.ts
export interface PsCommand {
  name: string;                    // e.g. 'create_layer_mask'
  params: Record<string, unknown>; // validated with zod (already a dep, ^4.4.3)
  timeoutMs?: number;
}

export interface PhotoshopTransport {
  readonly id: 'extendscript' | 'uxp';       // room for 'firefly' later
  isAvailable(): Promise<boolean>;            // PS detected / plugin connected — see caveat below
  capabilities(): Promise<TransportCapabilities>;
  run(command: PsCommand): Promise<unknown>;  // parsed JSON result — never raw strings
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

Result normalization moves inside each transport: the ExtendScript backend keeps the
`"ERROR:"` protocol, `toSource()` parsing (`parseExtendScriptPayload`) and unit-forcing
wrapper internal; the UXP backend keeps bridge JSON envelopes internal. Tools stop
knowing which they got.

### 4.2 Command registry

Each command registers per-backend implementations. The existing 2,467-line snippet
library and per-tool script generation are **reused verbatim** as the `extendscript`
implementations — no rewrite:

```ts
// src/transport/commands/create-layer-mask.ts
registerCommand({
  name: 'create_layer_mask',
  meta: { mutatesActiveLayer: false, requiresSelection: true,
          requiresNonBackgroundLayer: true },              // see §6
  extendscript: (p) => ExtendScriptSnippets.createLayerMask(p),  // today's code, moved
  uxp:          (p) => ({ action: 'batch_play', descriptors: makeMaskDescriptors(p) }),
});
```

**Where command specs live (revised per Codex finding #1):** per-backend implementations
are **co-located with the tool files** that own them — the ExtendScript generator is
already there — not authored in a parallel `src/transport/commands/` tree. The registry is
*derived* at registration time, avoiding a second 87-entry taxonomy to keep in sync. The
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
- **Pinned commands:** `execute_script` and preview/export (binary temp-file dance) stay
  `extendscript`-only; neural filters and future generative APIs stay `uxp`-only. Pins are
  command-registry metadata, which is exactly why routing must be per-command, not a
  global switch.
- Global env override exists for the side-by-side verification harness (§5).

### 4.4 Tool-factory migration

`create*Tools(connection: PhotoshopConnection)` →
`create*Tools(transport: TransportRouter)`. One mechanical sweep; tool names, schemas,
descriptions, and error envelopes are untouched. MCP clients cannot tell the difference.

## 5. Phasing

| Milestone | Content | Verification |
|---|---|---|
| **M1 (done)** | fork, map, live-verify A, this doc | §10 matrix |
| **M2** | `src/transport/` interfaces + `ExtendScriptTransport` wrapping existing code + router with **one global queue**; truthful UXP `isAvailable()`; move neural bridge behind `UxpTransport`; routing table 100% extendscript except neural. **Precondition for M3 parity testing (Codex #4):** normalize tool results to stable JSON envelopes — several tools still emit ad-hoc prose+JSON | `scripts/test-all-mcp-tools.ts` passes unchanged (zero behavior change) |
| **M3 (code-half done)** | generic `batch_play` plugin action + poll lease/ack + handshake-file port fix (§6.7); `hasMask` in `get_layers` (§6.6); §6.8 layer-family target-identity groundwork (layerId in descriptors); port read-only commands first (`get_state`, `get_layers`, `get_document_info`) then mutating families | **Backend-A gate (done, this run):** `build:server` strict clean + `scripts/test-all-mcp-tools.ts` reproduces the M2 baseline **118 pass / 2 fail / 11 skip** exactly; `hasMask` live-verified on PS 27.8.0; normalizer unit-checked (`test:uxp-normalize`). **Backend-B parity (deferred):** same tool calls, `PHOTOSHOP_MCP_TRANSPORT=extendscript` vs `uxp`, diff normalized JSON — needs the plugin loaded via UXP Developer Tool + Connect |
| **M4** | batch mode (§8) | recipe over 10 files, count exports, spot-check pixels |
| **M5** | plugin distribution as signed `.ccx` (double-click install) to kill the UXP-Developer-Tool manual-load tax; until then backend B is opt-in | fresh-machine install test |

Upstream strategy: upstream is active (v1.4.0 July 2026). Build on branches, keep `master`
tracking upstream, and offer the transport layer as a PR series once M3 proves parity —
Zohar's call when the time comes.

## 6. Contracts the transport must pin (found in M1 live testing)

These are cross-tool semantics that must hold **identically on both backends**, encoded as
command-registry metadata (`meta` in §4.2) so the router, batch mode, and docs all consume
one source of truth:

1. **Active-layer coupling (live bug found today):** DOM `layer.duplicate()` does *not*
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
   *whole multi-step script* (`recipes/_shared.ts:194`) — one-undo is an **operation-scoped
   boundary, not a per-command capability**. Hence `runOperation()` in §4.1: the UXP twin
   is one `executeAsModal` + history suspension around the full descriptor sequence. An
   operation cannot span backends.
4. **Units:** backend A forces px/pt around every script; batchPlay descriptors must carry
   explicit `_unit: 'pixelsUnit'` etc. Pixel semantics are part of the command contract.
5. **Dialog suppression:** not symmetric today — backend A sets `DialogModes.NO` as a
   whole-script global; batchPlay only takes per-call options (`modalBehavior`,
   `dialogOptions: 'silent'` on descriptors). The UXP `batch_play` action must apply
   silent options to *every* descriptor, not assume a global exists.
6. **Observability gap:** `get_layers` does not report mask presence — invisible state for
   an agent (made today's bug hard to see). Add `hasMask` when porting the command.
   **M3 (done, backend A):** each layer entry now carries `hasMask`. Detection uses an
   Action Manager `UsrM`-by-id probe, *not* the DOM `layer.hasLayerMask` property — live
   testing on PS 27.8.0 found `hasLayerMask` returns `undefined` even for masks made via
   Action Manager, so the DOM property gives false negatives. UXP twin normalizes the
   `hasUserMask` batchPlay key to the same field.
7. **Bridge port drift (latent bug):** the server auto-increments its port on
   `EADDRINUSE`, but `uxp-plugin/main.js` hardcodes `38452` → silent disconnect. Fix in
   M3 (handshake file or fail-loud), or at minimum document.
   **M3 (done): handshake file chosen over fail-loud.** On listen the server writes the
   real bound port to `${os.tmpdir()}/photoshop-mcp-bridge.json`; the plugin reads it each
   poll cycle and retargets. Rationale: fail-loud (refuse to increment, exit on
   `EADDRINUSE`) would take the whole in-process MCP server — and backend A, the default
   live-verified path — down whenever a stale process holds 38452, violating the
   "backend A must not regress" gate. The handshake file keeps the auto-increment
   resilience *and* lets the plugin follow a port change without a reload.
8. **Target identity, not just activity flags (Codex #2):** the §6.1 metadata *detects*
   active-layer coupling but doesn't *prevent* the bug class. batchPlay targets layers by
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
9. **Bridge delivery needs ack/lease semantics (Codex #6):** `GET /poll` dequeues the
   command before the plugin acknowledges execution (`uxp-bridge-server.ts:55`) — a plugin
   crash after fetch silently loses the command and the caller burns the full timeout.
   Cheap fix in M3: lease on poll, requeue on missing ack. This doesn't reopen the
   WebSocket question (§7) — reliability is orthogonal to the channel.
   **M3 (done):** `GET /poll` now *leases* the command (moves it to a `leased` map with a
   timestamp) instead of dropping it; the plugin's `POST /result` is the ack and clears
   the lease. A lease with no result older than `LEASE_TTL_MS` (10s) is requeued on the
   next poll. Caller timeout purges the command from pending/leased/results. Same HTTP
   long-poll channel — no WebSocket.

## 7. Backend B channel: keep the HTTP long-poll, don't adopt ws://3001

Both designs respect "UXP dials out only". Comparison against the adb-mcp reference
(`~/adb-mcp`, local checkout):

| | upstream bridge (have) | adb-mcp proxy (reference) |
|---|---|---|
| Channel | HTTP poll, 400ms plugin loop + 250ms result poll | WebSocket `ws://localhost:3001` (hardcoded) |
| Processes | **in-process** with the MCP server | separate `node proxy.js` (session-bound, the #1 support pain per research note) |
| Deps | zero | ws stack both sides |
| Latency | ≤ ~650ms overhead/command | ~ms |

Interactive tools tolerate sub-second overhead; batch amortizes it. **Decision: keep the
poll bridge**, tighten the plugin loop when a command is pending, and revisit WebSocket
only if M3 measurements hurt. What adb-mcp *is* the reference for: its `uxp/ps/` command
handlers are a proven catalog of batchPlay descriptor shapes to crib per command, and its
manual ritual (UXP Developer Tool load per PS restart + Connect click) is the UX we must
escape via M5 `.ccx` packaging — until then backend A stays the default.

## 8. Headless batch mode (design sketch — build in M4)

Verified gap: no existing server has it (landscape research). Sits **above** the
transport; backend-agnostic by construction.

- **Recipe** = JSON: ordered list of `{ name, params }` using the *same* command names and
  schemas as the MCP tools, plus input glob / output template
  (`{stem}`, `{index}` substitution).
- **Surfaces:** `photoshop_batch_run` MCP tool *and* `photoshop-mcp batch recipe.json`
  CLI subcommand (bin entry exists already; add a subcommand).
- **Execution:** serial per file (PS is single-instance; the router's global queue
  enforces it): open → commands → export → close(no-save). Error policy `skip | abort`;
  per-file JSON report; progress on stdout/MCP notifications.
- **Mixed-backend honesty (Codex #5):** with open/export/preview pinned to ExtendScript,
  a batch run over backend B is a *mixed-backend transaction*, not a pure-UXP one. This is
  safe only because of the router-level global queue (§6.2) and because state lives in the
  one PS instance — but a recipe step sequence is NOT a single operation across backends
  (§6.3), so batch mode's unit of undo is the *file*, not the recipe step.
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
Python wrapper would add a second process and a protocol hop, duplicate 87 schemas, and
still leave the actual hairy part — ExtendScript/batchPlay payload generation — exactly
where it is. Python enters where it pays: batch-recipe authoring and an optional batch
driver (§8).

## 10. M1 verification record (2026-07-05)

Environment: Photoshop **27.8.0 (2026)**, macOS, fork at `d76e822` (= npm v1.4.0).

| Check | Result |
|---|---|
| `npm install && tsc` | clean build |
| Fork `dist/index.js` over stdio | `initialize` OK, `tools/list` = **87 tools**, `tools/call get_state` reached live PS |
| `photoshop_open_image` (4032×3024 JPEG) | ✅ doc id 59 |
| `photoshop_select_subject` | ✅ `autoCutout`, clean subject isolation (verified visually via `get_preview`) |
| `photoshop_create_layer_mask` | ✅ mask created — **on the wrong layer** (§6.1); mask itself correct |
| `photoshop_save_document` PNG export | ✅ 4032×3024 RGBA, real alpha channel (header-verified) |
| Also exercised | ping, get_version, get_state, get_layers, duplicate_layer, select_layer_by_name, set_layer_visibility, get_preview, close_document |

Live tool calls ran through the registered `photoshop-local` server (same v1.4.0 code as
the fork) plus one `get_state` through the fork's own build; both reach the same PS 2026
instance by the same osascript path.

## 11. Codex cross-review disposition (2026-07-05, gpt-5.4 @ high, read-only)

8 findings; 7 accepted and folded in above, 1 accepted as amendment rather than
replacement:

| # | Finding | Disposition |
|---|---|---|
| 1 | Registry duplicative; prefer `runJsx`/`runBatchPlay` channel seam, migrate tools in place | **Amended, not replaced** — impls now co-located with tool files, registry derived (§4.2); central router kept: a pure channel seam pushes routing/pins/env-override into 87 call sites |
| 2 | `meta` booleans detect but don't prevent the active-layer bug class | Accepted → §6.8 target-identity contract (layerId in results/params) |
| 3 | `isUxpBridgeReachable()` lies — `/health` proves server, not plugin | Accepted → §4.1 truthful availability (last-poll timestamp), M2 scope |
| 4 | Parity diffing noisy while outputs are ad-hoc prose+JSON | Accepted → M2 precondition: normalized envelopes |
| 5 | Batch over backend B is a mixed-backend transaction; semantics undefined | Accepted → §6.2 router-level global queue + §8 honesty note |
| 6 | `/poll` dequeues pre-ack → lost commands on plugin crash | Accepted → §6.9 lease/ack in M3; doesn't reopen WebSocket call |
| 7 | `executeAsModal` ≠ transport serialization; one-undo is operation-scoped | Accepted → `runOperation()` in §4.1, §6.3 rewritten |
| 8 | `DialogModes.NO` global ≠ per-call `modalBehavior`; raw batchPlay results need normalization | Accepted → §6.5 rewritten, §4.2 normalization note |
