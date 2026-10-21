import { httpError } from './errors.mjs';

export function setCorsHeaders(response) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
}

export function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readRequest(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw httpError('Audio clip is too large.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function parseAudioUpload(request, url, maxBytes) {
  const bytes = await readRequest(request, maxBytes);
  let form;
  try {
    const formRequest = new Request(url, { method: 'POST', headers: request.headers, body: bytes });
    form = await formRequest.formData();
  } catch {
    throw httpError('Audio upload must use multipart form data.', 400);
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) throw httpError('Audio file is required.', 400);
  return audio;
}

export async function parseJsonRequest(request, maxBytes) {
  const bytes = await readRequest(request, maxBytes);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw httpError('A valid JSON request body is required.', 400);
  }
}
