import type { NextRequest } from "next/server";
import { z } from "zod";
import { supportedLanguages } from "@/lib/contracts";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import { requireMutationSession } from "@/lib/server/session";
import {
  isSarvamAudioMimeType,
  transcribeSarvamSpeech,
} from "@/lib/server/sarvam-speech";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const LanguageSchema = z.enum(supportedLanguages);

export async function POST(request: NextRequest) {
  try {
    await requireMutationSession(request);
    const form = await request.formData();
    const audio = form.get("audio");
    const language = LanguageSchema.parse(form.get("language"));
    if (!(audio instanceof File) || audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
      throw new ApiError(413, "AUDIO_SIZE_REJECTED", "Record up to 30 seconds of audio.");
    }
    const mimeType = audio.type.split(";", 1)[0].toLocaleLowerCase("en-IN");
    if (!isSarvamAudioMimeType(mimeType)) {
      throw new ApiError(415, "AUDIO_TYPE_REJECTED", "This audio format is not supported.");
    }

    const transcript = await transcribeSarvamSpeech({
      audio: new Uint8Array(await audio.arrayBuffer()),
      language,
      mimeType,
    });
    return privateJson({ transcript });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
