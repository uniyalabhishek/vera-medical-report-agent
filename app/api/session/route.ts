import type { NextRequest } from "next/server";
import { apiErrorResponse, privateJson } from "@/lib/server/api-error";
import { getProviderCapabilities } from "@/lib/model/gateway";
import {
  createSession,
  getSession,
  setSessionCookie,
} from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const existing = await getSession(request);
    const created = existing ? null : await createSession();
    const session = existing ?? {
      tokenHash: created!.tokenHash,
      csrfToken: created!.csrfToken,
      expiresAt: created!.expiresAt,
    };
    const capabilities = getProviderCapabilities();

    const response = privateJson({
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString(),
      dataMode: capabilities.liveAnalysis ? "live_enabled" as const : "synthetic_only" as const,
      storageMode: process.env.DATABASE_URL && process.env.BLOB_READ_WRITE_TOKEN
        ? "cloud" as const
        : "local" as const,
    });
    if (created) {
      setSessionCookie(response, created.token, created.expiresAt);
    }

    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
