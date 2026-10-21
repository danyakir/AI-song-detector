import { httpError } from '../lib/errors.mjs';

export async function recognizeWithAudd(audio, signal) {
  if (!process.env.AUDD_API_TOKEN) throw httpError('AUDD_API_TOKEN is required.', 503);
  const form = new FormData();
  form.append('api_token', process.env.AUDD_API_TOKEN);
  form.append('return', 'spotify,apple_music');
  form.append('file', audio, 'clip.wav');
  const response = await fetch('https://api.audd.io/', { method: 'POST', body: form, signal });
  if (!response.ok) throw new Error(`AudD request failed (${response.status}).`);
  const data = await response.json();
  if (data.status !== 'success') {
    throw new Error(data.error?.error_message ?? 'AudD could not process this clip.');
  }
  const match = data.result;
  if (!match) {
    console.log('[AudD] No song match in this audio window.');
    return { match: null };
  }

  const title = match.title ?? 'Unknown title';
  const artist = match.artist ?? 'Unknown artist';
  const appleMusic = match.apple_music;
  const previewUrl = appleMusic?.previews?.[0]?.url ?? null;
  console.log(`[AudD] Song match: ${artist} — ${title}`);
  console.log(`[AudD] Apple Music listing: ${appleMusic?.url ? 'found' : 'not found'}`);
  console.log(`[AudD] Apple Music preview: ${previewUrl ? 'found' : 'not available'}`);
  if (appleMusic?.url) console.log(`[AudD] Apple Music URL: ${appleMusic.url}`);
  if (previewUrl) console.log(`[AudD] Preview URL: ${previewUrl}`);

  const directYoutubeUrl = match.youtube?.url ?? match.youtube_url ?? match.youtubeUrl ?? null;
  if (previewUrl) {
    console.log('[AudD] Skipping YouTube lookup because an Apple Music preview is available.');
  } else if (directYoutubeUrl) {
    console.log(`[AudD] YouTube URL included in match: ${directYoutubeUrl}`);
  } else if (match.song_link) {
    void logAudDYoutubeLink(match.song_link, signal).catch((error) => {
      console.log(`[AudD] YouTube link lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  } else {
    console.log('[AudD] YouTube link: no song_link was included to resolve.');
  }

  return { match: { title, artist, previewUrl } };
}

async function logAudDYoutubeLink(songLink, signal) {
  let link;
  try { link = new URL(songLink); } catch {
    console.log('[AudD] YouTube link: AudD song_link is not a valid URL.');
    return;
  }
  if (link.protocol !== 'https:' || link.hostname !== 'lis.tn') {
    console.log(`[AudD] YouTube link: song_link host is ${link.hostname}, not the AudD redirect host.`);
    return;
  }

  const lookupUrl = `${link.href}${link.search ? '&' : '?'}youtube`;
  const timeout = AbortSignal.timeout(5000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(lookupUrl, { redirect: 'manual', signal: requestSignal });
  const location = response.headers.get('location');
  if (!location) {
    console.log(`[AudD] YouTube link: no redirect destination returned (HTTP ${response.status}).`);
    return;
  }

  const destination = new URL(location, lookupUrl);
  const isYoutube = destination.hostname === 'youtu.be'
    || destination.hostname === 'youtube.com'
    || destination.hostname.endsWith('.youtube.com');
  console.log(`[AudD] YouTube link ${isYoutube ? 'found' : 'not resolved'}: ${destination.href}`);
}
