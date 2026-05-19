import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageDir = resolve(__dirname, '..');
const output = resolve(pageDir, 'assets', 'preview_spin.gif');
const tempDir = resolve(pageDir, '.gif-capture-profile');

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const port = 9333;
const width = 960;
const height = 540;
const frames = 36;
const delay = 80;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function waitForJson(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve: ok, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else ok(message.result);
    }
  });
  return new Promise((resolveConnect, rejectConnect) => {
    ws.addEventListener('open', () => {
      resolveConnect({
        send(method, params = {}, sessionId = undefined) {
          id += 1;
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          ws.send(JSON.stringify(payload));
          return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener('error', rejectConnect);
  });
}

async function evaluate(client, sessionId, expression, awaitPromise = false) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function waitForPreview(client, sessionId) {
  const start = Date.now();
  while (Date.now() - start < 120000) {
    const ready = await evaluate(client, sessionId, 'window.__previewReady === true');
    if (ready) return;
    await sleep(500);
  }
  throw new Error('Preview did not finish loading GLB assets.');
}

function encodeGif(pngBuffers) {
  const gif = GIFEncoder();
  pngBuffers.forEach((buffer) => {
    const png = PNG.sync.read(buffer);
    const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength);
    const palette = quantize(rgba, 256, { format: 'rgba4444' });
    const index = applyPalette(rgba, palette, 'rgba4444');
    gif.writeFrame(index, png.width, png.height, { palette, delay });
  });
  gif.finish();
  return Buffer.from(gif.bytes());
}

async function main() {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const browser = spawn(edge, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${tempDir}`,
    '--headless',
    '--disable-gpu',
    '--no-first-run',
    '--disable-background-networking',
    `--window-size=${width},${height}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const client = await connect(version.webSocketDebuggerUrl);
    const target = await client.send('Target.createTarget', {
      url: 'about:blank'
    });
    const attached = await client.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true
    });
    const sessionId = attached.sessionId;

    await client.send('Page.enable', {}, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    }, sessionId);

    await client.send('Page.navigate', {
      url: 'http://127.0.0.1:8011/preview.html?capture=1'
    }, sessionId);
    await waitForPreview(client, sessionId);
    await sleep(1000);

    const captures = [];
    for (let i = 0; i < frames; i += 1) {
      const angle = (Math.PI * 2 * i) / frames;
      await evaluate(client, sessionId, `window.__setCaptureAngle(${angle})`);
      await sleep(90);
      const shot = await client.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false
      }, sessionId);
      captures.push(Buffer.from(shot.data, 'base64'));
      process.stdout.write(`frame ${String(i + 1).padStart(2, '0')}/${frames}\r`);
    }

    writeFileSync(output, encodeGif(captures));
    process.stdout.write(`\nWrote ${output}\n`);
    client.close();
  } finally {
    browser.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
