import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launchChromium, launchObscura, loadConverter, serveFixtures } from './engines.mjs';
import { evaluateSerializer, measure, standardMarkdown } from './measure.mjs';
import { benchmarkSections } from './sections.mjs';

const { values: options } = parseArgs({ options: {
  out: { type: 'string' },
  runs: { type: 'string' },
  dataset: { type: 'string', default: 'local' },
  split: { type: 'string', default: 'all' },
  channel: { type: 'string' },
  obscura: { type: 'string' },
  'obscura-revision': { type: 'string' },
  converter: { type: 'string' },
  'converter-revision': { type: 'string' },
  'source-revision': { type: 'string' },
  'allow-partial': { type: 'boolean', default: false },
  sections: { type: 'boolean', default: false },
} });
if (!['local', 'public'].includes(options.dataset)) throw new Error('Invalid --dataset');
const publicPages = options.dataset === 'public';
const runs = Number(options.runs ?? (publicPages ? 1 : 3));
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
if (!['all', 'development', 'evaluation'].includes(options.split)) throw new Error('Invalid --split');
if (!options.obscura && !options['allow-partial']) {
  throw new Error('Pass --obscura with the baseline executable, or --allow-partial for Chromium-only diagnostics');
}
if (options['obscura-revision'] && !options.obscura) throw new Error('--obscura-revision requires --obscura');
if (options['converter-revision'] && !options.converter) throw new Error('--converter-revision requires --converter');
if (options.sections && !options.converter) throw new Error('--sections requires --converter');

const fromHere = relative => new URL(relative, import.meta.url);
const sha256 = data => createHash('sha256').update(data).digest('hex');
const lockfile = await readFile(fromHere('./package-lock.json'));
const datasetFile = publicPages ? './public-fixtures.mjs' : './fixtures.mjs';
const { datasetVersion, fixtures } = await import(datasetFile);
const fixtureSource = await readFile(fromHere(datasetFile));
const scriptFile = 'crates/obscura-js/src/markdown.rs';
const repository = fromHere('../');
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
const revision = git('rev-parse', 'HEAD');
const commit = ref => git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
const serializerRevision = commit(options['source-revision'] ?? revision);
const obscuraRevision = options['obscura-revision'] ? commit(options['obscura-revision']) : null;
const converterRevision = options['converter-revision'] ? commit(options['converter-revision']) : null;
const converter = options.converter ? await loadConverter(resolve(options.converter), converterRevision) : null;
const scriptSource = git('show', `${serializerRevision}:${scriptFile}`);
const upstreamScript = scriptSource.match(/pub const HTML_TO_MARKDOWN_JS: &str = r#"([\s\S]*?)"#;/u)?.[1];
if (!upstreamScript) throw new Error('Cannot locate the upstream JavaScript serializer');

const selected = fixtures.filter(fixture => options.split === 'all' || fixture.split === options.split);
const configs = {
  A: 'Chromium / DOM outerHTML',
  B: 'Chromium / Turndown + GFM',
  C: 'Chromium / Readability + Turndown + GFM',
  D: 'Obscura / LP.getMarkdown',
  'D-raw': 'Obscura / DOM outerHTML',
  'D-standard': 'Obscura / Turndown + GFM',
  X: 'Chromium DOM / Obscura upstream Markdown JS on an inert DOM',
};
if (converter) Object.assign(configs, {
  E: 'Chromium DOM / shared structured Markdown',
  F: 'Obscura DOM / shared structured Markdown',
});
const rows = [];
const startedAt = new Date().toISOString();
const engines = {};
const startErrors = {};
const setup = {};

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function capture(engine, fixture, url) {
  if (!engines[engine]) return { status: 'unavailable', error: startErrors[engine] };
  let stage = 'setup';
  const stages = {};
  const start = performance.now();
  let stageStart = start;
  const phase = nextStage => {
    const now = performance.now();
    stages[stage] = (stages[stage] ?? 0) + now - stageStart;
    stageStart = now;
    stage = nextStage;
  };
  try {
    const output = await engines[engine].capture(url, fixture, phase);
    if (!output.html?.trim()) throw new Error('Missing serialized DOM');
    if (output.url !== url) throw new Error(`Unexpected final URL: ${output.url}`);
    phase('finished');
    return { ...output, status: 'ok', stages, captureMs: performance.now() - start, snapshotSha256: sha256(output.html) };
  } catch (error) {
    const failedAt = stage;
    phase('failed');
    return {
      status: `${failedAt}_error`, error: describeError(error), httpStatus: error?.httpStatus,
      stages, captureMs: performance.now() - start,
    };
  }
}

async function record(config, attempt, fixture, capture, format, extract) {
  const row = {
    config, attempt, fixture: fixture.id, category: fixture.category, split: fixture.split,
    status: capture.status, error: capture.error, httpStatus: capture.httpStatus ?? null,
    captureMs: capture.captureMs, stages: capture.stages,
    sourceUrl: fixture.url, finalUrl: fixture.url ? capture.url : undefined, snapshotSha256: capture.snapshotSha256,
    expectedFacts: fixture.facts.length,
    expectedCriticalNumbers: fixture.facts.filter(fact => /\p{Nd}/u.test(fact)).length,
    expectedArtifacts: fixture.artifacts.length,
  };
  if (capture.status === 'ok') {
    const start = performance.now();
    try {
      const content = await extract(capture);
      row.extractMs = config === 'D' ? capture.stages.nativeMarkdown : performance.now() - start;
      Object.assign(row, measure(content, format, fixture, capture.url));
      if (options.sections && (config === 'E' || config === 'F')) {
        try {
          row.sectionReading = await benchmarkSections(converter, capture, fixture, content);
        } catch (error) {
          row.sectionReading = { error: describeError(error) };
          process.exitCode = 1;
        }
      }
    } catch (error) {
      row.status = 'extraction_error';
      row.error = describeError(error);
    }
  }
  rows.push(row);
}

const server = publicPages ? null : await serveFixtures();
try {
  for (const [name, launch] of [
    ['chromium', () => launchChromium(options.channel, { publicPages })],
    ['obscura', options.obscura && (() => launchObscura(resolve(options.obscura), obscuraRevision, { publicPages }))],
  ]) {
    if (!launch) {
      startErrors[name] = 'Executable not supplied';
      continue;
    }
    try {
      const engine = await launch();
      engines[name] = engine;
      setup[name] = { version: engine.version, startupMs: engine.startupMs };
      if (name === 'obscura') Object.assign(setup[name], { expectedRevision: obscuraRevision, binarySha256: engine.binarySha256 });
    } catch (error) {
      startErrors[name] = describeError(error);
      console.error(`${name}: ${startErrors[name]}`);
    }
  }

  for (let attempt = 1; attempt <= runs; attempt++) {
    for (const [index, fixture] of selected.entries()) {
      const url = fixture.url ?? `${server.origin}/page/${fixture.id}`;
      const captured = {};
      const order = (index + attempt) % 2 ? ['chromium', 'obscura'] : ['obscura', 'chromium'];
      for (const engine of order) captured[engine] = await capture(engine, fixture, url);
      const chrome = captured.chromium;
      const obscura = captured.obscura;
      await record('A', attempt, fixture, chrome, 'html', data => data.html);
      await record('B', attempt, fixture, chrome, 'markdown', data => standardMarkdown(data.html, data.url));
      await record('C', attempt, fixture, chrome, 'markdown', data => standardMarkdown(data.html, data.url, true));
      await record('D', attempt, fixture, obscura, 'markdown', data => {
        if (data.markdownError) throw new Error(data.markdownError);
        return data.markdown;
      });
      await record('D-raw', attempt, fixture, obscura, 'html', data => data.html);
      await record('D-standard', attempt, fixture, obscura, 'markdown', data => standardMarkdown(data.html, data.url));
      await record('X', attempt, fixture, chrome, 'markdown', data => evaluateSerializer(data.html, data.url, upstreamScript));
      if (converter) {
        await record('E', attempt, fixture, chrome, 'markdown', data => converter.convert(data.html));
        await record('F', attempt, fixture, obscura, 'markdown', data => converter.convert(data.html));
      }
    }
    console.log(`Completed run ${attempt}/${runs}`);
  }
} finally {
  await Promise.allSettled(Object.values(engines).map(engine => engine.close()));
  server?.close();
}

const count = (items, key) => items.reduce((sum, row) => sum + (row[key]?.filter(item => item.retained).length ?? 0), 0);
const sum = (items, key) => items.reduce((total, row) => total + row[key], 0);
const percentile = (items, fraction) => {
  const sorted = items.toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
};
const pairKey = row => `${row.attempt}/${row.fixture}`;
const encodings = ['o200k_base', 'cl100k_base'];

function summary(split) {
  const cohort = rows.filter(row => split === 'all' || row.split === split);
  const baseline = new Map(cohort.filter(row => row.config === 'B' && row.status === 'ok').map(row => [pairKey(row), row]));
  return Object.fromEntries(Object.keys(configs).map(config => {
    const matching = cohort.filter(row => row.config === config);
    const ok = matching.filter(row => row.status === 'ok');
    const pairs = ok.filter(row => baseline.has(pairKey(row)));
    const pairedBaseline = pairs.map(row => baseline.get(pairKey(row)));
    const totalTokens = (list, encoding) => list.reduce((total, row) => total + row.tokens[encoding], 0);
    const describeTiming = key => ({
      p50: percentile(ok.map(row => row[key]), 0.5),
      p95: percentile(ok.map(row => row[key]), 0.95),
    });
    return [config, {
      cases: matching.length,
      ok: ok.length,
      statuses: Object.fromEntries([...new Set(matching.map(row => row.status))].map(status => [
        status, matching.filter(row => row.status === status).length,
      ])),
      facts: { retained: count(ok, 'facts'), expected: sum(matching, 'expectedFacts') },
      criticalNumbers: {
        retained: ok.reduce((total, row) => total + row.facts.filter(fact => fact.criticalNumber && fact.retained).length, 0),
        expected: sum(matching, 'expectedCriticalNumbers'),
      },
      artifacts: { retained: count(ok, 'artifacts'), expected: sum(matching, 'expectedArtifacts') },
      captureMs: describeTiming('captureMs'),
      extractMs: describeTiming('extractMs'),
      paired: {
        samples: pairs.length,
        allFactsRetained: pairs.filter(row => row.facts.every(fact => fact.retained)).length,
        tokens: Object.fromEntries(encodings.map(encoding => {
          const actual = totalTokens(pairs, encoding);
          const standard = totalTokens(pairedBaseline, encoding);
          return [encoding, { actual, standard, reduction: standard ? 1 - actual / standard : null }];
        })),
      },
    }];
  }));
}

const report = {
  schema: 1,
  revision,
  startedAt,
  fixtureDataset: { version: datasetVersion, sha256: sha256(fixtureSource), size: selected.length, split: options.split },
  serializerDiagnostic: { revision: serializerRevision, source: scriptFile, sha256: sha256(upstreamScript) },
  converter: converter && {
    version: converter.version, expectedRevision: converterRevision, binarySha256: converter.binarySha256,
  },
  environment: {
    platform: process.platform, os: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model,
    logicalCores: os.cpus().length, logicalMemoryBytes: os.totalmem(), node: process.version,
    chromiumChannel: options.channel ?? 'bundled-headless-shell',
    packageLockSha256: sha256(lockfile),
    dependencies: JSON.parse(lockfile).packages[''].dependencies,
    readiness: publicPages
      ? 'DOMContentLoaded, per-page selector and text identity check with 25ms polling'
      : 'DOMContentLoaded, optional DOM click, then data-ready=true with 25ms polling',
    viewport: '1280x720 DPR 1', runs, engines: setup, startErrors,
    startedWithChromiumSandbox: publicPages,
  },
  configs,
  summary: Object.fromEntries(['all', 'development', 'evaluation'].map(split => [split, summary(split)])),
  rows,
};

const csvRow = values => values.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',');
const csv = [csvRow([
  'config', 'attempt', 'fixture', 'category', 'split', 'status', 'error', 'http_status', 'source_url', 'final_url',
  'snapshot_sha256', 'bytes', ...encodings,
  'facts_retained', 'facts_expected', 'numeric_facts_retained', 'numeric_facts_expected',
  'artifacts_retained', 'artifacts_expected', 'capture_ms', 'extract_ms',
]), ...rows.map(row => csvRow([
  row.config, row.attempt, row.fixture, row.category, row.split, row.status, row.error, row.httpStatus, row.sourceUrl,
  row.finalUrl, row.snapshotSha256, row.bytes,
  ...encodings.map(name => row.tokens?.[name]),
  row.facts?.filter(fact => fact.retained).length, row.expectedFacts,
  row.facts?.filter(fact => fact.retained && fact.criticalNumber).length, row.expectedCriticalNumbers,
  row.artifacts?.filter(artifact => artifact.retained).length, row.expectedArtifacts, row.captureMs, row.extractMs,
]))].join('\r\n') + '\r\n';

const markdown = [
  '# Content baseline', '',
  `Dataset ${datasetVersion}, ${selected.length} fixtures × ${runs} runs, revision ${revision}.`, '',
  '| Config | Successful samples | Facts | Numeric facts | Artifacts | Paired o200k_base tokens | Paired cl100k_base tokens |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...Object.entries(report.summary.all).map(([name, value]) => {
    const unavailable = value.statuses.unavailable === value.cases;
    const totals = field => unavailable ? 'n/a' : `${value[field].retained}/${value[field].expected}`;
    const tokenCounts = encodings.map(encoding => {
      const token = value.paired.tokens[encoding];
      return value.paired.samples ? `${token.actual}/${token.standard}` : 'n/a';
    });
    const coverage = unavailable ? 'unavailable' : `${value.ok}/${value.cases}`;
    return `| ${name} | ${coverage} | ${totals('facts')} | ${totals('criticalNumbers')} | ${totals('artifacts')} | ${tokenCounts.join(' | ')} |`;
  }),
  '', 'Paired tokens compare each successful configuration with B on matching fixture and run.', '',
].join('\n');

const output = resolve(options.out ?? (publicPages ? '../target/content-benchmark-public' : '../target/content-benchmark'));
await mkdir(output, { recursive: true });
await Promise.all([
  writeFile(resolve(output, 'benchmark_results.json'), JSON.stringify(report, null, 2) + '\n'),
  writeFile(resolve(output, 'benchmark_results.csv'), csv),
  writeFile(resolve(output, 'benchmark_results.md'), markdown),
]);
console.log(`Reports written to ${output}`);
if (report.summary.all.A.ok === 0 || (!options['allow-partial'] && report.summary.all.D.ok === 0)) {
  process.exitCode = 1;
}
if (converter && (report.summary.all.E.ok === 0 || (!options['allow-partial'] && report.summary.all.F.ok === 0))) {
  process.exitCode = 1;
}
