/**
 * Headless batch engine (transport-layer.md §8).
 *
 * A "recipe" is an ordered list of { name, params } steps using the SAME tool
 * names and schemas as the MCP tools, plus an input glob and an output-path
 * template. Batch mode sits ABOVE the transport: it drives the real tool
 * handlers (src/tools/tool-roster.ts) for every step — it does not reimplement
 * any command. Per file the engine runs: open -> each recipe step -> export ->
 * close(no-save), serially, because Photoshop is single-instance and the
 * router's one global command queue (§6.2) enforces ordering.
 *
 * Honest constraints (§8):
 *   - "Headless" = agentless, NOT Photoshop-less. The PS GUI must be running;
 *     macOS Photoshop has no true headless mode. True headless would be a
 *     Firefly-cloud backend C (see ./batch-firefly.ts) — out of scope, stubbed.
 *   - Unit of undo is the FILE, not the recipe step: a recipe is a mixed-backend
 *     transaction (open/export pinned to ExtendScript) and an operation cannot
 *     span backends (§6.3), so steps are not wrapped in one history scope.
 */
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { globSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { ToolDefinition } from '../core/tool-registry.js';
import { wrapToolHandler } from '../errors/envelope.js';
import type { TransportRouter } from '../transport/index.js';
import { buildCommandToolDefinitions } from './tool-roster.js';

export type BatchErrorPolicy = 'skip' | 'abort';

/** One recipe step: a tool name plus the params that tool's schema expects. */
export interface RecipeStep {
  name: string;
  params?: Record<string, unknown>;
}

/**
 * A batch recipe. `inputGlob` and `outputTemplate` may live in the recipe file
 * or be supplied by the caller (caller value wins). `open`/`export`/`close`
 * around each file are engine-managed — the steps are the per-file edits only.
 */
export interface Recipe {
  /** Ordered edit steps applied to each opened file. */
  steps: RecipeStep[];
  /** Glob of input image files (absolute, or relative to `baseDir`). */
  inputGlob?: string;
  /**
   * Output path template with {stem} (input filename sans extension) and
   * {index} (1-based, zero-padded) substitution. Extension picks the export
   * format: .png -> PNG, .jpg/.jpeg -> JPEG, else PSD.
   */
  outputTemplate?: string;
  /** 'skip' (default) continues to the next file on error; 'abort' stops. */
  errorPolicy?: BatchErrorPolicy;
}

export interface BatchRunOptions {
  recipe: Recipe;
  /** Overrides recipe.inputGlob when set. */
  inputGlob?: string;
  /** Overrides recipe.outputTemplate when set. */
  outputTemplate?: string;
  /** Overrides recipe.errorPolicy when set. */
  errorPolicy?: BatchErrorPolicy;
  /**
   * Base directory for resolving a relative inputGlob / outputTemplate. In CLI
   * mode this is the recipe file's directory; for the MCP tool with an inline
   * recipe it is the process cwd.
   */
  baseDir?: string;
  /** Progress sink. Defaults to stderr (safe under the stdio MCP protocol). */
  onProgress?: (event: BatchProgressEvent) => void;
}

export type BatchProgressEvent =
  | { type: 'batch_start'; files: number }
  | { type: 'file_start'; index: number; total: number; input: string }
  | { type: 'step'; index: number; total: number; step: string; stepIndex: number; steps: number }
  | { type: 'file_done'; index: number; total: number; status: FileStatus; output?: string; error?: string }
  | { type: 'batch_done'; ok: number; failed: number; skipped: number };

export type FileStatus = 'ok' | 'failed' | 'skipped';

export interface StepResult {
  name: string;
  ok: boolean;
  error?: string;
}

export interface FileReport {
  input: string;
  output?: string;
  status: FileStatus;
  steps: StepResult[];
  error?: string;
  /** Wall-clock time for this file, ms. */
  durationMs: number;
}

export interface BatchReport {
  ok: boolean;
  totalFiles: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errorPolicy: BatchErrorPolicy;
  files: FileReport[];
  /** Present when errorPolicy=abort stopped the run early. */
  aborted?: boolean;
}

/** Map of tool name -> wrapped handler, built once from the shared roster. */
export type ToolHandlerMap = Map<string, ToolDefinition['handler']>;

export function buildToolHandlerMap(transport: TransportRouter): ToolHandlerMap {
  const map: ToolHandlerMap = new Map();
  for (const def of buildCommandToolDefinitions(transport)) {
    // Wrap so batch steps get the exact same error envelopes as the MCP path.
    map.set(def.tool.name, wrapToolHandler(def.tool.name, def.handler));
  }
  return map;
}

function defaultProgress(event: BatchProgressEvent): void {
  process.stderr.write(`[batch] ${JSON.stringify(event)}\n`);
}

/** True when a tool result signalled failure (handlers return isError, not throw). */
function resultIsError(result: CallToolResult): boolean {
  return result.isError === true;
}

function resultText(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function padIndex(index: number, total: number): string {
  const width = String(total).length;
  return String(index).padStart(width, '0');
}

/** Substitute {stem} / {index} in an output template. */
export function renderOutputPath(
  template: string,
  inputPath: string,
  index: number,
  total: number
): string {
  const stem = basename(inputPath, extname(inputPath));
  return template
    .replace(/\{stem\}/g, stem)
    .replace(/\{index\}/g, padIndex(index, total));
}

/** Export format for `photoshop_save_document`, inferred from output extension. */
export function formatForOutput(outputPath: string): 'PNG' | 'JPEG' | 'PSD' {
  const ext = extname(outputPath).toLowerCase();
  if (ext === '.png') return 'PNG';
  if (ext === '.jpg' || ext === '.jpeg') return 'JPEG';
  return 'PSD';
}

function absolutize(p: string, baseDir: string): string {
  return isAbsolute(p) ? p : resolve(baseDir, p);
}

/**
 * Expand the input glob to a sorted list of absolute file paths. A relative
 * glob is resolved against baseDir. Sorting makes {index} deterministic.
 */
export function expandInputs(glob: string, baseDir: string): string[] {
  const abs = absolutize(glob, baseDir);
  const matches = globSync(abs) as string[];
  return matches.map((m) => absolutize(m, baseDir)).sort();
}

/**
 * Run a recipe over every file matched by the input glob. Serial by design.
 * Returns a per-file JSON report; never throws for per-file failures — those
 * are captured in the report (errorPolicy governs whether the run continues).
 * Throws only for setup errors (no glob, no template, no matches).
 */
export async function runBatch(
  handlers: ToolHandlerMap,
  options: BatchRunOptions
): Promise<BatchReport> {
  const baseDir = options.baseDir ?? process.cwd();
  const onProgress = options.onProgress ?? defaultProgress;
  const errorPolicy: BatchErrorPolicy =
    options.errorPolicy ?? options.recipe.errorPolicy ?? 'skip';

  const inputGlob = options.inputGlob ?? options.recipe.inputGlob;
  const outputTemplate = options.outputTemplate ?? options.recipe.outputTemplate;

  if (!inputGlob) {
    throw new Error('batch: no inputGlob provided (set it in the recipe or pass it in)');
  }
  if (!outputTemplate) {
    throw new Error('batch: no outputTemplate provided (set it in the recipe or pass it in)');
  }
  if (!Array.isArray(options.recipe.steps)) {
    throw new Error('batch: recipe.steps must be an array of { name, params }');
  }

  // Validate every step names a real tool before touching Photoshop (fail fast).
  for (const step of options.recipe.steps) {
    if (!step || typeof step.name !== 'string') {
      throw new Error('batch: every recipe step needs a string "name"');
    }
    if (!handlers.has(step.name)) {
      throw new Error(`batch: unknown tool in recipe step: "${step.name}"`);
    }
  }

  const inputs = expandInputs(inputGlob, baseDir);
  if (inputs.length === 0) {
    throw new Error(`batch: input glob matched no files: ${inputGlob}`);
  }

  const total = inputs.length;
  onProgress({ type: 'batch_start', files: total });

  const openHandler = handlers.get('photoshop_open_image')!;
  const saveHandler = handlers.get('photoshop_save_document')!;
  const closeHandler = handlers.get('photoshop_close_document')!;

  const files: FileReport[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let aborted = false;

  for (let i = 0; i < inputs.length; i++) {
    const index = i + 1;
    const input = inputs[i];
    const started = Date.now();
    onProgress({ type: 'file_start', index, total, input });

    const steps: StepResult[] = [];
    let output: string | undefined;
    let status: FileStatus = 'ok';
    let fileError: string | undefined;
    let opened = false;

    try {
      // open -----------------------------------------------------------------
      const openResult = await openHandler({ filePath: input });
      if (resultIsError(openResult)) {
        throw new Error(`open failed: ${resultText(openResult)}`);
      }
      opened = true;

      // recipe steps ----------------------------------------------------------
      for (let s = 0; s < options.recipe.steps.length; s++) {
        const step = options.recipe.steps[s];
        onProgress({
          type: 'step',
          index,
          total,
          step: step.name,
          stepIndex: s + 1,
          steps: options.recipe.steps.length,
        });
        const stepResult = await handlers.get(step.name)!(step.params ?? {});
        if (resultIsError(stepResult)) {
          const msg = resultText(stepResult);
          steps.push({ name: step.name, ok: false, error: msg });
          throw new Error(`step "${step.name}" failed: ${msg}`);
        }
        steps.push({ name: step.name, ok: true });
      }

      // export ----------------------------------------------------------------
      output = renderOutputPath(outputTemplate, input, index, total);
      mkdirSync(dirname(output), { recursive: true });
      const format = formatForOutput(output);
      const saveResult = await saveHandler({ path: output, format });
      if (resultIsError(saveResult)) {
        throw new Error(`export failed: ${resultText(saveResult)}`);
      }
    } catch (err) {
      status = errorPolicy === 'abort' ? 'failed' : 'skipped';
      fileError = err instanceof Error ? err.message : String(err);
    } finally {
      // close(no-save) — always, so the next file opens cleanly. A close failure
      // does not override a successful edit's status but is recorded.
      if (opened) {
        try {
          const closeResult = await closeHandler({ save: false });
          if (resultIsError(closeResult) && !fileError) {
            status = errorPolicy === 'abort' ? 'failed' : 'skipped';
            fileError = `close failed: ${resultText(closeResult)}`;
          }
        } catch (closeErr) {
          if (!fileError) {
            status = errorPolicy === 'abort' ? 'failed' : 'skipped';
            fileError = `close failed: ${closeErr instanceof Error ? closeErr.message : String(closeErr)}`;
          }
        }
      }
    }

    const report: FileReport = {
      input,
      status,
      steps,
      durationMs: Date.now() - started,
      ...(output && status === 'ok' ? { output } : {}),
      ...(fileError ? { error: fileError } : {}),
    };
    files.push(report);

    if (status === 'ok') succeeded++;
    else if (status === 'failed') failed++;
    else skipped++;

    onProgress({
      type: 'file_done',
      index,
      total,
      status,
      ...(report.output ? { output: report.output } : {}),
      ...(fileError ? { error: fileError } : {}),
    });

    if (status !== 'ok' && errorPolicy === 'abort') {
      aborted = true;
      break;
    }
  }

  onProgress({ type: 'batch_done', ok: succeeded, failed, skipped });

  return {
    ok: failed === 0,
    totalFiles: total,
    succeeded,
    failed,
    skipped,
    errorPolicy,
    files,
    ...(aborted ? { aborted: true } : {}),
  };
}
