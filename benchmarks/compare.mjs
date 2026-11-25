import { readFile } from 'node:fs/promises';

const [baseFile, baseConfig, candidateFile, candidateConfig] = process.argv.slice(2);
if (process.argv.length !== 6) {
  throw new Error('Usage: node compare.mjs <base.json> <base-config> <candidate.json> <candidate-config>');
}

const readReport = async file => JSON.parse(await readFile(file, 'utf8'));
const [base, candidate] = await Promise.all([readReport(baseFile), readReport(candidateFile)]);
if (base.schema !== 1 || candidate.schema !== 1) throw new Error('Unsupported report schema');
if (base.fixtureDataset.sha256 !== candidate.fixtureDataset.sha256
    || base.fixtureDataset.split !== candidate.fixtureDataset.split
    || base.environment.runs !== candidate.environment.runs) {
  throw new Error('Compare reports with identical fixtures, split, and number of runs');
}
for (const key of ['packageLockSha256', 'node', 'platform', 'arch', 'viewport', 'readiness', 'chromiumChannel']) {
  if (base.environment[key] !== candidate.environment[key]) {
    throw new Error(`Benchmark environments differ in ${key}`);
  }
}
if (base.environment.engines.chromium?.version !== candidate.environment.engines.chromium?.version) {
  throw new Error('Chromium versions differ');
}

function bySample(report, config) {
  if (!Object.hasOwn(report.configs, config)) throw new Error(`Unknown configuration: ${config}`);
  const rows = report.rows.filter(row => row.config === config);
  const samples = new Map(rows.map(row => [`${row.attempt}/${row.fixture}`, row]));
  if (rows.length !== samples.size) throw new Error(`Duplicate sample in ${config}`);
  return samples;
}

const before = bySample(base, baseConfig);
const after = bySample(candidate, candidateConfig);
if (before.size !== after.size || [...before.keys()].some(key => !after.has(key))) {
  throw new Error('Configurations have different sample sets');
}
const pairs = [...before].map(([key, row]) => [row, after.get(key)]);
const comparable = pairs.filter(pair => pair.every(row => row.status === 'ok'));
const snapshots = { identical: 0, different: 0, unavailable: 0 };
for (const [oldRow, newRow] of comparable) {
  if (!oldRow.snapshotSha256 || !newRow.snapshotSha256) {
    snapshots.unavailable++;
  } else if (oldRow.snapshotSha256 === newRow.snapshotSha256) {
    snapshots.identical++;
  } else {
    snapshots.different++;
  }
}
const numerator = (rows, field) => rows.reduce((sum, row) => sum + (row[field]?.filter(item => item.retained).length ?? 0), 0);
const denominator = (rows, field) => rows.reduce((sum, row) => sum + row[field], 0);
function coverage(rows) {
  return {
    samples: rows.length,
    successful: rows.filter(row => row.status === 'ok').length,
    facts: [numerator(rows, 'facts'), denominator(rows, 'expectedFacts')],
    artifacts: [numerator(rows, 'artifacts'), denominator(rows, 'expectedArtifacts')],
    numericFacts: [
      rows.reduce((sum, row) => sum + (row.facts?.filter(item => item.retained && item.criticalNumber).length ?? 0), 0),
      denominator(rows, 'expectedCriticalNumbers'),
    ],
  };
}

const changed = [];
for (const [oldRow, newRow] of pairs) {
  const { fixture, attempt } = oldRow;
  if (oldRow.status !== newRow.status) {
    changed.push({ fixture, attempt, before: oldRow.status, after: newRow.status });
  }
  if (oldRow.status !== 'ok' || newRow.status !== 'ok') continue;
  for (const field of ['facts', 'artifacts']) {
    oldRow[field].forEach((item, index) => {
      if (item.retained !== newRow[field][index].retained) {
        changed.push({ fixture, attempt, field, expectation: newRow[field][index] });
      }
    });
  }
}

const tokens = {};
for (const encoding of ['o200k_base', 'cl100k_base']) {
  const oldTotal = comparable.reduce((sum, [row]) => sum + row.tokens[encoding], 0);
  const newTotal = comparable.reduce((sum, [, row]) => sum + row.tokens[encoding], 0);
  tokens[encoding] = {
    before: comparable.length ? oldTotal : null,
    after: comparable.length ? newTotal : null,
    reduction: oldTotal ? 1 - newTotal / oldTotal : null,
  };
}
console.log(JSON.stringify({
  base: { config: baseConfig, revision: base.revision, coverage: coverage([...before.values()]) },
  candidate: { config: candidateConfig, revision: candidate.revision, coverage: coverage([...after.values()]) },
  pairedSuccessfulSamples: comparable.length, snapshots, tokens, changes: changed,
}, null, 2));
if (comparable.length === 0) process.exitCode = 1;
