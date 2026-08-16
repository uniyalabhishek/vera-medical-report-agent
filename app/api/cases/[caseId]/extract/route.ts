import type { NextRequest } from "next/server";
import { z } from "zod";
import { FactsSchema } from "@/lib/contracts";
import { getProvider } from "@/lib/model/gateway";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import {
  getOwnedCase,
  listUploads,
  markCaseState,
  setCaseFacts,
  tryTransitionCaseState,
} from "@/lib/server/case-repository";
import { advanceLiveExtraction } from "@/lib/server/live-extraction-runner";
import { requireMutationSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 120;

const ExtractSchema = z.object({ mode: z.enum(["demo", "uploaded"]) });
type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const { mode } = ExtractSchema.parse(await request.json());
    const caseView = await getOwnedCase(caseId, session.tokenHash);
    const expectedMode = caseView.providerMode === "demo" ? "demo" : "uploaded";
    if (mode !== expectedMode) {
      throw new ApiError(409, "CASE_MODE_MISMATCH", "This case was created for a different analysis mode.");
    }
    if (caseView.facts.length > 0) {
      return privateJson({ case: caseView });
    }

    const uploads = await listUploads(caseId, session.tokenHash);
    if (mode === "uploaded" && uploads.length === 0) {
      throw new ApiError(409, "UPLOAD_REQUIRED", "Add at least one file before extraction.");
    }

    if (mode === "demo") {
      if (
        !await tryTransitionCaseState(
          caseId,
          session.tokenHash,
          ["DRAFT", "EXTRACTION_FAILED"],
          "EXTRACTING",
        )
      ) {
        throw new ApiError(409, "EXTRACTION_IN_PROGRESS", "This case is already being extracted.");
      }
      try {
        const facts = FactsSchema.parse(await getProvider("demo").extract({
          caseId,
          intake: caseView.intake,
          mode,
          documents: [],
        }));
        return privateJson({
          case: await setCaseFacts(caseId, session.tokenHash, facts, "NEEDS_REVIEW"),
        });
      } catch (error) {
        await markCaseState(caseId, session.tokenHash, "EXTRACTION_FAILED");
        throw error;
      }
    }

    const retryFailed = caseView.state === "EXTRACTION_FAILED";
    if (caseView.state === "UPLOADED" || retryFailed) {
      if (
        !await tryTransitionCaseState(
          caseId,
          session.tokenHash,
          [caseView.state],
          "EXTRACTING",
        )
      ) {
        const current = await getOwnedCase(caseId, session.tokenHash);
        if (current.facts.length > 0) return privateJson({ case: current });
        if (current.state === "EXTRACTING") {
          return privateJson(
            { case: current, retryAfterMs: 1_000 },
            { status: 202, headers: { "Retry-After": "1" } },
          );
        }
        throw new ApiError(409, "EXTRACTION_IN_PROGRESS", "Report reading is already continuing.");
      }
    } else if (caseView.state !== "EXTRACTING") {
      throw new ApiError(
        409,
        "UPLOAD_INCOMPLETE",
        "Finish uploading every selected file before report reading starts.",
      );
    }

    try {
      const result = await advanceLiveExtraction({
        caseView,
        sessionHash: session.tokenHash,
        uploads,
        retryFailed,
      });
      if (result.kind === "pending") {
        return privateJson(
          {
            case: await getOwnedCase(caseId, session.tokenHash),
            progress: result.progress,
            retryAfterMs: result.retryAfterMs,
          },
          {
            status: 202,
            headers: { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1_000))) },
          },
        );
      }

      const displayNames = new Map(uploads.map((upload) => [upload.id, upload.displayName]));
      const facts = FactsSchema.parse(result.facts).map((fact) => ({
        ...fact,
        source: {
          ...fact.source,
          documentName: displayNames.get(fact.source.documentId) ?? fact.source.documentName,
        },
      }));
      return privateJson({
        case: await setCaseFacts(caseId, session.tokenHash, facts, "NEEDS_REVIEW"),
        progress: result.progress,
      });
    } catch (error) {
      await markCaseState(caseId, session.tokenHash, "EXTRACTION_FAILED");
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
