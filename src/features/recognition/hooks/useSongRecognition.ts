import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioModule, setAudioModeAsync, useAudioStream, type AudioStream, type AudioStreamBuffer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { checkRecognitionServer, detectAiSong, detectAiSongFromPreview, identifySong, resultFromHumanMatch, type RecognitionAudio } from '../services/recognizeSong';
import type { RecognitionPhase, RecognitionResult } from '../recognition.types';

const MAX_RECORDING_SECONDS = 30;
const START_CAPTURE_TIMEOUT_MS = 8_000;
const AUDD_WINDOW_SECONDS = 12;
const AUDD_CHECK_SECONDS = [12, 15, 20, 25];
const SAMPLE_RATE = 48_000;

type CapturedChunk = { samples: Int16Array; sampleRate: number };
type AuddMatch = Awaited<ReturnType<typeof identifySong>>['match'];

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([operation, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function toWav(samples: Int16Array, sampleRate: number): Promise<RecognitionAudio> {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const writeText = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  new Int16Array(bytes, 44).set(samples);
  if (Platform.OS === 'web') return new Blob([bytes], { type: 'audio/wav' });
  const file = new File(Paths.cache, `recognition-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
  file.write(new Uint8Array(bytes));
  return {
    uri: file.uri,
    name: 'recording.wav',
    type: 'audio/wav',
    cleanup: () => { try { file.delete(); } catch { /* cache files are disposable */ } },
  };
}

function flatten(chunks: CapturedChunk[], maxSamples?: number, fromEnd = true): { samples: Int16Array; sampleRate: number } {
  const sampleRate = chunks.at(-1)?.sampleRate ?? SAMPLE_RATE;
  const wanted = maxSamples ?? chunks.reduce((total, chunk) => total + chunk.samples.length, 0);
  const selected: Int16Array[] = [];
  let remaining = wanted;
  if (fromEnd) {
    for (let index = chunks.length - 1; index >= 0 && remaining > 0; index -= 1) {
      const chunk = chunks[index].samples;
      const take = Math.min(remaining, chunk.length);
      selected.unshift(chunk.subarray(chunk.length - take));
      remaining -= take;
    }
  } else {
    for (const item of chunks) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, item.samples.length);
      selected.push(item.samples.subarray(0, take));
      remaining -= take;
    }
  }
  const samples = new Int16Array(wanted - remaining);
  let offset = 0;
  for (const chunk of selected) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return { samples, sampleRate };
}

export function useSongRecognition() {
  const [phase, setPhase] = useState<RecognitionPhase>('ready');
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const chunks = useRef<CapturedChunk[]>([]);
  const capturedSamples = useRef(0);
  const nextAuddCheck = useRef(0);
  const pendingAudd = useRef(new Set<Promise<AuddMatch | null>>());
  const webContext = useRef<AudioContext | null>(null);
  const webMediaStream = useRef<MediaStream | null>(null);
  const webProcessor = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<AudioStream | null>(null);
  const requestAbortController = useRef<AbortController | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onBufferRef = useRef<(buffer: AudioStreamBuffer) => void>(() => undefined);
  const finishStarted = useRef(false);
  const settled = useRef(false);
  const startMatchedSongRef = useRef<(match: NonNullable<AuddMatch>) => void>(() => undefined);
  const finishRecognitionRef = useRef<(sampleRate: number) => void>(() => undefined);

  const stopCapture = useCallback(() => {
    if (Platform.OS === 'web') {
      webProcessor.current?.disconnect();
      webProcessor.current = null;
      webMediaStream.current?.getTracks().forEach((track) => track.stop());
      webMediaStream.current = null;
      void webContext.current?.close();
      webContext.current = null;
    } else {
      streamRef.current?.stop();
    }
  }, []);

  const startCapture = useCallback(async () => {
    if (Platform.OS !== 'web') {
      if (!streamRef.current) throw new Error('Audio capture is unavailable.');
      await streamRef.current.start();
      return;
    }
    const media = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    webMediaStream.current = media;
    const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error('This browser does not support live microphone capture.');
    const context = new Context();
    webContext.current = context;
    const source = context.createMediaStreamSource(media);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const samples = new Int16Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        samples[index] = Math.max(-1, Math.min(1, input[index])) * 32767;
      }
      onBufferRef.current({ data: samples.buffer, channels: 1, sampleRate: context.sampleRate, timestamp: context.currentTime });
    };
    source.connect(processor);
    processor.connect(silentOutput);
    silentOutput.connect(context.destination);
    webProcessor.current = processor;
    if (context.state === 'suspended') await context.resume();
  }, []);

  const finishWithResult = useCallback(async (nextResult: RecognitionResult) => {
    if (settled.current) return;
    settled.current = true;
    requestAbortController.current?.abort();
    requestAbortController.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    stopCapture();
    setAudioLevel(0);
    setError(null);
    setResult(nextResult);
    setPhase('result');
  }, [stopCapture]);

  const finishWithError = useCallback((recognitionError: unknown, fallback: string) => {
    if (settled.current) return;
    settled.current = true;
    requestAbortController.current?.abort();
    requestAbortController.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    stopCapture();
    setAudioLevel(0);
    setResult(null);
    setError(recognitionError instanceof Error ? recognitionError.message : fallback);
    setPhase('error');
  }, [stopCapture]);

  const finishMatchedSong = useCallback(async (match: NonNullable<AuddMatch>) => {
    if (!match.previewUrl) {
      await finishWithResult({ classification: 'unknown', title: match.title, artist: match.artist });
      return;
    }

    const verdict = await detectAiSongFromPreview(match.previewUrl, requestAbortController.current?.signal);
    if (verdict.isAi === true) {
      await finishWithResult({ classification: 'ai', title: match.title, artist: match.artist, generator: verdict.generator, score: verdict.score });
    } else if (verdict.isAi === false) {
      await finishWithResult(resultFromHumanMatch(match));
    } else {
      await finishWithResult({ classification: 'unknown', title: match.title, artist: match.artist });
    }
  }, [finishWithResult]);

  const startMatchedSong = useCallback((match: NonNullable<AuddMatch>) => {
    if (finishStarted.current || settled.current) return;
    finishStarted.current = true;
    stopCapture();
    void finishMatchedSong(match).catch((recognitionError) => {
      finishWithError(recognitionError, 'Song recognition failed.');
    });
  }, [finishMatchedSong, finishWithError, stopCapture]);
  startMatchedSongRef.current = startMatchedSong;

  const onBuffer = useCallback((buffer: AudioStreamBuffer) => {
    if (settled.current || finishStarted.current) return;
    const samples = new Int16Array(buffer.data.slice(0));
    if (!samples.length) return;
    chunks.current.push({ samples, sampleRate: buffer.sampleRate });
    capturedSamples.current += samples.length;

    let power = 0;
    for (const sample of samples) power += (sample / 32768) ** 2;
    setAudioLevel(Math.min(1, Math.sqrt(power / samples.length) * 3.5));

    const seconds = capturedSamples.current / buffer.sampleRate;
    while (nextAuddCheck.current < AUDD_CHECK_SECONDS.length && seconds >= AUDD_CHECK_SECONDS[nextAuddCheck.current]) {
      nextAuddCheck.current += 1;
      const audio = flatten(chunks.current, AUDD_WINDOW_SECONDS * buffer.sampleRate);
      const request = toWav(audio.samples, audio.sampleRate)
        .then((wav) => identifySong(wav, requestAbortController.current?.signal))
        .then(({ match }) => {
          if (match) startMatchedSongRef.current(match);
          return match;
        })
        .catch(() => null);
      pendingAudd.current.add(request);
    }

    if (seconds >= MAX_RECORDING_SECONDS) finishRecognitionRef.current(buffer.sampleRate);
  }, []);

  const { stream } = useAudioStream({ channels: 1, encoding: 'int16', sampleRate: SAMPLE_RATE, onBuffer });
  streamRef.current = stream;
  onBufferRef.current = onBuffer;
  const finishRecognition = useCallback(async (sampleRate: number) => {
    if (finishStarted.current || settled.current) return;
    finishStarted.current = true;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setPhase('analyzing');
    stopCapture();
    if (capturedSamples.current === 0) {
      finishWithError(new Error('No audio was captured from the microphone. Check microphone permission and try again.'), 'No microphone audio was captured.');
      return;
    }
    const count30 = MAX_RECORDING_SECONDS * sampleRate;
    const fullClip = flatten(chunks.current, count30, false);
    const finalAuddClip = flatten(chunks.current, AUDD_WINDOW_SECONDS * sampleRate);
    const auddFinal = toWav(finalAuddClip.samples, finalAuddClip.sampleRate)
      .then((wav) => identifySong(wav, requestAbortController.current?.signal))
      .then(({ match }) => match)
      .catch(() => null);
    try {
      const auddResponses = await Promise.all([
        ...Array.from(pendingAudd.current),
        auddFinal,
      ]);
      if (settled.current) return;
      const match = auddResponses.find((response): response is NonNullable<AuddMatch> => response !== null);
      if (match) {
        await finishMatchedSong(match);
        return;
      }

      // Only fall back to the room recording when AudD could not find a catalog track.
      const aiVerdict = await detectAiSong(await toWav(fullClip.samples, fullClip.sampleRate), requestAbortController.current?.signal);
      if (settled.current) return;
      await finishWithResult(aiVerdict.isAi === true
        ? { classification: 'ai', generator: aiVerdict.generator, score: aiVerdict.score }
        : { classification: 'unknown' });
    } catch (recognitionError) {
      finishWithError(recognitionError, 'Song recognition failed.');
    }
  }, [finishMatchedSong, finishWithError, finishWithResult, stopCapture]);
  finishRecognitionRef.current = (sampleRate) => { void finishRecognition(sampleRate); };

  useEffect(() => {
    let mounted = true;
    const startupPing = new AbortController();
    setPhase('connecting');
    void checkRecognitionServer(startupPing.signal)
      .then(() => {
        if (mounted) setPhase('ready');
      })
      .catch(() => {
        if (mounted) finishWithError(new Error('The recognition server is down. Please try again later.'), 'The recognition server is down. Please try again later.');
      });

    return () => {
      mounted = false;
      startupPing.abort();
      requestAbortController.current?.abort();
      stopCapture();
    };
  }, [finishWithError, stopCapture]);

  const startListening = async () => {
    setError(null);
    setResult(null);
    setAudioLevel(0);
    chunks.current = [];
    capturedSamples.current = 0;
    nextAuddCheck.current = 0;
    pendingAudd.current.clear();
    finishStarted.current = false;
    settled.current = false;
    requestAbortController.current = new AbortController();

    try {
      setPhase('connecting');
      await checkRecognitionServer(requestAbortController.current.signal);
      if (Platform.OS !== 'web') {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) throw new Error('Microphone access is needed to listen to a song.');
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
      setPhase('listening');
      captureTimer.current = setTimeout(() => {
        finishRecognitionRef.current(streamRef.current?.sampleRate ?? SAMPLE_RATE);
      }, MAX_RECORDING_SECONDS * 1000);
      await withTimeout(
        startCapture(),
        START_CAPTURE_TIMEOUT_MS,
        'The microphone did not start. Check the Android microphone permission and try again.',
      );
    } catch (startError) {
      finishWithError(startError, 'Could not start listening.');
    }
  };

  const cancelListening = () => {
    if (phase !== 'listening') return;
    finishStarted.current = true;
    settled.current = true;
    requestAbortController.current?.abort();
    requestAbortController.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    pendingAudd.current.clear();
    stopCapture();
    setAudioLevel(0);
    setError(null);
    setResult(null);
    setPhase('ready');
  };

  const reset = () => {
    requestAbortController.current?.abort();
    requestAbortController.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    stopCapture();
    setAudioLevel(0);
    setError(null);
    setResult(null);
    setPhase('ready');
  };

  return { phase, result, error, audioLevel, startListening, cancelListening, reset };
}
