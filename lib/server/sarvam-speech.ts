import "server-only";

import { Buffer } from "node:buffer";
import { SarvamAIClient } from "sarvamai";
import type { Intake } from "@/lib/contracts";
import {
  ProviderConfigurationError,
  ProviderProcessingError,
} from "@/lib/model/provider";

type AppLanguage = Intake["language"];

const languageCodes = {
  English: "en-IN",
  Hindi: "hi-IN",
  Tamil: "ta-IN",
  Kannada: "kn-IN",
  Marathi: "mr-IN",
} as const satisfies Record<AppLanguage, string>;

const STT_MODEL = "saaras:v3" as const;
const TTS_MODEL = "bulbul:v3" as const;
const MAX_TTS_CHARACTERS = 2_500;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const voiceFileNames = {
  "audio/webm": "voice.webm",
  "audio/mp4": "voice.mp4",
} as const;
export type SarvamAudioMimeType = keyof typeof voiceFileNames;

export function isSarvamAudioMimeType(value: string): value is SarvamAudioMimeType {
  return value in voiceFileNames;
}

let cachedClient: SarvamAIClient | null = null;

export function sarvamSpeechReady() {
  return Boolean(process.env.SARVAM_API_KEY?.trim());
}

function getClient() {
  const apiKey = process.env.SARVAM_API_KEY?.trim();
  if (!apiKey) {
    throw new ProviderConfigurationError(
      "Speech input and playback require SARVAM_API_KEY.",
    );
  }

  cachedClient ??= new SarvamAIClient({
    apiSubscriptionKey: apiKey,
    maxRetries: 2,
    timeoutInSeconds: 60,
  });
  return cachedClient;
}

function providerFailure(message: string): ProviderProcessingError {
  return new ProviderProcessingError(message);
}

function rethrowSanitized(error: unknown, message: string): never {
  if (
    error instanceof ProviderConfigurationError ||
    error instanceof ProviderProcessingError
  ) {
    throw error;
  }
  throw providerFailure(message);
}

function readTranscript(response: unknown) {
  if (
    typeof response !== "object" ||
    response === null ||
    !("transcript" in response) ||
    typeof response.transcript !== "string"
  ) {
    throw providerFailure("Speech could not be transcribed safely. Please try again.");
  }

  const transcript = response.transcript.replace(/\u0000/g, "").trim();
  if (!transcript) {
    throw providerFailure("No speech was detected. Please try again.");
  }
  return transcript;
}

function isMp3(bytes: Uint8Array) {
  const hasId3Header =
    bytes.length >= 3 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33;
  const hasMpegFrameHeader =
    bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return hasId3Header || hasMpegFrameHeader;
}

function readMp3(response: unknown) {
  if (
    typeof response !== "object" ||
    response === null ||
    !("audios" in response) ||
    !Array.isArray(response.audios) ||
    response.audios.length !== 1 ||
    typeof response.audios[0] !== "string"
  ) {
    throw providerFailure("Speech playback could not be created safely. Please try again.");
  }

  const encoded = response.audios[0].replace(/\s+/g, "");
  if (!encoded || !BASE64_PATTERN.test(encoded)) {
    throw providerFailure("Speech playback could not be created safely. Please try again.");
  }

  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  if (!isMp3(bytes)) {
    throw providerFailure("Speech playback could not be created safely. Please try again.");
  }
  return bytes;
}

export async function transcribeSarvamSpeech(input: {
  audio: Uint8Array;
  language: AppLanguage;
  mimeType: SarvamAudioMimeType;
}): Promise<string> {
  if (!(input.audio instanceof Uint8Array) || input.audio.byteLength === 0) {
    throw providerFailure("Please record your question before sending it.");
  }

  try {
    const response = await getClient().speechToText.transcribe({
      file: {
        data: input.audio,
        filename: voiceFileNames[input.mimeType],
        contentType: input.mimeType,
        contentLength: input.audio.byteLength,
      },
      model: STT_MODEL,
      mode: "transcribe",
      language_code: languageCodes[input.language],
    });
    return readTranscript(response);
  } catch (error) {
    rethrowSanitized(
      error,
      "Speech could not be transcribed safely. Please try again.",
    );
  }
}

export async function synthesizeSarvamSpeech(input: {
  text: string;
  language: AppLanguage;
}): Promise<Uint8Array> {
  const text = input.text.trim();
  if (!text || text.length > MAX_TTS_CHARACTERS) {
    throw providerFailure("Speech playback text must be between 1 and 2,500 characters.");
  }

  try {
    const response = await getClient().textToSpeech.convert({
      text,
      language_code: languageCodes[input.language],
      model: TTS_MODEL,
      output_audio_codec: "mp3",
      pace: 0.9,
      speaker: "shubh",
    });
    return readMp3(response);
  } catch (error) {
    rethrowSanitized(
      error,
      "Speech playback could not be created safely. Please try again.",
    );
  }
}
