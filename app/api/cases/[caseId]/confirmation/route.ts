import type { NextRequest } from "next/server";
import { z } from "zod";
import { AnalysisSchema, FactSchema, FactsSchema } from "@/lib/contracts";
import { getProvider } from "@/lib/model/gateway";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import {
  getOwnedCase,
  markCaseState,
  setCaseAnalysis,
  setCaseFacts,
  tryTransitionCaseState,
} from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 300;

const ConfirmationSchema = z.object({ facts: FactsSchema });
type RouteContext = { params: Promise<{ caseId: string }> };

function lockedFact(fact: z.infer<typeof FactSchema>) {
  return JSON.stringify({ ...fact, confirmed: false });
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const input = ConfirmationSchema.parse(await request.json());
    const caseView = await getOwnedCase(caseId, session.tokenHash);

    if (input.facts.some((fact) => !fact.confirmed)) {
      throw new ApiError(400, "FACTS_UNCONFIRMED", "Confirm every important detail before continuing.");
    }
    if (
      input.facts.length !== caseView.facts.length ||
      input.facts.some((fact, index) => lockedFact(fact) !== lockedFact(caseView.facts[index]))
    ) {
      throw new ApiError(
        409,
        "FACTS_CHANGED",
        "The extracted values changed unexpectedly. Reload the review before continuing.",
      );
    }

    if (caseView.state === "READY" && caseView.analysis) {
      return privateJson({ case: caseView });
    }
    if (caseView.state === "CONFIRMED") {
      throw new ApiError(409, "ANALYSIS_IN_PROGRESS", "The confirmed facts are already being checked.");
    }

    if (
      !await tryTransitionCaseState(
        caseId,
        session.tokenHash,
        ["NEEDS_REVIEW", "SAFETY_FAILED"],
        "CONFIRMED",
      )
    ) {
      throw new ApiError(409, "CASE_STATE_CHANGED", "Reload this case before continuing.");
    }
    await setCaseFacts(caseId, session.tokenHash, input.facts, "CONFIRMED");
    try {
      const provider = getProvider(caseView.providerMode === "demo" ? "demo" : "uploaded");
      const analysis = AnalysisSchema.parse(
        await provider.synthesize({
          caseId,
          intake: caseView.intake,
          facts: input.facts,
        }),
      );
      const updated = await setCaseAnalysis(caseId, session.tokenHash, input.facts, analysis);
      return privateJson({ case: updated });
    } catch (error) {
      await markCaseState(caseId, session.tokenHash, "SAFETY_FAILED");
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
