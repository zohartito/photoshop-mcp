/**
 * `photoshop_batch_run` MCP tool (transport-layer.md §8).
 *
 * Applies a recipe (an ordered list of tool-name/params steps) to every file
 * matched by an input glob, exporting each to a templated output path. The tool
 * is a thin wrapper over the shared batch engine (./batch-engine.ts); the same
 * engine backs the `photoshop-mcp batch <recipe.json>` CLI subcommand.
 *
 * "Headless" here means agentless, not Photoshop-less: the PS GUI must be
 * running (macOS PS has no true headless mode). Batch mode's unit of undo is the
 * FILE, not the recipe step (§8).
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { TransportRouter } from '../transport/index.js';
import {
  buildToolHandlerMap,
  runBatch,
  type BatchErrorPolicy,
  type Recipe,
} from './batch-engine.js';

/**
 * Resolve the `recipe` argument, which may be:
 *   - an inline recipe object,
 *   - an inline recipe JSON string,
 *   - a path to a .json recipe file (absolute, or relative to `baseDir`).
 * Returns the parsed recipe and the baseDir used to resolve relative
 * glob/template (the recipe file's directory when loaded from disk).
 */
export function resolveRecipe(
  recipeArg: unknown,
  baseDir: string
): { recipe: Recipe; baseDir: string } {
  if (recipeArg && typeof recipeArg === 'object') {
    return { recipe: recipeArg as Recipe, baseDir };
  }

  if (typeof recipeArg === 'string') {
    const trimmed = recipeArg.trim();
    // An inline JSON string starts with '{'. Otherwise treat it as a file path.
    if (trimmed.startsWith('{')) {
      return { recipe: JSON.parse(trimmed) as Recipe, baseDir };
    }
    const path = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed);
    const raw = readFileSync(path, 'utf8');
    return { recipe: JSON.parse(raw) as Recipe, baseDir: dirname(path) };
  }

  throw new Error('batch: "recipe" must be an object, a JSON string, or a path to a .json file');
}

function normalizeErrorPolicy(raw: unknown): BatchErrorPolicy | undefined {
  if (raw === 'skip' || raw === 'abort') return raw;
  return undefined;
}

export function createBatchTools(transport: TransportRouter): ToolDefinition[] {
  const handlers = buildToolHandlerMap(transport);

  return [
    {
      tool: {
        name: 'photoshop_batch_run',
        description:
          'Run a recipe (ordered tool steps) over many image files headlessly.\n\n' +
          'A recipe is JSON: { steps: [{ name, params }], inputGlob?, outputTemplate?, errorPolicy? }. ' +
          'Step names/params are the SAME as the individual photoshop_* tools. Per file the run does: ' +
          'open -> each step -> export -> close(no-save), serially.\n\n' +
          'Use when: applying the same edits to a folder of images (resize, watermark, adjust, export variants).\n' +
          'Do NOT use when: editing a single already-open document — call the individual tools.\n\n' +
          'outputTemplate supports {stem} (input filename without extension) and {index} (1-based, zero-padded); ' +
          'the extension picks the export format (.png/.jpg/.jpeg/.psd).\n\n' +
          'Returns: a per-file JSON report (status, per-step results, output path, timing).\n' +
          'Preconditions: Photoshop GUI must be running (headless = agentless, not Photoshop-less). ' +
          'Side effects: opens/edits/exports/closes each file; unit of undo is the file, not the step.',
        inputSchema: {
          type: 'object',
          properties: {
            recipe: {
              description:
                'The recipe: an inline object, an inline JSON string, or a path to a .json recipe file.',
              oneOf: [
                { type: 'object' },
                { type: 'string' },
              ],
            },
            inputGlob: {
              type: 'string',
              description:
                'Glob of input files (e.g. "/photos/*.jpg"). Overrides recipe.inputGlob. Relative globs resolve against the recipe file directory (or cwd for an inline recipe).',
            },
            outputTemplate: {
              type: 'string',
              description:
                'Output path template with {stem}/{index}. Overrides recipe.outputTemplate.',
            },
            errorPolicy: {
              type: 'string',
              enum: ['skip', 'abort'],
              description:
                'On a per-file error: "skip" (default) continues to the next file, "abort" stops the run. Overrides recipe.errorPolicy.',
            },
          },
          required: ['recipe'],
        },
      },
      handler: async (args) => runBatchTool(handlers, args),
    },
  ];
}

async function runBatchTool(
  handlers: ReturnType<typeof buildToolHandlerMap>,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const { recipe, baseDir } = resolveRecipe(args.recipe, process.cwd());

    const report = await runBatch(handlers, {
      recipe,
      baseDir,
      ...(typeof args.inputGlob === 'string' ? { inputGlob: args.inputGlob } : {}),
      ...(typeof args.outputTemplate === 'string' ? { outputTemplate: args.outputTemplate } : {}),
      ...(normalizeErrorPolicy(args.errorPolicy)
        ? { errorPolicy: normalizeErrorPolicy(args.errorPolicy) }
        : {}),
    });

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      // A run that completed but had per-file failures is still a successful
      // *call* — the report carries the per-file truth. Only surface isError
      // when nothing succeeded, so agents notice a wholesale failure.
      ...(report.succeeded === 0 ? { isError: true as const } : {}),
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Batch run failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
