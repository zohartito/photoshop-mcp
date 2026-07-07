/**
 * Offline static checks for headless batch mode (transport-layer.md §8, M4).
 * Run: npx tsx scripts/test-batch-static.ts
 *
 * No live Photoshop. A fake handler map stands in for the real tool handlers, so
 * this pins the engine's backend-agnostic logic — the part the offline gate can
 * prove without a PS harness (the live confirmation is the staged 3-file run):
 *
 *   1. Template rendering ({stem}/{index}) and export-format inference.
 *   2. Glob expansion is sorted + absolutized (deterministic {index}).
 *   3. The per-file lifecycle is exactly open -> steps -> export -> close(no-save).
 *   4. errorPolicy: skip continues (file marked skipped, doc still closed);
 *      abort stops the run and marks the file failed.
 *   5. Fail-fast validation: unknown tool / missing glob / missing template /
 *      no matches throw before any file is touched.
 *   6. Report totals + CLI arg parsing.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  renderOutputPath,
  formatForOutput,
  expandInputs,
  runBatch,
  type Recipe,
  type ToolHandlerMap,
} from '../src/tools/batch-engine.js';
import { parseBatchArgs } from '../src/ui/batch-cli.js';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  OK   ${name}`);
  });
}

function ok(text = '{}'): CallToolResult {
  return { content: [{ type: 'text', text }] };
}
function err(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * A fake handler map that records the call order and can be told to fail a
 * specific tool. Every recipe-referenced tool + open/save/close resolves here.
 */
function fakeHandlers(opts: {
  calls: string[];
  failTool?: string;
  extraTools?: string[];
}): ToolHandlerMap {
  const map: ToolHandlerMap = new Map();
  const names = [
    'photoshop_open_image',
    'photoshop_save_document',
    'photoshop_close_document',
    'photoshop_adjust_brightness_contrast',
    'photoshop_add_vibrance',
    ...(opts.extraTools ?? []),
  ];
  for (const name of names) {
    map.set(name, async (args) => {
      opts.calls.push(name);
      if (name === opts.failTool) return err(`${name} boom`);
      // echo the save path so the report's output can be asserted
      if (name === 'photoshop_save_document') return ok(JSON.stringify({ path: args.path }));
      return ok();
    });
  }
  return map;
}

const SILENT = () => {};

async function main(): Promise<void> {
  console.log('Batch engine — offline static checks\n');

  // --- pure helpers ---------------------------------------------------------
  await check('renderOutputPath: {stem} substitution', () => {
    const out = renderOutputPath('./out/{stem}-web.png', '/in/hero.jpg', 1, 3);
    assert.equal(out, './out/hero-web.png');
  });
  await check('renderOutputPath: {index} zero-pads to file count', () => {
    assert.equal(renderOutputPath('{index}_{stem}.png', '/in/a.jpg', 3, 12), '03_a.png');
    assert.equal(renderOutputPath('{index}.png', '/in/a.jpg', 3, 9), '3.png');
    assert.equal(renderOutputPath('{index}.png', '/in/a.jpg', 7, 100), '007.png');
  });
  await check('formatForOutput: extension picks format', () => {
    assert.equal(formatForOutput('/x/a.png'), 'PNG');
    assert.equal(formatForOutput('/x/a.JPG'), 'JPEG');
    assert.equal(formatForOutput('/x/a.jpeg'), 'JPEG');
    assert.equal(formatForOutput('/x/a.psd'), 'PSD');
    assert.equal(formatForOutput('/x/a.tif'), 'PSD'); // fallback
  });

  // --- glob expansion (sorted + absolute) -----------------------------------
  const dir = mkdtempSync(join(tmpdir(), 'batch-test-'));
  for (const f of ['c.jpg', 'a.jpg', 'b.jpg', 'skip.png']) {
    writeFileSync(join(dir, f), 'x');
  }
  await check('expandInputs: sorted, absolute, glob-filtered', () => {
    const inputs = expandInputs('*.jpg', dir);
    assert.deepEqual(
      inputs.map((p) => p.replace(dir + '/', '')),
      ['a.jpg', 'b.jpg', 'c.jpg']
    );
    assert.ok(inputs.every((p) => p.startsWith(dir)), 'all absolute');
  });

  const recipe: Recipe = {
    steps: [
      { name: 'photoshop_adjust_brightness_contrast', params: { brightness: 5, contrast: 5 } },
      { name: 'photoshop_add_vibrance', params: { vibrance: 10 } },
    ],
    inputGlob: '*.jpg',
    outputTemplate: 'out/{stem}.png',
  };

  // --- happy path: exact lifecycle order ------------------------------------
  await check('runBatch: per-file lifecycle is open -> steps -> export -> close', async () => {
    const calls: string[] = [];
    const report = await runBatch(fakeHandlers({ calls }), {
      recipe,
      baseDir: dir,
      onProgress: SILENT,
    });
    // 3 files x [open, step1, step2, save, close] = 15 calls
    assert.equal(report.totalFiles, 3);
    assert.equal(report.succeeded, 3);
    assert.equal(report.failed, 0);
    assert.equal(report.ok, true);
    assert.deepEqual(calls.slice(0, 5), [
      'photoshop_open_image',
      'photoshop_adjust_brightness_contrast',
      'photoshop_add_vibrance',
      'photoshop_save_document',
      'photoshop_close_document',
    ]);
    assert.equal(calls.length, 15);
    // output path recorded on success, format inferred from .png
    assert.ok(report.files[0].output?.endsWith('out/a.png'));
    assert.equal(report.files[0].status, 'ok');
  });

  // --- errorPolicy: skip ----------------------------------------------------
  await check('runBatch: skip marks file skipped, still closes, continues', async () => {
    const calls: string[] = [];
    const report = await runBatch(
      fakeHandlers({ calls, failTool: 'photoshop_add_vibrance' }),
      { recipe, baseDir: dir, errorPolicy: 'skip', onProgress: SILENT }
    );
    assert.equal(report.skipped, 3);
    assert.equal(report.succeeded, 0);
    assert.equal(report.failed, 0);
    assert.equal(report.ok, true, 'skip is not a run failure');
    // failing step still followed by a close for that file
    assert.equal(calls.filter((c) => c === 'photoshop_close_document').length, 3);
    // export never runs when a step failed
    assert.equal(calls.filter((c) => c === 'photoshop_save_document').length, 0);
    assert.equal(report.files[0].status, 'skipped');
    assert.match(report.files[0].error ?? '', /add_vibrance boom/);
    assert.equal(report.files[0].output, undefined);
  });

  // --- errorPolicy: abort ---------------------------------------------------
  await check('runBatch: abort stops after first failure, marks failed', async () => {
    const calls: string[] = [];
    const report = await runBatch(
      fakeHandlers({ calls, failTool: 'photoshop_add_vibrance' }),
      { recipe, baseDir: dir, errorPolicy: 'abort', onProgress: SILENT }
    );
    assert.equal(report.aborted, true);
    assert.equal(report.failed, 1);
    assert.equal(report.totalFiles, 3);
    assert.equal(report.ok, false);
    // only the first file was touched, and it was still closed
    assert.equal(calls.filter((c) => c === 'photoshop_open_image').length, 1);
    assert.equal(calls.filter((c) => c === 'photoshop_close_document').length, 1);
    assert.equal(report.files.length, 1);
    assert.equal(report.files[0].status, 'failed');
  });

  // --- open failure: no steps, no close (never opened) ----------------------
  await check('runBatch: open failure skips steps and needs no close', async () => {
    const calls: string[] = [];
    const report = await runBatch(
      fakeHandlers({ calls, failTool: 'photoshop_open_image' }),
      { recipe, baseDir: dir, errorPolicy: 'skip', onProgress: SILENT }
    );
    assert.equal(report.skipped, 3);
    assert.equal(calls.filter((c) => c === 'photoshop_close_document').length, 0);
    assert.equal(calls.filter((c) => c === 'photoshop_adjust_brightness_contrast').length, 0);
    assert.match(report.files[0].error ?? '', /open failed/);
  });

  // --- recipe-level errorPolicy default is skip -----------------------------
  await check('runBatch: recipe.errorPolicy honored when option omitted', async () => {
    const calls: string[] = [];
    const r2: Recipe = { ...recipe, errorPolicy: 'abort' };
    const report = await runBatch(
      fakeHandlers({ calls, failTool: 'photoshop_add_vibrance' }),
      { recipe: r2, baseDir: dir, onProgress: SILENT }
    );
    assert.equal(report.errorPolicy, 'abort');
    assert.equal(report.aborted, true);
  });

  // --- fail-fast validation -------------------------------------------------
  await check('runBatch: unknown tool in a step throws before any file', async () => {
    const calls: string[] = [];
    const bad: Recipe = { ...recipe, steps: [{ name: 'photoshop_not_a_tool' }] };
    await assert.rejects(
      () => runBatch(fakeHandlers({ calls }), { recipe: bad, baseDir: dir, onProgress: SILENT }),
      /unknown tool in recipe step: "photoshop_not_a_tool"/
    );
    assert.equal(calls.length, 0, 'nothing touched');
  });
  await check('runBatch: missing inputGlob throws', async () => {
    const calls: string[] = [];
    const noGlob: Recipe = { steps: recipe.steps, outputTemplate: 'x/{stem}.png' };
    await assert.rejects(
      () => runBatch(fakeHandlers({ calls }), { recipe: noGlob, baseDir: dir, onProgress: SILENT }),
      /no inputGlob/
    );
  });
  await check('runBatch: missing outputTemplate throws', async () => {
    const calls: string[] = [];
    const noTmpl: Recipe = { steps: recipe.steps, inputGlob: '*.jpg' };
    await assert.rejects(
      () => runBatch(fakeHandlers({ calls }), { recipe: noTmpl, baseDir: dir, onProgress: SILENT }),
      /no outputTemplate/
    );
  });
  await check('runBatch: glob matching no files throws', async () => {
    const calls: string[] = [];
    const none: Recipe = { ...recipe, inputGlob: '*.nope' };
    await assert.rejects(
      () => runBatch(fakeHandlers({ calls }), { recipe: none, baseDir: dir, onProgress: SILENT }),
      /matched no files/
    );
  });

  // --- option override beats recipe -----------------------------------------
  await check('runBatch: option inputGlob/outputTemplate override recipe', async () => {
    const calls: string[] = [];
    const report = await runBatch(fakeHandlers({ calls }), {
      recipe: { steps: recipe.steps, inputGlob: '*.nope', outputTemplate: 'wrong/{stem}.psd' },
      inputGlob: '*.jpg',
      outputTemplate: 'right/{stem}.jpg',
      baseDir: dir,
      onProgress: SILENT,
    });
    assert.equal(report.succeeded, 3);
    assert.ok(report.files[0].output?.endsWith('right/a.jpg'));
  });

  // --- CLI arg parsing ------------------------------------------------------
  await check('parseBatchArgs: positional recipe + flags', () => {
    const p = parseBatchArgs([
      'recipe.json',
      '--input-glob',
      './in/*.jpg',
      '--output-template',
      './out/{stem}.png',
      '--error-policy',
      'abort',
    ]);
    assert.equal(p.recipePath, 'recipe.json');
    assert.equal(p.inputGlob, './in/*.jpg');
    assert.equal(p.outputTemplate, './out/{stem}.png');
    assert.equal(p.errorPolicy, 'abort');
    assert.equal(p.help, false);
  });
  await check('parseBatchArgs: -h sets help', () => {
    assert.equal(parseBatchArgs(['-h']).help, true);
    assert.equal(parseBatchArgs(['--help']).help, true);
  });
  await check('parseBatchArgs: bad --error-policy throws', () => {
    assert.throws(() => parseBatchArgs(['r.json', '--error-policy', 'nope']), /skip.*abort/);
  });
  await check('parseBatchArgs: unknown option throws', () => {
    assert.throws(() => parseBatchArgs(['r.json', '--bogus']), /Unknown option/);
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
