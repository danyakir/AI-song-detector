# AI Song Detector

An Expo and React Native app that listens to nearby music, checks AudD for a song match, and uses ACRCloud File Scanning for an AI music verdict.

## Recognition flow

- Capture one uninterrupted, mono PCM stream for up to 30 seconds.
- Send the latest 12-second audio window to AudD at 12, 15, 20, 25, and 30 seconds. The final request is followed by an ACRCloud scan of the full captured recording only if none of the AudD requests found a match.
- When AudD finds a song, scan its Apple Music preview with ACRCloud when a preview URL is available. Show the catalog track as human-made only when ACRCloud says `human`; show an AI verdict and likely source when ACRCloud says `ai_generated`. If there is no usable preview or verdict, show the match without claiming a classification.
- If AudD finds no song by 30 seconds, scan the full captured recording with ACRCloud. If ACRCloud returns `prediction: "ai_generated"`, show its likely source when available; otherwise show “Couldn’t identify the song.”
- Captured audio is converted to WAV in memory. Debug copies are off by default. To save ACRCloud uploads locally while debugging, set `SAVE_DEBUG_RECORDINGS=1`; set `DEBUG_RECORDINGS_DIR` to choose the directory. Hosted filesystems may be temporary, so do not rely on this for persistent storage.
- Uploaded ACRCloud files are deleted from the container after the scan result is read.

## Setup

1. Install dependencies with `npm ci` (or `npm install` if you are changing dependencies).
2. Add your ACRCloud Console API token to `ACRCLOUD_API_TOKEN` in `.env`. The app automatically creates a file bucket and scanning container the first time it needs an AI verdict. You may set `ACRCLOUD_CONTAINER_ID` to use a container you already created. Keep the token on the server; it is never bundled into the app.
3. In one terminal, run `npm run server`.
4. In another terminal, run `npm start` and choose web, iOS, or Android.

For a physical phone, change `EXPO_PUBLIC_RECOGNITION_API_URL` in `.env` to the computer’s LAN address, for example `http://192.168.1.20:8787`. The phone and computer must be on the same network. Restart Expo after changing `.env`.

The app uses Expo SDK 56 for `expo-audio` real-time microphone streaming. Run it in a current Expo Go client or a development build compatible with SDK 56.

## Production web deployment

The production web build and recognition API are served from the same Node process. This keeps the browser API URL on the same HTTPS origin as the app.

1. Set `AUDD_API_TOKEN`, `ACRCLOUD_API_TOKEN`, and `ACRCLOUD_REGION` in the hosting provider's server environment. For an existing ACRCloud container, also set `ACRCLOUD_CONTAINER_ID`; hosted filesystems can be ephemeral, so avoid relying on `.acrcloud-resources.json` to persist automatically created resource IDs between deploys.
2. Build the web app with `npm run build:web`. The production Expo environment uses a relative API URL, while local `.env` settings remain available for development.
3. Start the hosted app and API with `npm run start:server`. The server listens on `PORT` and serves the Expo export from `dist/`; `/health` is the health-check endpoint.

Do not set provider credentials as `EXPO_PUBLIC_*` variables. Expo embeds public variables in the client bundle.

## API credentials

- Create an AudD API token at [audd.io](https://audd.io/).
- The ACRCloud Console API token is created in the ACRCloud console developer settings. Set `ACRCLOUD_REGION` to the region where the container should live.
- Keep production credentials in the hosting provider’s server environment, never in the Expo client.

## Project structure

- `App.tsx` loads shared fonts and mounts the detector screen.
- `src/features/recognition/screens/` contains the detector screen.
- `src/features/recognition/components/` contains the listening button and result modal.
- `src/features/recognition/hooks/useSongRecognition.ts` captures audio, creates the rolling WAV clips, and coordinates the provider schedule.
- `src/features/recognition/services/recognizeSong.ts` calls the recognition proxy.
- `src/features/recognition/recognition.types.ts` defines recognition results and UI phases.
- `server/index.mjs` is the process entry point; `server/app.mjs` wires HTTP handling, health checks, routes, and the production web build.
- `server/routes/recognition.mjs` maps recognition endpoints to provider services.
- `server/services/auddService.mjs` handles AudD recognition and match normalization; `server/services/acrCloudService.mjs` handles ACRCloud uploads, polling, previews, and verdict normalization.
- `server/services/acrCloudResourceStore.mjs` stores discovered ACRCloud resource IDs for local development.
- `server/lib/http.mjs` and `server/lib/errors.mjs` contain shared request parsing, response, and error helpers; `server/config.mjs` centralizes server settings.
- `src/theme.ts` contains shared colors and font names.
