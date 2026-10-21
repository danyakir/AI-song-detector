export type RecognitionResult = {
  classification: 'ai' | 'human' | 'unknown';
  title?: string;
  artist?: string;
  generator?: string | null;
  score?: number | null;
};

export type RecognitionPhase = 'ready' | 'connecting' | 'listening' | 'analyzing' | 'result' | 'error';
