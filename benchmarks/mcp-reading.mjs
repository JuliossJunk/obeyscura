import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { serveFixtures } from './engines.mjs';
import { fixtures } from './fixtures.mjs';
import { countTokens, measure } from './measure.mjs';

const tasks = [
  { fixture: 'paper-sampling', heading: 'Methods', question: 'How many coastal sites did the study sample?', expected: '42', fact: 'The study sampled 42 coastal sites twice.' },
  { fixture: 'product-sensor', heading: 'Calibration', question: 'What air conditions does the sensor calibration require?', expected: 'dry air', fact: 'Calibration requires dry air.' },
  { fixture: 'table-spans', heading: 'Laboratory results', question: 'What is the peak reading for Probe D?', expected: '12.7 W', fact: '12.7 W' },
  { fixture: 'forum-wifi', heading: 'Accepted answer', question: 'Which version fixes the wake-up timeout?', expected: '3.2.1', fact: 'Version 3.2.1 fixes the wake-up timeout.' },
  { fixture: 'rfc9110', heading: '404 Not Found', question: 'What does RFC 9110 say that the origin server did not find for a 404 response?', expected: 'a current representation for the target resource', fact: 'did not find a current representation', url: 'https://www.rfc-editor.org/rfc/rfc9110.html' },
];

function addTokens(request, response) {
  const requestTokens = countTokens(request);
  const responseTokens = countTokens(response);
  return Object.fromEntries(Object.keys(requestTokens).map(key => [key, requestTokens[key] + responseTokens[key]]));
}

function connect(binary, local) {
  const child = spawn(binary, local ? ['--allow-private-network', 'mcp'] : ['mcp'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ready = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  let id = 0;
  return {
    close: () => child.kill(),
    async call(method, params) {
      await ready;
      const request = JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params });
      await new Promise((resolve, reject) => {
        child.stdin.write(request + '\n', error => error ? reject(error) : resolve());
      });
      const timeout = setTimeout(() => child.kill(), 30_000);
      try {
        const { value, done } = await output.next();
        if (done) throw new Error('MCP process closed before sending a response');
        const response = JSON.parse(value);
        assert.equal(response.id, id);
        if (response.error) throw new Error(response.error.message);
        return { result: response.result, tokens: addTokens(request, value) };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function runTask(client, task, url, schemas) {
  const tool = async (name, args) => {
    const exchange = await client.call('tools/call', { name, arguments: args });
    const text = exchange.result.content?.[0]?.text;
    if (exchange.result.isError || typeof text !== 'string') throw new Error(text ?? 'Missing tool output');
    return { text, tokens: exchange.tokens };
  };
  const evidence = text => text.trim() && measure(text, 'markdown', { facts: [task.fact], artifacts: [] }, url).facts[0].retained;
  const summarize = (toolName, calls, retained) => ({
    retained: Boolean(retained),
    requests: calls.length,
    rpcTokens: Object.fromEntries(Object.keys(schemas[toolName]).map(key =>
      [key, calls.reduce((sum, call) => sum + call.tokens[key], 0)])),
    schemaTokens: schemas[toolName],
  });
  const row = { fixture: task.fixture, question: task.question, expected: task.expected, public: Boolean(task.url) };
  try {
    await tool('browser_navigate', { url });
  } catch (error) {
    return { ...row, status: 'navigation_error', error: error.message };
  }
  const full = await tool('browser_markdown', { max_chars: 1_000_000 });
  row.full = summarize('browser_markdown', [full], evidence(full.text));

  const calls = [];
  async function read(args) {
    const exchange = await tool('browser_read', { max_bytes: 4096, ...args });
    calls.push(exchange);
    assert.ok(Buffer.byteLength(exchange.text) <= 4096);
    return JSON.parse(exchange.text);
  }
  let page = await read({});
  const expected = task.heading.toLowerCase();
  const match = entry => entry.title.toLowerCase().endsWith(expected);
  let target = page.sections.find(match);
  const visited = new Set();
  while (!target && page.next_cursor) {
    assert.ok(!visited.has(page.next_cursor), 'repeated outline cursor');
    visited.add(page.next_cursor);
    page = await read({ cursor: page.next_cursor });
    target = page.sections.find(match);
  }
  let section = '';
  if (target) {
    let cursor = `${page.snapshot}:${target.index}`;
    while (cursor) {
      assert.ok(!visited.has(cursor), 'repeated section cursor');
      visited.add(cursor);
      const chunk = await read({ format: 'section', cursor });
      section += chunk.text;
      cursor = chunk.next_cursor;
    }
  }
  row.sections = summarize('browser_read', calls, evidence(section));
  row.status = 'ok';
  return row;
}

const { values } = parseArgs({ options: {
  binary: { type: 'string' },
  out: { type: 'string', default: '../target/content-benchmark-mcp' },
  public: { type: 'boolean', default: false },
} });
if (!values.binary) throw new Error('Pass --binary pointing to the release Obscura executable');
const server = values.public ? null : await serveFixtures();
const client = connect(resolve(values.binary), !values.public);
const rows = [];
try {
  await client.call('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'content-benchmark', version: '1' },
  });
  const { result } = await client.call('tools/list', {});
  const schemas = Object.fromEntries(['browser_markdown', 'browser_read'].map(name => {
    const tool = result.tools.find(entry => entry.name === name);
    assert.ok(tool, `missing ${name} tool`);
    return [name, countTokens(JSON.stringify(tool))];
  }));
  for (const task of tasks.filter(task => Boolean(task.url) === values.public)) {
    if (!task.url) assert.ok(fixtures.some(fixture => fixture.id === task.fixture));
    const url = task.url ?? `${server.origin}/page/${task.fixture}`;
    try {
      rows.push(await runTask(client, task, url, schemas));
    } catch (error) {
      rows.push({ fixture: task.fixture, status: 'protocol_error', error: error.message });
      process.exitCode = 1;
    }
  }
} finally {
  client.close();
  server?.close();
}

const output = resolve(values.out);
await mkdir(output, { recursive: true });
const csv = [['fixture', 'status', 'mode', 'fact_retained', 'requests', 'rpc_o200k', 'schema_o200k', 'rpc_cl100k', 'schema_cl100k'],
  ...rows.flatMap(row => ['full', 'sections'].map(mode => {
    const data = row[mode];
    return [row.fixture, row.status, mode, data?.retained, data?.requests,
      data?.rpcTokens.o200k_base, data?.schemaTokens.o200k_base, data?.rpcTokens.cl100k_base, data?.schemaTokens.cl100k_base];
  })),
].map(row => row.map(value => JSON.stringify(value ?? '')).join(',')).join('\n');
await Promise.all([
  writeFile(resolve(output, 'benchmark_results.json'), JSON.stringify({ node: process.version, public: values.public, rows }, null, 2) + '\n'),
  writeFile(resolve(output, 'benchmark_results.csv'), csv + '\n'),
]);
console.table(rows.map(row => ({ fixture: row.fixture, status: row.status, full: row.full?.retained, sections: row.sections?.retained })));
if (!values.public && rows.some(row => row.status !== 'ok' || !row.sections.retained)) process.exitCode = 1;
