#!/usr/bin/env pwsh
# Windows PowerShell port of scripts/parity-fix-loop.sh — UNTIL-loop for M3
# backend-B parity (docs/design/transport-layer.md A12): run the parity harness;
# while it reports diffs, hand the report to `claude -p` to fix the transport
# code, then re-run. Capped at PARITY_LOOP_MAX fix attempts.
#
# This port exists because `npm run parity:loop` invokes bare `bash`, which on
# this machine resolves to WSL bash (System32\bash.exe). WSL runs under Linux and
# cannot reach Photoshop over COM/ExtendScript, so the harness must run under
# WINDOWS node instead. `npm run parity:loop:win` runs this script in PowerShell
# so `npx tsx scripts/parity-uxp.ts` executes on the Windows node.
#
# Harness exit codes (scripts/parity-uxp.ts):
#   0 = parity clean  -> loop exits 0
#   1 = diffs found   -> fix attempt, re-run
#   2 = setup failure (no Photoshop / plugin not polling) -> abort, exit 2
#
# Prereqs (same as the harness): Photoshop 2026 running, uxp-plugin/ loaded via
# UXP Developer Tools with its panel opened once so the poll loop is live.
#
# Usage:
#   npm run parity:loop:win                                  # real run
#   powershell -File scripts/parity-fix-loop.ps1 -DryRun     # loop-logic test
#
# Env overrides: PARITY_LOOP_MAX (default 6), PARITY_CMD, CLAUDE_CMD

param([switch]$DryRun)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$MaxFixAttempts = if ($env:PARITY_LOOP_MAX) { [int]$env:PARITY_LOOP_MAX } else { 6 }
$ParityCmd = if ($env:PARITY_CMD) { $env:PARITY_CMD } else { "npx tsx scripts/parity-uxp.ts" }
$ClaudeCmd = if ($env:CLAUDE_CMD) { $env:CLAUDE_CMD } else { "claude" }
$Report = "scripts/output/parity-uxp-report.json"
$LogDir = "scripts/output/parity-loop"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$RunDir = Join-Path $LogDir $Stamp
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

# Dry runs must never clobber the real harness report.
if ($DryRun) { $Report = Join-Path $RunDir "dry-parity-report.json" }

function Write-Log($msg) { Write-Host "[parity-loop] $msg" }

# Split a command string into its executable and argument list, mirroring the
# shell's word-splitting of $PARITY_CMD / $CLAUDE_CMD.
function Invoke-Tokens($cmdString, $extraArgs) {
  $tokens = $cmdString -split '\s+' | Where-Object { $_ -ne '' }
  $exe = $tokens[0]
  $argList = @()
  if ($tokens.Count -gt 1) { $argList += $tokens[1..($tokens.Count - 1)] }
  if ($extraArgs) { $argList += $extraArgs }
  & $exe @argList
  return $LASTEXITCODE
}

function Invoke-Parity {
  if ($DryRun) {
    # Dry run: first check is dirty (writes a fake report), second is clean.
    $marker = Join-Path $RunDir ".dry-check-done"
    if (-not (Test-Path $marker)) {
      New-Item -ItemType File -Force -Path $marker | Out-Null
      @'
{
  "ranAt": "dry-run",
  "fixture": "dry-run",
  "results": [
    {
      "command": "get_layers",
      "clean": false,
      "diffs": ["$.layers[1].opacity: A=100 B=255"]
    }
  ]
}
'@ | Set-Content -Path $Report -Encoding UTF8
      return 1
    }
    return 0
  }
  return (Invoke-Tokens $ParityCmd $null)
}

function Invoke-Fixer($attempt) {
  $reportJson = Get-Content $Report -Raw
  $prompt = @"
You are inside the photoshop-mcp repo. The M3 extendscript-vs-uxp transport
parity harness (scripts/parity-uxp.ts) just ran and found diffs between backend A
(ExtendScript) and backend B (UXP batchPlay). Fix attempt $attempt of $MaxFixAttempts.

Full parity report (backend A payloads are the ground truth):
$reportJson

Task: make backend B's normalized payloads identical to backend A's.
- Fix ONLY the backend-B side: src/transport/uxp-transport.ts,
  src/transport/uxp-commands/ (normalize.ts, descriptors.ts), and if truly
  required the uxp-plugin/ command handlers.
- Do NOT change backend A (ExtendScript) behavior, tool names, tool schemas, or
  error envelopes. Do NOT touch security tombstones (docs/security-boundaries.md).
- Known unit gotchas are documented in docs/design/transport-layer.md ('AM vs DOM'):
  opacity 0-255 vs percent, layerLocking vs locked, numberOfLayers vs layerCount,
  _index spaces, selection get throwing when empty.
- After editing, run: npm run build:server && npm run test:uxp-normalize
  and fix any failures.
Do not run scripts/parity-uxp.ts yourself -- the outer loop re-runs it.
"@
  if ($DryRun) {
    Write-Log "(dry-run) would invoke: $ClaudeCmd -p <prompt> ($($prompt.Length) chars)"
    return
  }
  $tokens = $ClaudeCmd -split '\s+' | Where-Object { $_ -ne '' }
  $exe = $tokens[0]
  $argList = @()
  if ($tokens.Count -gt 1) { $argList += $tokens[1..($tokens.Count - 1)] }
  $argList += @(
    "-p", $prompt,
    "--allowedTools", "Read,Grep,Glob,Edit,Write,Bash(npm run build:server),Bash(npm run test:uxp-normalize)"
  )
  & $exe @argList 2>&1 | Tee-Object -FilePath (Join-Path $RunDir "fix-attempt-$attempt.log")
}

$attempt = 0
while ($true) {
  Write-Log "Parity check (fix attempts so far: $attempt/$MaxFixAttempts)..."
  $code = Invoke-Parity
  switch ($code) {
    0 {
      Write-Log "PARITY CLEAN after $attempt fix attempt(s). Done."
      exit 0
    }
    2 {
      Write-Log "Setup failure (exit 2) -- Photoshop not running or UXP plugin not polling."
      Write-Log "Fix the environment (launch PS, load uxp-plugin/ in UDT, open its panel) and re-run."
      exit 2
    }
    1 {
      Copy-Item $Report (Join-Path $RunDir "report-after-check-$attempt.json") -ErrorAction SilentlyContinue
      if ($attempt -ge $MaxFixAttempts) {
        Write-Log "PARITY STILL DIRTY after $MaxFixAttempts fix attempts -- stopping."
        Write-Log "Reports and fixer logs: $RunDir"
        exit 1
      }
      $attempt++
      Write-Log "Diffs found -- fix attempt $attempt/$MaxFixAttempts via claude -p..."
      Invoke-Fixer $attempt
    }
    default {
      Write-Log "Unexpected harness exit code $code -- stopping."
      exit $code
    }
  }
}
