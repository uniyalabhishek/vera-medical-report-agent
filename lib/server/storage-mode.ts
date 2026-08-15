import "server-only";

import { ApiError } from "@/lib/server/api-error";

export type StorageMode = "local" | "cloud";

export function getStorageMode(): StorageMode {
  const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
  const hasBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());

  if (hasDatabase && hasBlob) return "cloud";
  if (hasDatabase !== hasBlob) {
    throw new ApiError(
      503,
      "STORAGE_CONFIGURATION_INCOMPLETE",
      "Both DATABASE_URL and BLOB_READ_WRITE_TOKEN are required for cloud storage.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(
      503,
      "STORAGE_CONFIGURATION_REQUIRED",
      "Durable database and private file storage are not configured.",
    );
  }
  return "local";
}
