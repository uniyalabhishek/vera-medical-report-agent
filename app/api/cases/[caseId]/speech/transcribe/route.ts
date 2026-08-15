import type { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import { getOwnedCase } from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";
import {
  isSarvamAudioMimeType,
  transcribeSarvamSpeech,
} from "@/lib/server/sarvam-speech";

export const runtime = "nodejs";
export const maxDuration = 90;

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const caseView = await getOwnedCase(caseId, session.tokenHash);
    if (caseView.state !== "READY" || !caseView.analysis) {
      throw new ApiError(409, "CASE_NOT_READY", "The report explanation is not ready.");
    }

    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size <= 0 || audio.size > MAX_AUDIO_BYTES) {
      throw new ApiError(413, "AUDIO_SIZE_REJECTED", "Record up to 30 seconds of audio.");
    }
    const mimeType = audio.type.split(";", 1)[0].toLocaleLowerCase("en-IN");
    if (!isSarvamAudioMimeType(mimeType)) {
      throw new ApiError(415, "AUDIO_TYPE_REJECTED", "This audio format is not supported.");
    }

    const transcript = await transcribeSarvamSpeech({
      audio: new Uint8Array(await audio.arrayBuffer()),
      language: caseView.intake.language,
      mimeType,
    });
    return privateJson({ transcript });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
