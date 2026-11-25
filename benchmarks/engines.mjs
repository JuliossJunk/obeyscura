import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { fixtures, renderFixture } from './fixtures.mjs';

const viewport = { width: 1280, height: 720 };
const snapshot = 'document.documentElement.outerHTML';
const timeoutMs = 10_000;
const execute = promisify(execFile);

export function readinessFor(fixture) {
  if (!fixture.ready) return 'document.documentElement.getAttribute("data-ready") === "true"';
  const { selector, text } = fixture.ready;
  return `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(
    node => node.textContent.replace(/\\s+/gu, ' ').trim().includes(${JSON.stringify(text)})
  )`;
}

function httpError(status) {
  return Object.assign(new Error(`HTTP ${status ?? 'unknown'}`), { httpStatus: status });
}

async function listen(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: server.address().port };
}

export async function serveFixtures() {
  const pages = new Map(fixtures.map(fixture => [fixture.id, fixture]));
  const { server, port } = await listen((request, response) => {
    const [route, id] = request.url.slice(1).split('/');
    const fixture = pages.get(id);
    response.setHeader('Cache-Control', 'no-store');
    if (route === 'page' && fixture) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(renderFixture(fixture));
    } else if (route === 'data' && fixture?.fetch) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(fixture.dynamic);
    } else if (request.url === '/pixel.svg') {
      response.setHeader('Content-Type', 'image/svg+xml');
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
    } else {
      response.writeHead(404).end();
    }
  });
  return { origin: `http://127.0.0.1:${port}`, close: () => server.close() };
}

export async function launchChromium(channel, { publicPages = false } = {}) {
  const started = performance.now();
  const browser = await chromium.launch({ channel, chromiumSandbox: publicPages });
  const startupMs = performance.now() - started;
  return {
    version: browser.version(),
    startupMs,
    close: () => browser.close(),
    async capture(url, fixture, phase) {
      phase('setup');
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, acceptDownloads: false });
      try {
        phase('navigation');
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        if (!response?.ok()) throw httpError(response?.status());
        phase('readiness');
        if (fixture.action) await page.evaluate(selector => document.querySelector(selector).click(), fixture.action);
        await page.waitForFunction(readinessFor(fixture), null, { polling: 25, timeout: timeoutMs });
        phase('snapshot');
        const html = await page.evaluate(snapshot);
        return { html, url: page.url(), httpStatus: response.status() };
      } finally {
        await page.close();
      }
    },
  };
}

class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener('message', ({ data }) => {
      const reply = JSON.parse(data);
      if (reply.id === undefined) {
        if (reply.method === 'Network.responseReceived' && reply.params.type === 'Document') {
          this.events.push(reply);
        }
        return;
      }
      const pending = this.pending.get(reply.id);
      if (pending) {
        if (reply.error) pending.reject(new Error(reply.error.message));
        else pending.resolve(reply.result);
      }
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed'));
    });
  }

  async send(method, params = {}, sessionId) {
    const id = ++this.nextId;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
        this.pending.set(id, { resolve, reject });
        this.socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    } finally {
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }

  async evaluate(expression, sessionId) {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
    return reply.result.value;
  }
}

async function openCdp(url, signal) {
  const socket = new WebSocket(url);
  try {
    await once(socket, 'open', { signal });
    return new Cdp(socket);
  } catch (error) {
    socket.close();
    throw error;
  }
}

export function checkBuildRevision(version, expectedRevision) {
  if (!expectedRevision) return;
  const builtRevision = version.match(/-dev\+([a-f0-9]{7,40})$/u)?.[1];
  if (!builtRevision || !expectedRevision.startsWith(builtRevision)) {
    throw new Error(`Expected an Obscura build of ${expectedRevision}, got "${version}"`);
  }
}

async function inspectObscuraBinary(binary, expectedRevision) {
  const { stdout } = await execute(binary, ['--version'], { timeout: timeoutMs });
  const version = stdout.trim();
  checkBuildRevision(version, expectedRevision);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(binary)) hash.update(chunk);
  const binarySha256 = hash.digest('hex');
  return { version, binarySha256 };
}

export async function loadConverter(binary, expectedRevision) {
  const provenance = await inspectObscuraBinary(binary, expectedRevision);
  return {
    ...provenance,
    expectedRevision,
    convert(html) {
      return new Promise((resolve, reject) => {
        const process = execFile(binary, ['content'], { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
          (error, stdout) => error ? reject(error) : resolve(stdout));
        process.stdin.on('error', reject);
        process.stdin.end(html);
      });
    },
  };
}

export async function launchObscura(binary, expectedRevision, { publicPages = false } = {}) {
  const { version, binarySha256 } = await inspectObscuraBinary(binary, expectedRevision);
  const { server, port } = await listen();
  await promisify(server.close.bind(server))();
  const origin = `http://127.0.0.1:${port}`;
  const started = performance.now();
  const flags = publicPages ? [] : ['--allow-private-network'];
  const env = { ...process.env };
  if (publicPages) delete env.OBSCURA_ALLOW_PRIVATE_NETWORK;
  const child = spawn(binary, [...flags, 'serve', '--host', '127.0.0.1', '--port', String(port)], {
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let failure;
  let stderr = '';
  child.on('error', error => { failure = error; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
  let endpoint;
  try {
    while (performance.now() - started < timeoutMs && child.exitCode === null && !failure) {
      try {
        const version = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (version.ok) endpoint = (await version.json()).webSocketDebuggerUrl;
      } catch {
        // Expected before the listener is ready.
      }
      if (endpoint) break;
      await sleep(30);
    }
    if (!endpoint || new URL(endpoint).host !== `127.0.0.1:${port}`) {
      throw failure ?? new Error(`Obscura CDP did not start: ${stderr.trim()}`);
    }
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    version,
    binarySha256,
    startupMs: performance.now() - started,
    close: () => child.kill(),
    async capture(url, fixture, phase) {
      phase('setup');
      const cdp = await openCdp(endpoint, AbortSignal.timeout(timeoutMs));
      try {
        const { browserContextId } = await cdp.send('Target.createBrowserContext');
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Network.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false }, sessionId);
        phase('navigation');
        const navigation = await cdp.send('Page.navigate', { url, waitUntil: 'domcontentloaded' }, sessionId);
        if (navigation.errorText) throw new Error(navigation.errorText);
        const response = cdp.events.findLast(event => event.sessionId === sessionId && event.params.response.url === url);
        const httpStatus = response?.params.response.status ?? null;
        if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 300)) throw httpError(httpStatus);
        phase('readiness');
        if (fixture.action) {
          await cdp.evaluate(`document.querySelector(${JSON.stringify(fixture.action)}).click()`, sessionId);
        }
        const deadline = performance.now() + timeoutMs;
        const readiness = readinessFor(fixture);
        while (!(await cdp.evaluate(readiness, sessionId))) {
          if (performance.now() >= deadline) throw new Error('Readiness marker did not arrive');
          await sleep(25);
        }
        phase('snapshot');
        const html = await cdp.evaluate(snapshot, sessionId);
        const finalUrl = await cdp.evaluate('location.href', sessionId);
        phase('nativeMarkdown');
        let markdown;
        let markdownError;
        try {
          ({ markdown } = await cdp.send('LP.getMarkdown', {}, sessionId));
        } catch (error) {
          markdownError = error.message;
        }
        return { html, url: finalUrl, httpStatus, markdown, markdownError };
      } finally {
        cdp.socket.close();
      }
    },
  };
}
