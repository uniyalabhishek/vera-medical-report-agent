import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import { addUpload, listUploads } from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";
import { finalizeCloudUpload, MAX_FILES, storeUpload } from "@/lib/server/uploads";
import { getStorageMode } from "@/lib/server/storage-mode";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ caseId: string }> };
const FinalizeUploadSchema = z.object({
  pathname: z.string().min(1).max(300),
  displayName: z.string().min(1).max(300),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const existing = await listUploads(caseId, session.tokenHash);

    if (getStorageMode() === "cloud") {
      if (existing.length >= MAX_FILES) {
        throw new ApiError(400, "TOO_MANY_FILES", "A case can contain at most 10 files.");
      }
      const input = FinalizeUploadSchema.parse(await request.json());
      const upload = await finalizeCloudUpload(caseId, input.pathname, input.displayName);
      try {
        await addUpload(caseId, session.tokenHash, upload);
      } catch (error) {
        const { deleteStoredUploads } = await import("@/lib/server/uploads");
        await deleteStoredUploads([upload.storedName]).catch(() => undefined);
        throw error;
      }
      return privateJson({ uploads: [upload] }, { status: 201 });
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      throw new ApiError(400, "FILES_REQUIRED", "Choose at least one PDF, JPEG, or PNG file.");
    }
    if (existing.length + files.length > MAX_FILES) {
      throw new ApiError(400, "TOO_MANY_FILES", "A case can contain at most 10 files.");
    }

    const stored = [];
    for (const file of files) {
      const upload = await storeUpload(caseId, file);
      await addUpload(caseId, session.tokenHash, upload);
      stored.push(upload);
    }

    return privateJson({ uploads: stored }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
