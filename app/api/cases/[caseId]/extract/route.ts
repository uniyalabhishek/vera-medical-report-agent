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
import { requireMutationSession } from "@/lib/server/session";
import { getStoredUploadData } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

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
    if (
      !await tryTransitionCaseState(
        caseId,
        session.tokenHash,
        ["DRAFT", "UPLOADED", "EXTRACTION_FAILED"],
        "EXTRACTING",
      )
    ) {
      throw new ApiError(409, "EXTRACTION_IN_PROGRESS", "This case is already being extracted.");
    }

    try {
      const provider = getProvider(mode);
      const documents = await Promise.all(uploads.map(async (upload, index) => ({
        id: upload.id,
        name: `report-${index + 1}.${upload.mimeType === "application/pdf" ? "pdf" : upload.mimeType === "image/png" ? "png" : "jpg"}`,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        category: upload.category,
        data: await getStoredUploadData(caseId, upload.storedName),
      })));
      const providerFacts = FactsSchema.parse(
        await provider.extract({
          caseId,
          intake: caseView.intake,
          mode,
          documents,
        }),
      );
      const displayNames = new Map(uploads.map((upload) => [upload.id, upload.displayName]));
      const facts = providerFacts.map((fact) => ({
        ...fact,
        source: {
          ...fact.source,
          documentName: displayNames.get(fact.source.documentId) ?? fact.source.documentName,
        },
      }));
      const updated = await setCaseFacts(caseId, session.tokenHash, facts, "NEEDS_REVIEW");
      return privateJson({ case: updated });
    } catch (error) {
      await markCaseState(caseId, session.tokenHash, "EXTRACTION_FAILED");
      throw error;
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
