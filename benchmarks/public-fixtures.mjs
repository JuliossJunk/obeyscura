export const datasetVersion = 'public-v1';

// Short phrases from the linked sources serve as text anchors. The readiness
// selector identifies the expected page independently of its scored facts.
export const fixtures = [
  {
    id: 'python-tomllib',
    category: 'documentation',
    split: 'development',
    url: 'https://docs.python.org/3.12/library/tomllib.html',
    ready: { selector: 'h1', text: 'Parse TOML files' },
    facts: ['parsing TOML 1.0.0', 'does not support writing TOML', 'readable and binary file object'],
    artifacts: [{ kind: 'link', selector: 'a', text: 'Tomli-W package', attribute: ['href', 'https://pypi.org/project/tomli-w/'] }],
  },
  {
    id: 'rfc9110',
    category: 'standards',
    split: 'evaluation',
    url: 'https://www.rfc-editor.org/rfc/rfc9110.html',
    ready: { selector: '#name-404-not-found', text: '404 Not Found' },
    facts: ['stateless application-level protocol', 'did not find a current representation', 'this lack of representation is temporary or permanent'],
    artifacts: [{ kind: 'heading', selector: 'h4', text: '404 Not Found' }],
  },
  {
    id: 'mdn-details',
    category: 'code',
    split: 'development',
    url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details',
    ready: { selector: 'h1', text: 'HTML details disclosure element' },
    facts: ['toggled into an open state', 'makes the details visible because this attribute is Boolean'],
    artifacts: [{ kind: 'code', selector: 'pre', text: '<summary>System Requirements</summary>' }],
  },
  {
    id: 'arxiv-transformer',
    category: 'scientific-article',
    split: 'evaluation',
    url: 'https://arxiv.org/abs/1706.03762v7',
    ready: { selector: 'h1.title', text: 'Attention Is All You Need' },
    facts: ['based solely on attention mechanisms', '28.4 BLEU on the WMT 2014', 'BLEU score of 41.8'],
    artifacts: [{ kind: 'link', selector: 'a', text: 'View PDF', attribute: ['href', 'https://arxiv.org/pdf/1706.03762v7'] }],
  },
  {
    id: 'wai-irregular-tables',
    category: 'table',
    split: 'development',
    url: 'https://www.w3.org/WAI/tutorials/tables/irregular/',
    ready: { selector: 'h1', text: 'Tables with Irregular Headers' },
    facts: ['span multiple columns and/or rows', 'Table with two tier headers', 'A column group is defined'],
    artifacts: [
      { kind: 'table', selector: 'th[scope="colgroup"]', exact: 'Mars', attribute: ['colspan', '2'] },
      { kind: 'table', selector: 'table caption', exact: 'Poster availability' },
    ],
  },
  {
    id: 'wikipedia-iso8601',
    category: 'encyclopedia',
    split: 'evaluation',
    url: 'https://en.wikipedia.org/wiki/ISO_8601',
    ready: { selector: 'h1', text: 'ISO 8601' },
    facts: ['published as ISO 8601:1988 in June 1988', '24-hour timekeeping system', 'greatest temporal term'],
    artifacts: [{ kind: 'heading', selector: 'h2', text: 'History' }],
  },
];
