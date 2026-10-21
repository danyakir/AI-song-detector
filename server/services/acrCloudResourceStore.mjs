import { readFile, writeFile } from 'node:fs/promises';
import { config } from '../config.mjs';

export async function readAcrResources() {
  try {
    return JSON.parse(await readFile(config.acrResourcesFile, 'utf8'));
  } catch {
    return {};
  }
}

export async function writeAcrResources(resources) {
  await writeFile(config.acrResourcesFile, `${JSON.stringify(resources, null, 2)}\n`, 'utf8');
}
