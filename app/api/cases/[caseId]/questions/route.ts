import type { NextRequest } from "next/server";
import { QuestionRequestSchema, QuestionResponseSchema } from "@/lib/contracts";
import { getProvider } from "@/lib/model/gateway";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import {
  addConversationTurn,
  countConversationTurns,
  getOwnedCase,
} from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const { question } = QuestionRequestSchema.parse(await request.json());
    const caseView = await getOwnedCase(caseId, session.tokenHash);

    if (caseView.state !== "READY" || !caseView.analysis) {
      throw new ApiError(409, "CASE_NOT_READY", "Finish reviewing the extracted facts first.");
    }
    if (await countConversationTurns(caseId, session.tokenHash) >= 20) {
      throw new ApiError(
        429,
        "QUESTION_LIMIT_REACHED",
        "This MVP case has reached its 20-question limit.",
      );
    }

    const provider = getProvider(caseView.providerMode === "demo" ? "demo" : "uploaded");
    const response = QuestionResponseSchema.parse(
      await provider.answer({
        caseId,
        intake: caseView.intake,
        facts: caseView.facts,
        analysis: caseView.analysis,
        question,
      }),
    );
    await addConversationTurn(caseId, session.tokenHash, question, response);
    return privateJson({ response });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
