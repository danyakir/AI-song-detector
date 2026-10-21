import { config } from '../config.mjs';
import { parseAudioUpload, parseJsonRequest } from '../lib/http.mjs';
import { recognizeWithAudd } from '../services/auddService.mjs';
import { scanAcrCloudPreview, scanAcrCloudYoutubeUrl, scanWithAcrCloud } from '../services/acrCloudService.mjs';

export const recognitionRoutes = new Map([
  ['/recognition/audd', async ({ request, signal }) => {
    const audio = await parseAudioUpload(request, `http://localhost:${config.port}${request.url}`, config.maxUploadBytes);
    return recognizeWithAudd(audio, signal);
  }],
  ['/recognition/acrcloud', async ({ request, signal }) => {
    const audio = await parseAudioUpload(request, `http://localhost:${config.port}${request.url}`, config.maxUploadBytes);
    return scanWithAcrCloud(audio, { signal });
  }],
  ['/recognition/acrcloud-preview', async ({ request, signal }) => {
    const body = await parseJsonRequest(request, config.maxUploadBytes);
    return scanAcrCloudPreview(body?.previewUrl, signal);
  }],
  ['/recognition/acrcloud-youtube', async ({ request, signal }) => {
    const body = await parseJsonRequest(request, config.maxUploadBytes);
    return scanAcrCloudYoutubeUrl(body?.youtubeUrl, signal);
  }],
]);
