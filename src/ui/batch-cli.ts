/**
 * `photoshop-mcp batch <recipe.json> [flags]` CLI subcommand (transport-layer.md §8).
 *
 * Runs the SAME headless batch engine as the `photoshop_batch_run` MCP tool, but
 * from the shell — no MCP client / agent in the loop. It builds a TransportRouter
 * directly over a PhotoshopConnection (the router owns the one global command
 * queue and backend selection, §6.2), then drives the shared engine.
 *
 * Progress goes to stderr as JSON lines; the final per-file report prints to
 * stdout as JSON (so it can be piped/redirected). Exit code: 0 if the run
 * completed with no failed files, 1 otherwise (or on setup error).
 *
 * "Headless" = agentless, not Photoshop-less: the Photoshop GUI must be running.
 */
import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { PhotoshopConnection } from '../platform/connection.js';
import { TransportRouter } from '../transport/index.js';
import {
  buildToolHandlerMap,
  runBatch,
  type BatchErrorPolicy,
  type Recipe,
} from '../tools/batch-engine.js';

interface ParsedBatchArgs {
  recipePath: string;
  inputGlob?: string;
  outputTemplate?: string;
  errorPolicy?: BatchErrorPolicy;
  help: boolean;
}

const USAGE = `photoshop-mcp batch <recipe.json> [options]

Run a recipe (ordered photoshop_* tool steps) over many files, headlessly.
Per file: open -> each step -> export -> close(no-save). Serial by design.

Arguments:
  <recipe.json>              Path to a recipe JSON file:
                             { "steps": [{ "name", "params" }],
                               "inputGlob"?, "outputTemplate"?, "errorPolicy"? }

Options:
  --input-glob <glob>        Override recipe.inputGlob (e.g. "./in/*.jpg").
  --output-template <tmpl>   Override recipe.outputTemplate. Supports {stem} and
                             {index}; extension picks format (.png/.jpg/.psd).
  --error-policy <skip|abort>  Override recipe.errorPolicy (default: skip).
  -h, --help                 Show this help.

Note: "headless" means agentless, not Photoshop-less — the Photoshop GUI must be
running (macOS Photoshop has no true headless mode). Unit of undo is the file.`;

export function parseBatchArgs(argv: string[]): ParsedBatchArgs {
  const result: ParsedBatchArgs = { recipePath: '', help: false };
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;
      case '--input-glob':
        result.inputGlob = argv[++i];
        break;
      case '--output-template':
        result.outputTemplate = argv[++i];
        break;
      case '--error-policy': {
        const v = argv[++i];
        if (v !== 'skip' && v !== 'abort') {
          throw new Error(`--error-policy must be "skip" or "abort" (got "${v}")`);
        }
        result.errorPolicy = v;
        break;
      }
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
        positionals.push(arg);
    }
  }

  result.recipePath = positionals[0] ?? '';
  return result;
}

function loadRecipe(recipePath: string): { recipe: Recipe; baseDir: string } {
  const abs = isAbsolute(recipePath) ? recipePath : resolve(process.cwd(), recipePath);
  const raw = readFileSync(abs, 'utf8');
  return { recipe: JSON.parse(raw) as Recipe, baseDir: dirname(abs) };
}

/**
 * Entry point for the `batch` subcommand. `argv` is the slice AFTER the
 * subcommand token (i.e. process.argv.slice(3)). Returns a process exit code.
 */
export async function runBatchCli(argv: string[]): Promise<number> {
  let parsed: ParsedBatchArgs;
  try {
    parsed = parseBatchArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}\n`);
    return 1;
  }

  if (parsed.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!parsed.recipePath) {
    process.stderr.write(`Error: recipe path is required.\n\n${USAGE}\n`);
    return 1;
  }

  const connection = new PhotoshopConnection();
  const transport = new TransportRouter(connection);
  const handlers = buildToolHandlerMap(transport);

  try {
    const { recipe, baseDir } = loadRecipe(parsed.recipePath);
    const report = await runBatch(handlers, {
      recipe,
      baseDir,
      ...(parsed.inputGlob ? { inputGlob: parsed.inputGlob } : {}),
      ...(parsed.outputTemplate ? { outputTemplate: parsed.outputTemplate } : {}),
      ...(parsed.errorPolicy ? { errorPolicy: parsed.errorPolicy } : {}),
    });

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.failed === 0 ? 0 : 1;
  } catch (err) {
    process.stderr.write(
      `Batch run failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return 1;
  }
}
