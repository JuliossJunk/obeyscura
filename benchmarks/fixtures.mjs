export const datasetVersion = 'local-v1';

const cases = [
  {
    id: 'docs-quickstart', category: 'documentation', title: 'Quickstart',
    body: '<p>The local API listens on port 7143.</p><h2>Start a session</h2><pre><code>obey run --port 7143\nobey status</code></pre>',
    facts: ['The local API listens on port 7143.'],
    artifacts: [{ kind: 'code', selector: 'pre code', exact: 'obey run --port 7143\nobey status' }],
  },
  {
    id: 'repository-readme', category: 'repository', title: 'Kite repository',
    body: '<p>The Kite package is distributed under the MIT license.</p><h2>Contributing</h2><p>Changes require one maintainer review.</p><a href="https://code.example/kite/contributing">Contribution guide</a>',
    facts: ['The Kite package is distributed under the MIT license.', 'Changes require one maintainer review.'],
    artifacts: [{ kind: 'link', selector: 'a', text: 'Contribution guide', attribute: ['href', 'https://code.example/kite/contributing'] }],
  },
  {
    id: 'wiki-canals', category: 'encyclopedia', title: 'Lark Canal',
    body: '<p>The Lark Canal opened to commercial traffic in 1872.</p><p>Its summit lock is 16 metres above sea level.</p><h2>Navigation</h2><h3>Summit lock</h3><p>Traffic through the lock is one way.</p>',
    facts: ['The Lark Canal opened to commercial traffic in 1872.', 'Its summit lock is 16 metres above sea level.', 'Traffic through the lock is one way.'],
    artifacts: [{ kind: 'heading', selector: 'h2 + h3', exact: 'Summit lock' }],
  },
  {
    id: 'news-transit', category: 'news', title: 'New tram route',
    body: '<p>The city approved a tram route serving Cedar Wharf.</p><p>The extension adds 2.8 km of track.</p><blockquote>We start with the riverside stop.</blockquote><p>Construction begins in September.</p>',
    facts: ['The city approved a tram route serving Cedar Wharf.', 'The extension adds 2.8 km of track.', 'Construction begins in September.'],
    artifacts: [{ kind: 'quote', selector: 'blockquote', text: 'We start with the riverside stop.' }],
  },
  {
    id: 'paper-sampling', category: 'scientific', title: 'Coastal sampling',
    body: '<h2>Methods</h2><p>The study sampled 42 coastal sites twice.</p><h2>Results</h2><p>Median salinity was 33.4 PSU.</p><p>Measurements were taken before sunrise.</p>',
    facts: ['The study sampled 42 coastal sites twice.', 'Median salinity was 33.4 PSU.', 'Measurements were taken before sunrise.'],
  },
  {
    id: 'blog-cache', category: 'technical-blog', title: 'Cache sizing',
    body: '<p>The example reserves 96 MiB for cached pages.</p><p>The cache evicts the least recently used entries.</p><pre><code>cache = LruCache(96 * 1024 * 1024)\ncache.put("key", page)</code></pre>',
    facts: ['The example reserves 96 MiB for cached pages.', 'The cache evicts the least recently used entries.'],
    artifacts: [{ kind: 'code', selector: 'pre code', exact: 'cache = LruCache(96 * 1024 * 1024)\ncache.put("key", page)' }],
  },
  {
    id: 'shop-coffee', category: 'e-commerce', title: 'Juniper coffee',
    body: '<p>The bag contains 340 g of whole beans.</p><p>The shelf price is EUR 12.40.</p><p>Ground coffee ships in a separate package.</p>',
    facts: ['The bag contains 340 g of whole beans.', 'The shelf price is EUR 12.40.', 'Ground coffee ships in a separate package.'],
  },
  {
    id: 'product-sensor', category: 'product-specification', title: 'Beacon S7',
    body: '<p>The operating range is -10 °C to 55 °C.</p><p>The sensor accepts 9 V DC input.</p><h2>Calibration</h2><p>Calibration requires dry air.</p>',
    facts: ['The operating range is -10 °C to 55 °C.', 'The sensor accepts 9 V DC input.', 'Calibration requires dry air.'],
  },
  {
    id: 'forum-wifi', category: 'forum', title: 'Intermittent Wi-Fi',
    body: '<section><h2>Question</h2><p>The device loses its Wi-Fi connection after hibernation.</p></section><section><h2>Accepted answer</h2><p>Version 3.2.1 fixes the wake-up timeout.</p></section>',
    facts: ['The device loses its Wi-Fi connection after hibernation.', 'Version 3.2.1 fixes the wake-up timeout.'],
  },
  {
    id: 'discussion-advice', category: 'threaded-discussion', title: 'Picking a route',
    body: '<h2>Trail update</h2><p>The south trail closes at 18:30.</p><blockquote>The bridge reopened on Tuesday.</blockquote><p>The north entrance has a water fountain.</p>',
    facts: ['The south trail closes at 18:30.', 'The north entrance has a water fountain.'],
    artifacts: [{ kind: 'quote', selector: 'blockquote', text: 'The bridge reopened on Tuesday.' }],
  },
  {
    id: 'spa-orders', category: 'spa', title: 'Orders dashboard',
    body: '<p>Order totals update after the dashboard loads.</p><div id="results"></div>',
    dynamic: '<p>The Portland queue holds 27 open orders.</p>',
    delay: 30,
    facts: ['Order totals update after the dashboard loads.', 'The Portland queue holds 27 open orders.'],
  },
  {
    id: 'js-inventory', category: 'javascript-heavy', title: 'Inventory report',
    body: '<p>Counts exclude returned units.</p><div id="results"></div>',
    dynamic: '<h2>Warehouse status</h2><p>Warehouse Q has 61 compatible adapters.</p>',
    delay: 80,
    fetch: true,
    facts: ['Counts exclude returned units.', 'Warehouse Q has 61 compatible adapters.'],
  },
  {
    id: 'table-prices', category: 'table', title: 'Service plans',
    body: '<p>Prices are billed monthly in euros.</p><table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Team</td><td>EUR 49.90</td></tr><tr><td>Enterprise</td><td>EUR 90</td></tr></tbody></table>',
    facts: ['Prices are billed monthly in euros.', 'EUR 49.90', 'EUR 90'],
    artifacts: [{ kind: 'table', selector: 'table thead tr th:nth-child(2)', exact: 'Price' }, { kind: 'table', selector: 'tr td:first-child', exact: 'Team', adjacent: 'EUR 49.90' }],
  },
  {
    id: 'table-spans', category: 'table', title: 'Laboratory results',
    body: '<p>Readings are reported at room temperature.</p><table><caption>Thermal tests</caption><thead><tr><th colspan="2">Peak readings</th></tr></thead><tbody><tr><td>Probe D</td><td>12.7 W</td></tr></tbody></table>',
    facts: ['Readings are reported at room temperature.', '12.7 W'],
    artifacts: [{ kind: 'table', selector: 'table caption', exact: 'Thermal tests' }, { kind: 'table', selector: 'table th', exact: 'Peak readings', attribute: ['colspan', '2'] }],
  },
  {
    id: 'math-energy', category: 'formula', title: 'Stored energy',
    body: '<p>Use farads for capacitance and volts for potential.</p><p>The reference capacitor is 18 µF.</p><math><mrow><mi>E</mi><mo>=</mo><mn>½</mn><mi>C</mi><msup><mi>V</mi><mn>2</mn></msup></mrow></math>',
    facts: ['Use farads for capacitance and volts for potential.', 'The reference capacitor is 18 µF.'],
    artifacts: [{ kind: 'formula', selector: 'math msup', exact: 'V2' }],
  },
  {
    id: 'multilingual-museum', category: 'multilingual', lang: 'ru', title: 'Расписание музея',
    body: '<p>По средам музей открывается в 11:30.</p><p lang="de">Kinder unter sieben Jahren haben freien Eintritt.</p><p lang="ja">最終入館は午後五時です。</p>',
    facts: ['По средам музей открывается в 11:30.', 'Kinder unter sieben Jahren haben freien Eintritt.', '最終入館は午後五時です。'],
  },
  {
    id: 'nested-safety', category: 'nested-list', title: 'Inspection order',
    body: '<p>The procedure applies to model TR9.</p><ol start="4"><li>Inspect the inlet.<ul><li>Check the lower seal.</li><li>Record a pressure of 26 kPa.</li></ul></li><li>Confirm the outlet is clear.</li></ol>',
    facts: ['The procedure applies to model TR9.', 'Record a pressure of 26 kPa.'],
    artifacts: [{ kind: 'list', selector: 'ol > li > ul > li', exact: 'Check the lower seal.' }, { kind: 'list', selector: 'ol', attribute: ['start', '4'] }],
  },
  {
    id: 'code-fences', category: 'code', title: 'Writing a fenced example',
    body: '<p>The example prints a shell prompt.</p><pre><code>emit("```")\n\n\n  emit("$ status")</code></pre>',
    facts: ['The example prints a shell prompt.'],
    artifacts: [{ kind: 'code', selector: 'pre code', exact: 'emit("```")\n\n\n  emit("$ status")' }],
  },
  {
    id: 'lazy-catalog', category: 'lazy-loading', title: 'Catalogue appendices',
    body: '<p>Appendices use a separate catalogue request.</p><div id="results"></div><button id="reveal">Load appendix</button>',
    dynamic: '<p>Appendix H lists 14 spare regulators.</p>',
    delay: 55,
    fetch: true,
    action: '#reveal',
    facts: ['Appendices use a separate catalogue request.', 'Appendix H lists 14 spare regulators.'],
  },
  {
    id: 'disclosure-warranty', category: 'disclosure', title: 'Warranty details',
    body: '<p>Warranty applies to the original buyer.</p><details><summary>Battery coverage</summary><p>The battery warranty lasts 18 months.</p></details>',
    facts: ['Warranty applies to the original buyer.', 'The battery warranty lasts 18 months.'],
    artifacts: [{ kind: 'disclosure', selector: 'details > summary', exact: 'Battery coverage' }],
  },
  {
    id: 'metadata-venue', category: 'structured-metadata', title: 'Marigold Theatre',
    head: '<meta property="og:locale" content="en_GB"><script type="application/ld+json">{"@context":"https://schema.org","@type":"Place","identifier":"venue-02492"}</script>',
    body: '<p>The Marigold Theatre seats 318 guests.</p><p>The box office faces Rowan Road.</p>',
    facts: ['The Marigold Theatre seats 318 guests.', 'The box office faces Rowan Road.'],
    artifacts: [{ kind: 'metadata', selector: 'meta[property="og:locale"]', attribute: ['content', 'en_GB'] }, { kind: 'metadata', selector: 'script[type="application/ld+json"]', text: '"identifier":"venue-02492"' }],
  },
  {
    id: 'news-correction', category: 'news', title: 'Reservoir repair update',
    body: '<p>The west gate will reopen next Thursday.</p><p>A crew renewed the gate hinge last week.</p>',
    aside: '<aside><h2>Correction</h2><p>The closure lasted 36 hours.</p></aside>',
    facts: ['The west gate will reopen next Thursday.', 'A crew renewed the gate hinge last week.', 'The closure lasted 36 hours.'],
  },
  {
    id: 'docs-references', category: 'documentation', title: 'Job scheduling reference',
    body: '<p>A workspace accepts up to 23 queued jobs.</p><p><a href="https://manual.example/reference/jobs?view=limits#queue">Queue limits</a></p><p><a href="https://manual.example/reference/jobs?view=limits#queue">Retry guidance</a></p>',
    facts: ['A workspace accepts up to 23 queued jobs.'],
    artifacts: [{ kind: 'link', selector: 'a', text: 'Queue limits', attribute: ['href', 'https://manual.example/reference/jobs?view=limits#queue'] }, { kind: 'link', selector: 'a', text: 'Retry guidance', attribute: ['href', 'https://manual.example/reference/jobs?view=limits#queue'] }],
  },
  {
    id: 'paper-footnote', category: 'scientific', title: 'Snow chemistry',
    body: '<p>The station collected 18 samples in February.</p><p>Note: <a href="#method-note">Sample storage</a>.</p><p id="method-note">Sample tubes were stored at -20 °C.</p>',
    facts: ['The station collected 18 samples in February.', 'Sample tubes were stored at -20 °C.'],
    artifacts: [{ kind: 'link', selector: 'a', text: 'Sample storage', attribute: ['href', '#method-note'] }],
  },
  {
    id: 'shop-shipping', category: 'e-commerce', title: 'Ceramic grinder',
    body: '<p>The burr diameter is 48 mm.</p><p>The lid is made from walnut.</p>',
    aside: '<footer><p>Delivery is free above GBP 70.</p></footer>',
    facts: ['The burr diameter is 48 mm.', 'The lid is made from walnut.', 'Delivery is free above GBP 70.'],
  },
  {
    id: 'blog-example', category: 'technical-blog', title: 'A copying example',
    body: '<p>The delay between attempts is 750 ms.</p><pre><code>cp "draft &amp; notes.txt" ./backup/\n  printf "%s" done</code></pre>',
    facts: ['The delay between attempts is 750 ms.'],
    artifacts: [{ kind: 'code', selector: 'pre code', exact: 'cp "draft & notes.txt" ./backup/\n  printf "%s" done' }],
  },
  {
    id: 'spa-alert', category: 'spa', title: 'Station status',
    body: '<p>This dashboard refreshes in the background.</p><div id="results"></div>',
    dynamic: '<section><h2>Current alert</h2><p>Platform 6 is closed until 21:15.</p></section>',
    delay: 100,
    fetch: true,
    facts: ['This dashboard refreshes in the background.', 'Platform 6 is closed until 21:15.'],
    artifacts: [{ kind: 'heading', selector: 'h2', exact: 'Current alert' }],
  },
  {
    id: 'wiki-fossils', category: 'encyclopedia', title: 'Fossils of North Ridge',
    body: '<p>The sandstone layer is 110 million years old.</p><p>The collection is owned by the county archive.</p><h2>Finds</h2><h3>Specimen group B</h3><p>The site yielded 68 specimens.</p>',
    facts: ['The sandstone layer is 110 million years old.', 'The collection is owned by the county archive.', 'The site yielded 68 specimens.'],
    artifacts: [{ kind: 'heading', selector: 'h2 + h3', exact: 'Specimen group B' }],
  },
  {
    id: 'forum-log', category: 'forum', title: 'Service watchdog',
    body: '<p>The process restarted after 47 seconds.</p><p>The watchdog has a grace period of 5 seconds.</p><blockquote>restart reason: timeout</blockquote>',
    facts: ['The process restarted after 47 seconds.', 'The watchdog has a grace period of 5 seconds.'],
    artifacts: [{ kind: 'quote', selector: 'blockquote', exact: 'restart reason: timeout' }],
  },
  {
    id: 'product-diagram', category: 'product-specification', title: 'Water filter V5',
    body: '<p>The maximum flow is 3.6 L/min.</p><p>The inlet uses the left-hand fitting.</p><figure><img src="/pixel.svg" alt="Inlet on the left"><figcaption>Figure A shows inlet orientation.</figcaption></figure>',
    facts: ['The maximum flow is 3.6 L/min.', 'The inlet uses the left-hand fitting.', 'Figure A shows inlet orientation.'],
    artifacts: [{ kind: 'image', selector: 'img[alt="Inlet on the left"]', attribute: ['src', '/pixel.svg'] }],
  },
];

export const fixtures = cases.map((fixture, index) => ({
  ...fixture,
  split: index % 3 === 2 ? 'evaluation' : 'development',
  artifacts: fixture.artifacts ?? [],
  chromeRepeats: index % 5,
}));

const nav = '<nav aria-label="Site"><a href="/site">Home</a> <a href="/help">Help centre</a> <a href="/privacy">Privacy choices</a> <a href="/language">Language settings</a></nav>';

export function renderFixture(fixture) {
  const chrome = nav.repeat(fixture.chromeRepeats);
  const ready = fixture.dynamic ? 'pending' : 'true';
  const script = fixture.dynamic ? `<script>
    function populate() {
      setTimeout(async function () {
        const target = document.getElementById('results');
        target.innerHTML = ${fixture.fetch ? "await (await fetch('/data/" + fixture.id + "')).text()" : JSON.stringify(fixture.dynamic)};
        document.documentElement.setAttribute('data-ready', 'true');
      }, ${fixture.delay});
    }
    ${fixture.action ? "document.querySelector('#reveal').addEventListener('click', populate, {once: true});" : 'populate();'}
  </script>` : '';
  return `<!doctype html><html lang="${fixture.lang ?? 'en'}" data-ready="${ready}"><head><meta charset="utf-8"><title>${fixture.title}</title>${fixture.head ?? ''}</head>
    <body><header>${chrome}</header><main><article><h1>${fixture.title}</h1>${fixture.body}</article></main>${fixture.aside ?? ''}
    <footer>${chrome}</footer>${script}</body></html>`;
}
