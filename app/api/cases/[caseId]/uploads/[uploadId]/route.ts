import type { NextRequest } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/server/api-error";
import { listUploads } from "@/lib/server/case-repository";
import { requireSession } from "@/lib/server/session";
import { getStoredUploadData } from "@/lib/server/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ caseId: string; uploadId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const { caseId, uploadId } = await context.params;
    const upload = (await listUploads(caseId, session.tokenHash)).find(
      (candidate) => candidate.id === uploadId,
    );
    if (!upload) throw new ApiError(404, "UPLOAD_NOT_FOUND", "The source file was not found.");

    const bytes = await getStoredUploadData(caseId, upload.storedName);
    const filename = encodeURIComponent(upload.displayName);
    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${filename}`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": upload.mimeType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
