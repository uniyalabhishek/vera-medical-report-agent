import type { NextRequest } from "next/server";
import { AnalysisSchema } from "@/lib/contracts";
import { getProvider } from "@/lib/model/gateway";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import {
  getOwnedCase,
  markCaseState,
  setCaseAnalysis,
  tryTransitionCaseState,
} from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const caseView = await getOwnedCase(caseId, session.tokenHash);

    if (caseView.state === "READY" && caseView.analysis) {
      return privateJson({ case: caseView });
    }
    if (
      caseView.facts.length === 0 ||
      caseView.facts.some((fact) => !fact.confirmed || fact.needsReview)
    ) {
      throw new ApiError(
        409,
        "FACTS_NOT_ACCEPTED",
        "The server could not safely accept every extracted detail.",
      );
    }

    if (caseView.state !== "CONFIRMED") {
      const transitioned = await tryTransitionCaseState(
        caseId,
        session.tokenHash,
        ["NEEDS_REVIEW", "SAFETY_FAILED"],
        "CONFIRMED",
      );
      if (!transitioned) {
        throw new ApiError(409, "CASE_STATE_CHANGED", "Reload this case before continuing.");
      }
    }

    try {
      const provider = getProvider(caseView.providerMode === "demo" ? "demo" : "uploaded");
      const analysis = AnalysisSchema.parse(
        await provider.synthesize({
          caseId,
          intake: caseView.intake,
          facts: caseView.facts,
        }),
      );
      const updated = await setCaseAnalysis(
        caseId,
        session.tokenHash,
        caseView.facts,
        analysis,
      );
      return privateJson({ case: updated });
    } catch (error) {
      await markCaseState(caseId, session.tokenHash, "SAFETY_FAILED");
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
