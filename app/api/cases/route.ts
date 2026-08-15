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

export async function POST(request: NextRequest) {
  try {
    const session = await requireMutationSession(request);
    const input = CreateCaseSchema.parse(await request.json());
    if (await countActiveCases(session.tokenHash) >= 5) {
      throw new ApiError(
        429,
        "CASE_LIMIT_REACHED",
        "Delete an earlier case before starting another one.",
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
