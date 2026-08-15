import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sarvamMocks = vi.hoisted(() => ({
  convert: vi.fn(),
  createClient: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("sarvamai", () => ({
  SarvamAIClient: class {
    readonly speechToText = { transcribe: sarvamMocks.transcribe };
    readonly textToSpeech = { convert: sarvamMocks.convert };

    constructor(options: unknown) {
      sarvamMocks.createClient(options);
    }
  },
}));

import {
  sarvamSpeechReady,
  synthesizeSarvamSpeech,
  transcribeSarvamSpeech,
} from "@/lib/server/sarvam-speech";

describe("Sarvam speech adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SARVAM_API_KEY", "test-sarvam-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports readiness only for a non-empty server key", () => {
    expect(sarvamSpeechReady()).toBe(true);

    vi.stubEnv("SARVAM_API_KEY", "   ");
    expect(sarvamSpeechReady()).toBe(false);
  });

  it("uses the pinned REST STT model and an opaque WebM filename", async () => {
    sarvamMocks.transcribe.mockResolvedValue({ transcript: "  मेरा सवाल  " });
    const audio = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

    await expect(
      transcribeSarvamSpeech({ audio, language: "Hindi", mimeType: "audio/webm" }),
    ).resolves.toBe("मेरा सवाल");

    expect(sarvamMocks.transcribe).toHaveBeenCalledWith({
      file: {
        data: audio,
        filename: "voice.webm",
        contentType: "audio/webm",
        contentLength: audio.byteLength,
      },
      model: "saaras:v3",
      mode: "transcribe",
      language_code: "hi-IN",
    });
  });

  it("preserves an opaque MP4 filename for supported browser recordings", async () => {
    sarvamMocks.transcribe.mockResolvedValue({ transcript: "Hello" });
    const audio = new Uint8Array([0, 0, 0, 20]);

    await transcribeSarvamSpeech({ audio, language: "English", mimeType: "audio/mp4" });

    expect(sarvamMocks.transcribe).toHaveBeenCalledWith(expect.objectContaining({
      file: expect.objectContaining({ filename: "voice.mp4", contentType: "audio/mp4" }),
    }));
  });

  it("uses the pinned REST TTS model and returns decoded MP3 bytes", async () => {
    const mp3 = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
    sarvamMocks.convert.mockResolvedValue({
      audios: [Buffer.from(mp3).toString("base64")],
    });

    const result = await synthesizeSarvamSpeech({
      text: "  உங்கள் முடிவு  ",
      language: "Tamil",
    });

    expect(result).toEqual(mp3);
    expect(sarvamMocks.convert).toHaveBeenCalledWith({
      text: "உங்கள் முடிவு",
      language_code: "ta-IN",
      model: "bulbul:v3",
      output_audio_codec: "mp3",
      pace: 0.9,
      speaker: "shubh",
    });
  });

  it("rejects empty or malformed provider responses", async () => {
    sarvamMocks.transcribe.mockResolvedValue({ transcript: "\u0000  " });
    await expect(
      transcribeSarvamSpeech({
        audio: new Uint8Array([1]),
        language: "English",
        mimeType: "audio/webm",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_PROCESSING_FAILED" });

    sarvamMocks.convert.mockResolvedValue({ audios: ["not-base64"] });
    await expect(
      synthesizeSarvamSpeech({ text: "Hello", language: "English" }),
    ).rejects.toMatchObject({ code: "PROVIDER_PROCESSING_FAILED" });
  });

  it("does not log provider errors or expose their details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    sarvamMocks.transcribe.mockRejectedValue(
      new Error("test-sarvam-key and private audio details"),
    );

    await expect(
      transcribeSarvamSpeech({
        audio: new Uint8Array([1]),
        language: "Marathi",
        mimeType: "audio/webm",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_PROCESSING_FAILED",
      message: "Speech could not be transcribed safely. Please try again.",
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
