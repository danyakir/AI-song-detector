import type { RecognitionResult } from '../recognition.types';
import { Platform } from 'react-native';
import { File, Paths, UploadType } from 'expo-file-system';

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_RECOGNITION_API_URL
  ?? (Platform.OS === 'web' ? '' : 'http://localhost:8787');
// Android emulators reach the host computer through 10.0.2.2; localhost is the emulator itself.
export const apiBaseUrl = Platform.OS === 'android'
  ? configuredApiBaseUrl.replace(/^http:\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, 'http://10.0.2.2')
  : configuredApiBaseUrl;
const HEALTH_TIMEOUT_MS = 4_000;
const AUDD_TIMEOUT_MS = 30_000;
const ACRCLOUD_TIMEOUT_MS = 60_000;

export type RecognitionAudio = Blob | {
  uri: string;
  name: string;
  type: string;
  cleanup: () => void;
};

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let didTimeout = false;
  const forwardAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
      reject(new Error('Recognition request timed out.'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([fetch(url, { ...init, signal: controller.signal }), timeoutPromise]);
  } catch (error) {
    console.error(`[Detector] HTTP request failed for ${url}:`, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    if (didTimeout) {
      throw new Error(`The recognition server did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check that npm run server is running and reachable at ${apiBaseUrl}.`);
    }
    if (externalSignal?.aborted) throw error;
    throw new Error(`Could not reach the recognition server at ${apiBaseUrl}. Check that npm run server is running and that the device can reach this computer.`);
  } finally {
    if (timeout) clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

export async function checkRecognitionServer(signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${apiBaseUrl}/health`, { method: 'GET', signal }, HEALTH_TIMEOUT_MS);
  } catch {
    throw new Error(`Can't connect to the recognition server at ${apiBaseUrl}. Start it on your computer with npm run server, then try again.`);
  }
  if (!response.ok) throw new Error(`The recognition server at ${apiBaseUrl} returned HTTP ${response.status}. Restart it with npm run server and try again.`);
}

async function postAudio<T>(path: string, audio: RecognitionAudio, signal?: AbortSignal, timeoutMs = AUDD_TIMEOUT_MS): Promise<T> {
  const isNativeFile = !(audio instanceof Blob);
  try {
    console.log(`[Detector] POST ${path} (${isNativeFile ? audio.name : `${audio.size} byte blob`})`);
    let status: number;
    let responseBody: string;
    if (isNativeFile) {
      const file = new File(audio.uri);
      const task = file.createUploadTask(`${apiBaseUrl}${path}`, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'audio',
        mimeType: audio.type,
        signal,
      });
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          task.cancel();
          reject(new Error(`Recognition request timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);
      });
      try {
        const uploaded = await Promise.race([task.uploadAsync(), timeoutPromise]);
        status = uploaded.status;
        responseBody = uploaded.body;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } else {
      const body = new FormData();
      body.append('audio', audio, 'recording.wav');
      const response = await fetchWithTimeout(`${apiBaseUrl}${path}`, { method: 'POST', body, signal }, timeoutMs);
      status = response.status;
      responseBody = await response.text();
    }
    let data: T & { error?: string };
    try { data = JSON.parse(responseBody) as T & { error?: string }; } catch {
      throw new Error(`Recognition service returned invalid JSON (HTTP ${status}).`);
    }
    if (status < 200 || status >= 300) throw new Error(data.error ?? `Recognition service failed (${status}).`);
    console.log(`[Detector] ${path} responded HTTP ${status}`);
    return data;
  } catch (error) {
    console.error(`[Detector] Upload failed for ${path}:`, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    throw error;
  } finally {
    if (isNativeFile) audio.cleanup();
  }
}

export type AuddResponse = { match: { title: string; artist: string; previewUrl: string | null; youtubeUrl: string | null } | null };
export type AcrCloudResponse = { isAi: boolean | null; generator: string | null; score: number | null };

export async function identifySong(audio: RecognitionAudio, signal?: AbortSignal): Promise<AuddResponse> {
  return postAudio<AuddResponse>('/recognition/audd', audio, signal);
}

export async function detectAiSong(audio: RecognitionAudio, signal?: AbortSignal): Promise<AcrCloudResponse> {
  return postAudio<AcrCloudResponse>('/recognition/acrcloud', audio, signal, ACRCLOUD_TIMEOUT_MS);
}

export async function detectAiSongFromPreview(previewUrl: string, signal?: AbortSignal): Promise<AcrCloudResponse> {
  const response = await fetchWithTimeout(`${apiBaseUrl}/recognition/acrcloud-preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ previewUrl }),
    signal,
  }, ACRCLOUD_TIMEOUT_MS);
  const data = await response.json() as AcrCloudResponse & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Recognition service failed (${response.status}).`);
  return data;
}

export async function detectAiSongFromYoutube(youtubeUrl: string, signal?: AbortSignal): Promise<AcrCloudResponse> {
  const response = await fetchWithTimeout(`${apiBaseUrl}/recognition/acrcloud-youtube`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ youtubeUrl }),
    signal,
  }, ACRCLOUD_TIMEOUT_MS);
  const data = await response.json() as AcrCloudResponse & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Recognition service failed (${response.status}).`);
  return data;
}

export function resultFromHumanMatch(match: NonNullable<AuddResponse['match']>): RecognitionResult {
  return { classification: 'human', title: match.title, artist: match.artist };
}
