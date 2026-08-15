import type { NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/server/api-error";
import { getOwnedCase } from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";
import { generateVisualExplanation } from "@/lib/server/visual-explanation";
import { buildVisualSpec, selectVisualObservation } from "@/lib/visual-explanation";

export const runtime = "nodejs";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const caseView = await getOwnedCase(caseId, session.tokenHash);
    if (caseView.state !== "READY" || !caseView.analysis) {
      throw new ApiError(409, "CASE_NOT_READY", "The report explanation is not ready.");
    }

    const observation = selectVisualObservation(caseView.facts);
    if (!observation) {
      throw new ApiError(
        409,
        "NO_VISUAL_RESULT",
        "This explanation does not contain a checked blood-test result to visualize.",
      );
    }

    const bytes = await generateVisualExplanation(buildVisualSpec(observation));
    const body = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline; filename=vera-visual-explanation.jpg",
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "image/jpeg",
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
