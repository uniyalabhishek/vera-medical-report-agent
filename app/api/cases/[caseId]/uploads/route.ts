import type { NextRequest } from "next/server";
import { z } from "zod";
import { DocumentCategorySchema } from "@/lib/contracts";
import { ApiError, apiErrorResponse, privateJson } from "@/lib/server/api-error";
import {
  addUpload,
  getOwnedCase,
  listUploads,
  markCaseState,
  removeUploads,
} from "@/lib/server/case-repository";
import { requireMutationSession } from "@/lib/server/session";
import {
  deleteStoredUpload,
  finalizeCloudUpload,
  MAX_FILES,
  safeDisplayName,
  storeUpload,
} from "@/lib/server/uploads";
import { getStorageMode } from "@/lib/server/storage-mode";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ caseId: string }> };
const FinalizeUploadSchema = z.object({
  pathname: z.string().min(1).max(300),
  displayName: z.string().min(1).max(300),
  category: DocumentCategorySchema,
  complete: z.boolean(),
});

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const caseView = await getOwnedCase(caseId, session.tokenHash);
    const existing = await listUploads(caseId, session.tokenHash);

    if (getStorageMode() === "cloud") {
      const input = FinalizeUploadSchema.parse(await request.json());
      const alreadyRecorded = existing.find((upload) => upload.storedName === input.pathname);
      if (alreadyRecorded) {
        if (
          alreadyRecorded.displayName !== safeDisplayName(input.displayName) ||
          alreadyRecorded.category !== input.category
        ) {
          throw new ApiError(
            409,
            "UPLOAD_METADATA_CONFLICT",
            "This saved upload does not match the selected file.",
          );
        }
        if (input.complete && caseView.state === "DRAFT") {
          await markCaseState(caseId, session.tokenHash, "UPLOADED");
        }
        return privateJson({ uploads: [alreadyRecorded] });
      }
      if (caseView.state !== "DRAFT") {
        throw new ApiError(409, "UPLOADS_CLOSED", "Uploads are closed after report reading starts.");
      }
      if (existing.length >= MAX_FILES) {
        throw new ApiError(400, "TOO_MANY_FILES", "A case can contain at most 10 files.");
      }
      const upload = await finalizeCloudUpload(
        caseId,
        input.pathname,
        input.displayName,
        input.category,
      );
      try {
        await addUpload(caseId, session.tokenHash, upload, input.complete);
      } catch (error) {
        const winner = (await listUploads(caseId, session.tokenHash).catch(() => []))
          .find((record) => record.storedName === upload.storedName);
        if (
          winner &&
          winner.displayName === upload.displayName &&
          winner.category === upload.category &&
          winner.mimeType === upload.mimeType &&
          winner.sizeBytes === upload.sizeBytes
        ) {
          return privateJson({ uploads: [winner] });
        }
        // Keep a valid blob at its stable path when database finalization is
        // uncertain. The next request can safely finalize the same upload.
        throw error;
      }
      return privateJson({ uploads: [upload] }, { status: 201 });
    }

    if (caseView.state !== "DRAFT") {
      throw new ApiError(409, "UPLOADS_CLOSED", "Uploads are closed after report reading starts.");
    }

    const formData = await request.formData();
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    const categories = z.array(DocumentCategorySchema).parse(
      JSON.parse(String(formData.get("categories") ?? "[]")),
    );

    if (files.length === 0) {
      throw new ApiError(400, "FILES_REQUIRED", "Choose at least one PDF, JPEG, or PNG file.");
    }
    if (existing.length + files.length > MAX_FILES) {
      throw new ApiError(400, "TOO_MANY_FILES", "A case can contain at most 10 files.");
    }
    if (categories.length !== files.length) {
      throw new ApiError(400, "FILE_CATEGORY_MISMATCH", "Each file needs one document category.");
    }

    const stored = [];
    try {
      for (const [index, file] of files.entries()) {
        const upload = await storeUpload(caseId, file, categories[index]);
        try {
          await addUpload(caseId, session.tokenHash, upload, false);
        } catch (error) {
          await deleteStoredUpload(caseId, upload.storedName).catch(() => undefined);
          throw error;
        }
        stored.push(upload);
      }
      await markCaseState(caseId, session.tokenHash, "UPLOADED");
    } catch (error) {
      await Promise.all(stored.map((upload) =>
        deleteStoredUpload(caseId, upload.storedName).catch(() => undefined)
      ));
      await removeUploads(
        caseId,
        session.tokenHash,
        stored.map((upload) => upload.id),
      ).catch(() => undefined);
      throw error;
    }

    return privateJson({ uploads: stored }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
