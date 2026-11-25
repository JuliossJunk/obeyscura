import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { getEncoding } from 'js-tiktoken';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
turndown.use(gfm);
turndown.remove(['script', 'style', 'noscript', 'template']);
const markup = new MarkdownIt({ html: true });
const encodings = Object.fromEntries(['o200k_base', 'cl100k_base'].map(name => [name, getEncoding(name)]));
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => {
  if (error.type !== 'css parsing') console.warn(`jsdom: ${error.message}`);
});

function withDocument(html, url, fn, runScripts) {
  const { window } = new JSDOM(html, { url, virtualConsole, runScripts });
  try {
    return fn(window.document);
  } finally {
    window.close();
  }
}

export function evaluateSerializer(html, url, trustedScript) {
  // Only the trusted serializer runs. jsdom keeps scripts from the page inert.
  return withDocument(html, url, document => document.defaultView.eval(trustedScript), 'outside-only');
}

export function standardMarkdown(html, url, readability = false) {
  return withDocument(html, url, document => {
    if (!readability) return turndown.turndown(document.body);
    const article = new Readability(document).parse();
    if (!article?.content) throw new Error('Readability returned no content');
    return turndown.turndown(article.content);
  });
}

const normalize = text => text.replace(/\s+/gu, ' ').trim();

function attributeMatches(node, [name, value], url) {
  const actual = node.getAttribute(name);
  if (actual === null) return false;
  if (name === 'href' || name === 'src') {
    const expected = URL.parse(value, url);
    return expected !== null && URL.parse(actual, url)?.href === expected.href;
  }
  return actual === value;
}

export function measure(content, format, fixture, url) {
  if (typeof content !== 'string' || !content.trim()) throw new Error('Empty content');
  const evaluated = withDocument(format === 'markdown' ? markup.render(content) : content, url, document => {
    const artifacts = fixture.artifacts.map(({ kind, selector, exact, text, attribute, adjacent }) => ({
      kind, selector, exact, text, attribute, adjacent,
      retained: Array.from(document.querySelectorAll(selector)).some(node => {
        const nodeText = kind === 'code'
          ? (format === 'markdown' ? node.textContent.replace(/\n$/u, '') : node.textContent)
          : normalize(node.textContent);
        return (exact === undefined || nodeText === exact)
          && (text === undefined || nodeText.includes(text))
          && (attribute === undefined || attributeMatches(node, attribute, url))
          && (adjacent === undefined || node.nextElementSibling?.textContent === adjacent);
      }),
    }));
    for (const node of document.querySelectorAll('script, style, template, noscript')) node.remove();
    // Preserve inline text boundaries while preventing adjacent block text from fusing.
    for (const node of document.querySelectorAll('p,li,dt,dd,td,th,div,section,article,blockquote,br,h1,h2,h3,h4,h5,h6')) {
      node.after(' ');
    }
    const body = normalize(document.body.textContent);
    const facts = fixture.facts.map(text => ({
      text,
      criticalNumber: /\p{Nd}/u.test(text),
      retained: body.includes(text),
    }));
    return { facts, artifacts };
  });
  return {
    bytes: Buffer.byteLength(content),
    tokens: Object.fromEntries(Object.entries(encodings).map(([name, encoding]) => [
      name, encoding.encode(content, [], []).length,
    ])),
    ...evaluated,
  };
}
