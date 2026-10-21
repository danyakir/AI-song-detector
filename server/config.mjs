import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = dirname(fileURLToPath(import.meta.url));
export const projectDirectory = resolve(serverDirectory, '..');

function resolveFromProject(value) {
  return isAbsolute(value) ? value : resolve(projectDirectory, value);
}

export const config = Object.freeze({
  port: Number(process.env.PORT ?? 8787),
  maxUploadBytes: 15 * 1024 * 1024,
  webBuildDirectory: resolveFromProject(process.env.WEB_BUILD_DIR ?? 'dist'),
  acrResourcesFile: resolveFromProject(process.env.ACRCLOUD_RESOURCES_FILE ?? '.acrcloud-resources.json'),
  acrRegions: new Set(['eu-west-1', 'us-west-2', 'ap-southeast-1']),
  saveDebugRecordings: process.env.SAVE_DEBUG_RECORDINGS === '1',
  debugRecordingsDirectory: resolveFromProject(
    process.env.DEBUG_RECORDINGS_DIR ?? (process.platform === 'win32'
      ? resolve(homedir(), 'Downloads', 'ai-song-detector-recordings')
      : resolve(tmpdir(), 'ai-song-detector-recordings')),
  ),
});
