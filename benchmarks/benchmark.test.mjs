import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { checkBuildRevision, readinessFor } from './engines.mjs';
import { fixtures, renderFixture } from './fixtures.mjs';
import { evaluateSerializer, measure, standardMarkdown } from './measure.mjs';
import { fixtures as publicFixtures } from './public-fixtures.mjs';

const url = 'http://127.0.0.1:8080/page/fixture';

test('an exact source revision requires the matching build version', () => {
  const revision = '76db0c807f4bbaed062fcd3be7760adba49ac841';
  assert.doesNotThrow(() => checkBuildRevision('obscura 0.1.0-dev+76db0c8', revision));
  assert.throws(() => checkBuildRevision('obscura 0.1.0-dev+76db0c9', revision), /Expected an Obscura build/);
  assert.throws(() => checkBuildRevision('obscura 0.1.0', revision), /Expected an Obscura build/);
});

test('fixture IDs are unique and the development and evaluation cohorts are populated', () => {
  assert.equal(fixtures.length, 30);
  assert.equal(new Set(fixtures.map(fixture => fixture.id)).size, 30);
  assert.equal(fixtures.filter(fixture => fixture.split === 'development').length, 20);
  assert.equal(fixtures.filter(fixture => fixture.split === 'evaluation').length, 10);
});

test('public page readiness checks its identity without requiring every measured fact', () => {
  const fixture = publicFixtures.find(fixture => fixture.id === 'python-tomllib');
  const { window } = new JSDOM('<h1>Request blocked</h1>', { runScripts: 'outside-only' });
  try {
    assert.equal(window.eval(readinessFor(fixture)), false);
    window.document.querySelector('h1').textContent = 'tomllib — Parse  TOML files';
    assert.equal(window.eval(readinessFor(fixture)), true);
    for (const page of publicFixtures) {
      assert.equal(new URL(page.url).protocol, 'https:');
      assert.ok(page.facts.length > 0);
    }
  } finally {
    window.close();
  }
});

test('raw fixtures contain their annotated facts and artifacts', () => {
  for (const fixture of fixtures) {
    const html = renderFixture(fixture).replace('<div id="results"></div>',
      `<div id="results">${fixture.dynamic ?? ''}</div>`);
    const result = measure(html, 'html', fixture, url);
    for (const fact of result.facts) assert.ok(fact.retained, `${fixture.id}: ${fact.text}`);
    for (const artifact of result.artifacts) assert.ok(artifact.retained, `${fixture.id}: ${artifact.selector}`);
  }
});

test('numeric, code and table checks detect losses independently', () => {
  const table = fixtures.find(fixture => fixture.id === 'table-prices');
  const html = renderFixture(table);
  const converted = measure(standardMarkdown(html, url), 'markdown', table, url);
  assert.ok(converted.artifacts.every(item => item.retained));
  assert.ok(converted.facts.every(item => item.retained));

  const changed = measure(standardMarkdown(html.replace('EUR 49.90', 'EUR 49.09'), url), 'markdown', table, url);
  assert.ok(changed.facts.some(item => item.criticalNumber && !item.retained));
  assert.deepEqual(changed.artifacts.map(item => item.retained), [true, false]);

  const code = fixtures.find(fixture => fixture.id === 'code-fences');
  const codeMarkdown = standardMarkdown(renderFixture(code), url);
  assert.ok(measure(codeMarkdown, 'markdown', code, url).artifacts[0].retained);
  assert.equal(measure(codeMarkdown.replace('  emit', 'emit'), 'markdown', code, url).artifacts[0].retained, false);
});

test('facts in JavaScript source only and content empty after extraction do not pass', () => {
  const fixture = fixtures.find(item => item.id === 'spa-orders');
  const evaluated = measure(renderFixture(fixture), 'html', fixture, url);
  assert.deepEqual(evaluated.facts.map(item => item.retained), [true, false]);
  assert.throws(() => measure('  ', 'markdown', fixture, url), /Empty content/);
});

test('the upstream serializer can read the snapshot without executing its scripts', () => {
  const html = '<body><script>document.body.id = "changed"</script><p>Fact.</p></body>';
  const result = evaluateSerializer(html, url, 'document.body.id + document.querySelector("p").textContent');
  assert.equal(result, 'Fact.');
});

test('Markdown formatting and equivalent link resolution preserve artifact checks', () => {
  const fixture = {
    facts: [],
    artifacts: [
      { kind: 'quote', selector: 'blockquote', exact: 'Two words' },
      { kind: 'link', selector: 'a', attribute: ['href', '/guide'] },
    ],
  };
  const evaluated = measure('> Two words\n\n[Guide](http://127.0.0.1:8080/guide)', 'markdown', fixture, url);
  assert.deepEqual(evaluated.artifacts.map(item => item.retained), [true, true]);
});
