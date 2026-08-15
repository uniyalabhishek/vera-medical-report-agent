import type { NextRequest } from "next/server";
import { z } from "zod";
import { IntakeSchema } from "@/lib/contracts";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import { countActiveCases, createCase } from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";

export const runtime = "nodejs";

const CreateCaseSchema = z.object({
  intake: IntakeSchema,
  mode: z.enum(["demo", "uploaded"]),
});

// Anonymous sessions cannot reopen old case IDs after a refresh. Keep a
// generous abuse guard so repeated buildathon demos do not block the user;
// normal retention cleanup still removes temporary cases after 24 hours.
const MAX_ACTIVE_CASES_PER_SESSION = 25;

export async function POST(request: NextRequest) {
  try {
    const session = await requireMutationSession(request);
    const input = CreateCaseSchema.parse(await request.json());
    if (
      (await countActiveCases(session.tokenHash)) >=
      MAX_ACTIVE_CASES_PER_SESSION
    ) {
      throw new ApiError(
        429,
        "CASE_LIMIT_REACHED",
        "This temporary session has reached its case limit. Reload in a fresh browser session.",
      );
    }
    const caseView = await createCase(
      session.tokenHash,
      input.intake,
      input.mode === "demo" ? "demo" : "live",
    );
    return privateJson({ case: caseView }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
