import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const ELEVENLABS_API_KEY = process.env.EXPO_PUBLIC_ELEVENLABS_API_KEY || '';
const CONFIGURED_VOICE_ID =
  process.env.EXPO_PUBLIC_ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
const FALLBACK_PREMADE_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'; // Sarah - Mature, Reassuring, Confident
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const TTS_MODEL_ID = 'eleven_flash_v2_5';
const STT_MODEL_ID = 'scribe_v1';

let resolvedVoiceId = CONFIGURED_VOICE_ID.trim() || FALLBACK_PREMADE_VOICE_ID;
let activePlayer: AudioPlayer | null = null;
let activePlaybackCleanup: (() => void) | null = null;

export function isElevenLabsConfigured(): boolean {
  return Boolean(ELEVENLABS_API_KEY.trim());
}

/**
 * Cleans assistant text so it sounds natural and conversational when spoken aloud.
 */
export function cleanTextForSpeech(raw: string): string {
  return raw
    .replace(/^I couldn't view your photo, but let's continue\.\s*/i, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\[(\d+)\]/g, '')
    .replace(/[*_#`~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Stops any currently playing ElevenLabs voice audio immediately.
 */
export function stopSpeech(): void {
  if (activePlaybackCleanup) {
    const cleanup = activePlaybackCleanup;
    activePlaybackCleanup = null;
    cleanup();
  }
  if (activePlayer) {
    try {
      activePlayer.pause();
      activePlayer.remove();
    } catch {
      // Ignore cleanup errors
    }
    activePlayer = null;
  }
}

async function requestTtsAudioBytes(
  text: string,
  voiceId: string
): Promise<{ ok: boolean; status: number; bytes?: Uint8Array; errorText?: string }> {
  const response = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
      'xi-api-key': ELEVENLABS_API_KEY.trim(),
    },
    body: JSON.stringify({
      text,
      model_id: TTS_MODEL_ID,
      optimize_streaming_latency: 3,
      voice_settings: {
        stability: 0.55,
        similarity_boost: 0.78,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    return { ok: false, status: response.status, errorText };
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    ok: true,
    status: response.status,
    bytes: new Uint8Array(arrayBuffer),
  };
}

/**
 * Synthesizes speech via ElevenLabs and plays it through the device speaker.
 * Resolves when playback finishes or is stopped.
 */
export async function synthesizeAndPlaySpeech(
  rawText: string,
  options?: {
    onStart?: () => void;
    onFinish?: () => void;
    keepRecordingSession?: boolean;
  }
): Promise<void> {
  const text = cleanTextForSpeech(rawText);
  if (!text || !isElevenLabsConfigured()) {
    options?.onFinish?.();
    return;
  }

  stopSpeech();

  let result = await requestTtsAudioBytes(text, resolvedVoiceId);

  // If the user configured a library voice on a free-tier ElevenLabs plan (HTTP 402),
  // automatically switch to the premade reassuring voice so TTS always succeeds.
  if (
    !result.ok &&
    (result.status === 402 || result.status === 400 || result.status === 404) &&
    resolvedVoiceId !== FALLBACK_PREMADE_VOICE_ID
  ) {
    console.warn(
      `[ElevenLabs] Voice ${resolvedVoiceId} returned HTTP ${result.status}; falling back to premade voice ${FALLBACK_PREMADE_VOICE_ID}.`
    );
    resolvedVoiceId = FALLBACK_PREMADE_VOICE_ID;
    result = await requestTtsAudioBytes(text, resolvedVoiceId);
  }

  if (!result.ok || !result.bytes) {
    throw new Error(
      `ElevenLabs TTS failed (HTTP ${result.status}): ${result.errorText?.slice(0, 140) || 'Unable to generate speech'}`
    );
  }

  await setAudioModeAsync({
    allowsRecording: Boolean(options?.keepRecordingSession),
    playsInSilentMode: true,
    shouldRouteThroughEarpiece: false,
    interruptionMode: 'mixWithOthers',
  }).catch(() => {});

  let audioUri = '';
  let tempFile: File | null = null;
  let objectUrlToRevoke: string | null = null;

  if (Platform.OS === 'web') {
    const blob = new Blob([result.bytes.buffer as ArrayBuffer], {
      type: 'audio/mpeg',
    });
    objectUrlToRevoke = URL.createObjectURL(blob);
    audioUri = objectUrlToRevoke;
  } else {
    tempFile = new File(
      Paths.cache,
      `el_speech_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`
    );
    await tempFile.write(result.bytes);
    audioUri = tempFile.uri;
  }

  return new Promise<void>((resolve) => {
    let settled = false;
    const player = createAudioPlayer(audioUri);
    activePlayer = player;

    const finishPlayback = () => {
      if (settled) return;
      settled = true;
      activePlaybackCleanup = null;
      try {
        subscription.remove();
      } catch {
        // Ignore
      }
      if (activePlayer === player) {
        activePlayer = null;
      }
      try {
        player.remove();
      } catch {
        // Ignore
      }
      if (tempFile) {
        try {
          if (tempFile.exists) {
            tempFile.delete();
          }
        } catch {
          // Ignore cache cleanup errors
        }
      }
      if (objectUrlToRevoke && typeof URL !== 'undefined') {
        try {
          URL.revokeObjectURL(objectUrlToRevoke);
        } catch {
          // Ignore
        }
      }
      options?.onFinish?.();
      resolve();
    };

    activePlaybackCleanup = finishPlayback;

    const subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        finishPlayback();
      }
    });

    options?.onStart?.();
    player.play();
  });
}

/**
 * Transcribes a recorded audio file URI using ElevenLabs Scribe (`scribe_v1`).
 * Uses XMLHttpRequest on native so React Native's Networking module streams
 * the file URI multipart part directly without expo/fetch FormData errors.
 */
export async function transcribeAudioUri(uri: string): Promise<string> {
  if (!uri) {
    throw new Error('No audio recording found.');
  }
  if (!isElevenLabsConfigured()) {
    throw new Error('ElevenLabs API key is not configured.');
  }

  const formData = new FormData();
  formData.append('model_id', STT_MODEL_ID);

  if (Platform.OS === 'web') {
    const audioResponse = await fetch(uri);
    const blob = await audioResponse.blob();
    formData.append('file', blob, 'recording.webm');

    const response = await fetch(`${ELEVENLABS_BASE_URL}/speech-to-text`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY.trim(),
      },
      body: formData,
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Speech transcription failed (HTTP ${response.status}): ${rawText.slice(0, 140)}`
      );
    }

    const parsed = JSON.parse(rawText) as { text?: string };
    return (parsed.text ?? '').trim();
  }

  const ext = uri.split('.').pop()?.toLowerCase() || 'm4a';
  const mimeType =
    ext === 'mp3'
      ? 'audio/mpeg'
      : ext === 'wav'
      ? 'audio/wav'
      : ext === '3gp'
      ? 'audio/3gpp'
      : 'audio/mp4';

  formData.append('file', {
    uri,
    name: `recording.${ext}`,
    type: mimeType,
  } as unknown as Blob);

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${ELEVENLABS_BASE_URL}/speech-to-text`);
    xhr.setRequestHeader('xi-api-key', ELEVENLABS_API_KEY.trim());
    xhr.timeout = 25000;

    xhr.onload = () => {
      const rawText = xhr.responseText || '';
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(
          new Error(
            `Speech transcription failed (HTTP ${xhr.status}): ${rawText.slice(0, 140)}`
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(rawText) as { text?: string };
        resolve((parsed.text ?? '').trim());
      } catch {
        reject(new Error('Speech transcription returned invalid JSON.'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error during speech transcription.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Speech transcription timed out.'));
    };

    xhr.send(formData);
  });
}
