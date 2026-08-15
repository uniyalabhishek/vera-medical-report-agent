import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { NextRequest } from "next/server";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import { getOwnedCase, listUploads } from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";
import { MAX_FILE_BYTES, MAX_FILES } from "@/lib/server/uploads";
import { getStorageMode } from "@/lib/server/storage-mode";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    if (getStorageMode() !== "cloud") {
      throw new ApiError(404, "DIRECT_UPLOAD_UNAVAILABLE", "Direct uploads are not configured.");
    }
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const caseView = await getOwnedCase(caseId, session.tokenHash);
    if (caseView.state !== "DRAFT" && caseView.state !== "UPLOADED") {
      throw new ApiError(409, "UPLOADS_CLOSED", "Uploads are closed after report reading starts.");
    }
    if ((await listUploads(caseId, session.tokenHash)).length >= MAX_FILES) {
      throw new ApiError(400, "TOO_MANY_FILES", "A case can contain at most 10 files.");
    }

    const body = await request.json() as HandleUploadBody;
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const expected = new RegExp(
          `^cases/${caseId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[0-9a-f-]{36}\\.(?:pdf|jpg|png)$`,
          "i",
        );
        if (!expected.test(pathname)) {
          throw new ApiError(400, "INVALID_UPLOAD_PATH", "The upload path is invalid.");
        }
        return {
          allowedContentTypes: ["application/pdf", "image/jpeg", "image/png"],
          maximumSizeInBytes: MAX_FILE_BYTES,
          validUntil: Date.now() + 5 * 60 * 1_000,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        };
      },
    });
    return privateJson(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
