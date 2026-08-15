import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/server/api-error";
import { getOwnedCase } from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";
import { synthesizeSarvamSpeech } from "@/lib/server/sarvam-speech";

export const runtime = "nodejs";
export const maxDuration = 90;

const SpeechSchema = z.object({ text: z.string().trim().min(1).max(2_500) });
type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const caseView = await getOwnedCase(caseId, session.tokenHash);
    if (caseView.state !== "READY" || !caseView.analysis) {
      throw new ApiError(409, "CASE_NOT_READY", "The report explanation is not ready.");
    }
    const { text } = SpeechSchema.parse(await request.json());
    const bytes = await synthesizeSarvamSpeech({ text, language: caseView.intake.language });
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "audio/mpeg",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
