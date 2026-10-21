import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { config } from './config.mjs';
import { sendJson, setCorsHeaders } from './lib/http.mjs';
import { recognitionRoutes } from './routes/recognition.mjs';

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

async function serveWebApp(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); } catch { return false; }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
  const buildRoot = resolve(config.webBuildDirectory);
  let filePath = resolve(buildRoot, relativePath);
  if (filePath !== buildRoot && !filePath.startsWith(`${buildRoot}${sep}`)) return false;

  let contents;
  try {
    contents = await readFile(filePath);
  } catch {
    if (extname(relativePath)) return false;
    filePath = resolve(buildRoot, 'index.html');
    try { contents = await readFile(filePath); } catch { return false; }
  }

  response.writeHead(200, {
    'content-type': contentTypes.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'content-length': contents.length,
    'cache-control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  response.end(request.method === 'HEAD' ? undefined : contents);
  return true;
}

export function createAppServer() {
  return createServer(async (request, response) => {
    const startedAt = Date.now();
    const client = request.socket.remoteAddress ?? 'unknown client';
    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
    if (request.method === 'GET' && pathname === '/health') {
      console.log(`[HTTP] GET /health from ${client}`);
      sendJson(response, 200, { ok: true });
      return;
    }

    const route = recognitionRoutes.get(pathname);
    if (request.method === 'POST' && route) {
      console.log(`[HTTP] POST ${pathname} from ${client} (content-length: ${request.headers['content-length'] ?? 'unknown'})`);
      const clientRequest = new AbortController();
      response.on('close', () => {
        if (!response.writableEnded) clientRequest.abort();
      });

      try {
        const result = await route({ request, signal: clientRequest.signal });
        if (clientRequest.signal.aborted) return;
        console.log(`[HTTP] ${pathname} completed with HTTP 200 in ${Date.now() - startedAt} ms`);
        sendJson(response, 200, result);
      } catch (error) {
        if (clientRequest.signal.aborted) return;
        const status = error?.status ?? 502;
        const message = error instanceof Error ? error.message : 'Recognition request failed.';
        console.error(`[HTTP] ${pathname} failed with HTTP ${status} in ${Date.now() - startedAt} ms: ${message}`);
        sendJson(response, status, { error: message });
      }
      return;
    }

    if (pathname === '/health' || pathname.startsWith('/recognition/')) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (!await serveWebApp(request, response, pathname)) sendJson(response, 404, { error: 'Not found.' });
  });
}
