import { privateJson } from "@/lib/server/api-error";

export const runtime = "nodejs";

export function GET() {
  return privateJson({ status: "ok" });
}
