import type { NextRequest } from "next/server";
import { apiErrorResponse, privateEmpty, privateJson } from "@/lib/server/api-error";
import { deleteCase, getOwnedCase, listUploads } from "@/lib/server/case-repository";
import { requireMutationSession, requireSession } from "@/lib/server/session";
import { deleteCaseUploads } from "@/lib/server/uploads";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ caseId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireSession(request);
    const { caseId } = await context.params;
    return privateJson({
      case: await getOwnedCase(caseId, session.tokenHash),
      uploads: await listUploads(caseId, session.tokenHash),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireMutationSession(request);
    const { caseId } = await context.params;
    const uploads = await listUploads(caseId, session.tokenHash);
    await deleteCaseUploads(caseId, uploads.map((upload) => upload.storedName));
    await deleteCase(caseId, session.tokenHash);
    return privateEmpty();
  } catch (error) {
    return apiErrorResponse(error);
  }
}
