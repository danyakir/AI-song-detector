import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { config } from '../config.mjs';
import { httpError } from '../lib/errors.mjs';
import { readAcrResources, writeAcrResources } from './acrCloudResourceStore.mjs';

async function acrRequest(url, options = {}) {
  const token = process.env.ACRCLOUD_API_TOKEN;
  if (!token) throw httpError('ACRCLOUD_API_TOKEN is required.', 503);
  const response = await fetch(url, {
    ...options,
    headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...options.headers },
  });
  const bodyText = await response.text();
  let body;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch { body = null; }
  const parsedUrl = new URL(url);
  if (parsedUrl.pathname.includes('/fs-containers/') && parsedUrl.pathname.includes('/files')) {
    console.log(`[ACRCloud] ${options.method ?? 'GET'} ${parsedUrl.pathname}${parsedUrl.search} -> ${response.status}`);
    console.log('[ACRCloud] response body:', JSON.stringify(body));
  }
  if (!response.ok) {
    const message = body?.message ?? body?.error ?? `ACRCloud request failed (${response.status}).`;
    throw httpError(message, response.status === 401 ? 503 : 502);
  }
  return body;
}

function getRecords(body) {
  const data = body?.data ?? body;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function getRegion() {
  const value = process.env.ACRCLOUD_REGION ?? 'eu-west-1';
  if (!config.acrRegions.has(value)) {
    throw new Error('ACRCLOUD_REGION must be eu-west-1, us-west-2, or ap-southeast-1.');
  }
  return value;
}

async function createOrFindContainer() {
  const selectedRegion = getRegion();
  if (process.env.ACRCLOUD_CONTAINER_ID) {
    return { id: process.env.ACRCLOUD_CONTAINER_ID, region: selectedRegion };
  }

  const resources = await readAcrResources();
  if (resources.containerId && resources.region === selectedRegion) {
    return { id: resources.containerId, region: selectedRegion };
  }

  const containerName = process.env.ACRCLOUD_CONTAINER_NAME ?? 'AI Song Detector';
  const lookupUrl = new URL('https://api-v2.acrcloud.com/api/fs-containers');
  lookupUrl.searchParams.set('region', selectedRegion);
  lookupUrl.searchParams.set('name', containerName);
  const existing = await acrRequest(lookupUrl.toString());
  const matchingContainer = getRecords(existing).find((container) =>
    String(container?.name ?? '').toLowerCase() === containerName.toLowerCase()
    && container?.region === selectedRegion
    && container?.id != null,
  );
  if (matchingContainer) {
    const containerId = String(matchingContainer.id);
    await writeAcrResources({ ...resources, containerId, region: selectedRegion });
    return { id: containerId, region: selectedRegion };
  }

  let bucketId = resources.bucketId;
  if (!bucketId) {
    const bucketName = process.env.ACRCLOUD_BUCKET_NAME ?? 'ACRCloud Music';
    const buckets = await acrRequest('https://api-v2.acrcloud.com/api/buckets');
    const matchingBucket = getRecords(buckets).find((bucket) =>
      String(bucket?.name ?? '').toLowerCase() === bucketName.toLowerCase() && bucket?.id != null,
    );
    bucketId = matchingBucket?.id == null ? null : String(matchingBucket.id);
    if (!bucketId) {
      const createdBucket = await acrRequest('https://api-v2.acrcloud.com/api/buckets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: bucketName, region: selectedRegion, type: 'File', labels: ['Music'], net_type: 0 }),
      });
      const createdBucketId = createdBucket?.data?.id ?? createdBucket?.id;
      if (!createdBucketId) throw new Error('ACRCloud created no bucket ID in its response.');
      bucketId = String(createdBucketId);
    }
    await writeAcrResources({ bucketId, region: selectedRegion });
  }

  const createdContainer = await acrRequest('https://api-v2.acrcloud.com/api/fs-containers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: containerName,
      region: selectedRegion,
      buckets: [bucketId],
      audio_type: 'recorded',
      engine: 5,
      policy: { type: 'traverse', interval: 0, rec_length: 30, ai_detection: 1 },
      ai_detection: 1,
      music_detection: 1,
    }),
  });
  const containerId = createdContainer?.data?.id ?? createdContainer?.id;
  if (!containerId) throw new Error('ACRCloud created no file-scanning container ID in its response.');
  await writeAcrResources({ bucketId, containerId, region: selectedRegion });
  return { id: containerId, region: selectedRegion };
}

let containerSetupPromise;

async function ensureContainer() {
  if (!containerSetupPromise) {
    containerSetupPromise = createOrFindContainer().finally(() => {
      containerSetupPromise = undefined;
    });
  }
  return containerSetupPromise;
}

function getFileRecord(body) {
  const data = body?.data ?? body;
  return Array.isArray(data) ? data[0] : data;
}

function normalizeAiResult(file) {
  const detections = file?.results?.ai_detection;
  if (!Array.isArray(detections) || detections.length === 0) {
    return { isAi: null, generator: null, score: null };
  }
  const detection = detections.find((item) => item.stem === 'original') ?? detections[0];
  if (detection.prediction === 'ai_generated') {
    return {
      isAi: true,
      generator: detection.likely_source ?? null,
      score: typeof detection.ai_probability === 'number' ? detection.ai_probability / 100 : null,
    };
  }
  if (detection.prediction === 'human') return { isAi: false, generator: null, score: null };
  return { isAi: null, generator: null, score: null };
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function saveDebugRecording(audio, { filename, source }) {
  if (!config.saveDebugRecordings) return;
  await mkdir(config.debugRecordingsDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = filename.split('.').at(-1)?.replace(/[^a-z0-9]/gi, '') || 'audio';
  const path = join(config.debugRecordingsDirectory, `ai-song-detector-${source}-${timestamp}.${extension}`);
  await writeFile(path, Buffer.from(await audio.arrayBuffer()));
  console.log(`[ACRCloud] Saved outgoing clip for debugging: ${path}`);
}

export async function scanWithAcrCloud(audio, { filename = 'recording.wav', source = 'capture', signal } = {}) {
  await saveDebugRecording(audio, { filename, source });
  const container = await ensureContainer();
  if (signal?.aborted) throw new DOMException('Recognition was cancelled.', 'AbortError');
  const baseUrl = `https://api-${container.region}.acrcloud.com/api/fs-containers/${encodeURIComponent(container.id)}`;

  const upload = new FormData();
  upload.append('file', audio, basename(filename));
  upload.append('data_type', 'audio');
  console.log(`[ACRCloud] Uploading ${source} clip (${audio.size} bytes, ${audio.type || 'unknown type'}, ${filename}).`);
  const uploaded = await acrRequest(`${baseUrl}/files`, { method: 'POST', body: upload, signal });
  const file = uploaded?.data ?? uploaded;
  const fileId = file?.id ?? file?.file_id;
  if (!fileId) throw new Error('ACRCloud did not return an uploaded file ID.');

  try {
    for (let attempt = 0; attempt < 45; attempt += 1) {
      const detail = await acrRequest(`${baseUrl}/files/${encodeURIComponent(fileId)}?with_result=1`, { signal });
      const record = getFileRecord(detail);
      const state = Number(record?.state);
      if (state === 1) {
        const result = normalizeAiResult(record);
        console.log('[ACRCloud] normalized verdict:', JSON.stringify(result));
        return result;
      }
      if (state === -1) return { isAi: null, generator: null, score: null };
      if (state < -1) throw new Error(`ACRCloud file scan failed (state ${state}).`);
      await delay(2000);
      if (signal?.aborted) throw new DOMException('Recognition was cancelled.', 'AbortError');
    }
    throw new Error('ACRCloud is still processing this recording. Please try again.');
  } finally {
    try {
      await acrRequest(`${baseUrl}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    } catch {
      // Keep the recognition result if remote cleanup is unavailable.
    }
  }
}

export async function scanAcrCloudPreview(previewUrl, signal) {
  let url;
  try { url = new URL(previewUrl); } catch {
    throw httpError('AudD returned an invalid Apple Music preview URL.', 400);
  }
  if (url.protocol !== 'https:' || url.hostname !== 'audio-ssl.itunes.apple.com' || url.port || url.username || url.password) {
    throw httpError('The Apple Music preview URL uses an unsupported host.', 400);
  }

  const timeout = AbortSignal.timeout(20_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, { redirect: 'manual', signal: requestSignal });
  if (!response.ok) throw new Error(`Could not fetch the Apple Music preview (${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > config.maxUploadBytes) throw httpError('Apple Music preview is too large.', 413);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > config.maxUploadBytes) {
    throw httpError('Apple Music preview is empty or too large.', bytes.length ? 413 : 502);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0] || 'audio/mp4';
  const audio = new Blob([bytes], { type: contentType });
  console.log(`[AudD] Downloaded Apple Music preview (${bytes.length} bytes, ${contentType}).`);
  return scanWithAcrCloud(audio, { filename: 'apple-music-preview.m4a', source: 'apple-music-preview', signal });
}
