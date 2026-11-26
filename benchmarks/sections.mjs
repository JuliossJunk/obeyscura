import assert from 'node:assert/strict';
import { countTokens, measure } from './measure.mjs';

const budget = '4096';

export async function benchmarkSections(converter, capture, fixture, markdown) {
  const started = performance.now();
  const exchanges = [];
  async function request(format, cursor) {
    const args = ['--format', format];
    if (format === 'outline') args.push('--max-bytes', budget);
    if (cursor) args.push('--cursor', cursor);
    const response = await converter.convert(capture.html, args);
    const requestTokens = countTokens(args.join(' '));
    const responseTokens = countTokens(response);
    const tokens = Object.fromEntries(Object.keys(requestTokens).map(encoding => [
      encoding, requestTokens[encoding] + responseTokens[encoding],
    ]));
    exchanges.push({ format, tokens });
    return response;
  }

  const sections = [];
  let cursor;
  const targets = new Map();
  let table;
  let outlines = 0;
  const facts = fixture.facts.slice(0, 2);
  const artifacts = fixture.artifacts.filter(item => item.kind === 'table').slice(0, 1);
  do {
    const response = await request('outline', cursor);
    outlines++;
    assert.ok(Buffer.byteLength(response) <= Number(budget));
    const page = JSON.parse(response);
    assert.equal(page.snapshot, capture.snapshotSha256);
    assert.ok(page.sections.length > 0);
    for (const entry of page.sections) {
      assert.equal(entry.index, sections.length);
      const lookup = `${page.snapshot}:${entry.index}`;
      const section = await request('section', lookup);
      sections.push(section);
      if (section.trim() && (targets.size < facts.length || (!table && artifacts.length))) {
        const observed = measure(section, 'markdown', { facts, artifacts }, capture.url);
        const exchange = exchanges.at(-1);
        observed.facts.forEach((fact, index) => {
          if (fact.retained && !targets.has(index)) targets.set(index, { exchange, outlines });
        });
        if (!table && observed.artifacts[0]?.retained) table = { exchange, outlines };
      }
    }
    assert.ok(sections.length <= page.total_sections);
    assert.equal(page.next_cursor, sections.length === page.total_sections ? null : `${page.snapshot}:${sections.length}`);
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(sections.join(''), markdown);
  assert.equal(await converter.convert(capture.html, ['--format', 'html']), capture.html);
  const sum = items => Object.fromEntries(Object.keys(items[0].tokens).map(encoding => [
    encoding, items.reduce((total, item) => total + item.tokens[encoding], 0),
  ]));
  // The targeted reads assume an oracle picked the right section and metered
  // every outline page through that point, then made only the target read.
  const outlineExchanges = exchanges.filter(item => item.format === 'outline');
  const targeted = (...items) => {
    if (items.some(item => !item)) return null;
    const reads = [...new Set(items.map(item => item.exchange))];
    const calls = [...outlineExchanges.slice(0, Math.max(...items.map(item => item.outlines))), ...reads];
    return { requests: calls.length, tokens: sum(calls) };
  };
  return {
    sections: sections.length, outlines, fullMarkdownTokens: countTokens(markdown),
    fullTraversal: { requests: exchanges.length, tokens: sum(exchanges) },
    firstFact: targeted(targets.get(0)), firstTwoFacts: targeted(targets.get(0), targets.get(1)),
    firstTable: targeted(table),
    elapsedMs: performance.now() - started,
  };
}
