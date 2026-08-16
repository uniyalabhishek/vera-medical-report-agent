import "server-only";

import { del, get } from "@vercel/blob";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DocumentCategory } from "@/lib/contracts";
import { ApiError } from "@/lib/server/api-error";
import { getDataDirectory } from "@/lib/server/data-path";
import { getStorageMode } from "@/lib/server/storage-mode";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES = 10;
const CASE_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const STORED_NAME_PATTERN = /^[0-9a-f-]{36}\.(?:pdf|jpg|png)$/i;
const CLOUD_STORED_NAME_PATTERN = /^cases\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(?:pdf|jpg|png)$/i;

type DetectedFile = {
  mimeType: "application/pdf" | "image/jpeg" | "image/png";
  extension: ".pdf" | ".jpg" | ".png";
};

function detectFile(bytes: Uint8Array): DetectedFile | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { mimeType: "application/pdf", extension: ".pdf" };
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: ".png" };
  }

  return null;
}

export function safeDisplayName(name: string) {
  return path.basename(name).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120) || "document";
}

function validateBytes(bytes: Uint8Array) {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_FILE_BYTES) {
    throw new ApiError(413, "FILE_SIZE_REJECTED", "Each file must be between 1 byte and 10 MB.");
  }
  const detected = detectFile(bytes);
  if (!detected) {
    throw new ApiError(415, "FILE_TYPE_REJECTED", "Only valid PDF, JPEG, and PNG files are accepted.");
  }
  return detected;
}

export async function storeUpload(caseId: string, file: File, category: DocumentCategory) {
  if (!CASE_ID_PATTERN.test(caseId)) {
    throw new ApiError(400, "INVALID_CASE_ID", "The case identifier is invalid.");
  }
  if (getStorageMode() === "cloud") {
    throw new ApiError(409, "DIRECT_UPLOAD_REQUIRED", "Use the protected direct-upload flow.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = validateBytes(bytes);

  const id = randomUUID();
  const storedName = `${id}${detected.extension}`;
  const caseDirectory = path.join(getDataDirectory(), "uploads", caseId);
  await mkdir(caseDirectory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(caseDirectory, storedName), bytes, { mode: 0o600, flag: "wx" });

  return {
    id,
    displayName: safeDisplayName(file.name),
    storedName,
    mimeType: detected.mimeType,
    sizeBytes: file.size,
    sourceMode: "uploaded" as const,
    category,
  };
}

function assertCloudStoredName(caseId: string, storedName: string) {
  const match = storedName.match(CLOUD_STORED_NAME_PATTERN);
  if (!CASE_ID_PATTERN.test(caseId) || !match || match[1].toLowerCase() !== caseId.toLowerCase()) {
    throw new ApiError(400, "INVALID_UPLOAD_PATH", "The stored upload path is invalid.");
  }
  return match;
}

async function readCloudUpload(caseId: string, storedName: string) {
  assertCloudStoredName(caseId, storedName);
  const result = await get(storedName, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) {
    throw new ApiError(404, "UPLOAD_NOT_FOUND", "The uploaded file could not be found.");
  }
  const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
  return { bytes, blob: result.blob };
}

export async function finalizeCloudUpload(
  caseId: string,
  storedName: string,
  displayName: string,
  category: DocumentCategory,
) {
  if (getStorageMode() !== "cloud") {
    throw new ApiError(409, "LOCAL_UPLOAD_REQUIRED", "Use the local upload flow.");
  }
  const match = assertCloudStoredName(caseId, storedName);
  const { bytes } = await readCloudUpload(caseId, storedName);
  try {
    const detected = validateBytes(bytes);
    return {
      id: match[2],
      displayName: safeDisplayName(displayName),
      storedName,
      mimeType: detected.mimeType,
      sizeBytes: bytes.byteLength,
      sourceMode: "uploaded" as const,
      category,
    };
  } catch (error) {
    // Delete only a blob whose bytes are invalid. A transient storage read
    // failure happens before this block and must leave the resumable upload in
    // place for the next attempt.
    await del(storedName).catch(() => undefined);
    throw error;
  }
}

export async function getStoredUploadData(caseId: string, storedName: string) {
  if (getStorageMode() === "cloud") {
    return (await readCloudUpload(caseId, storedName)).bytes;
  }
  return new Uint8Array(await readFile(getStoredUploadPath(caseId, storedName)));
}

export async function deleteStoredUpload(caseId: string, storedName: string) {
  if (getStorageMode() === "cloud") {
    assertCloudStoredName(caseId, storedName);
    await del(storedName);
    return;
  }
  await rm(getStoredUploadPath(caseId, storedName), { force: true });
}

export function getStoredUploadPath(caseId: string, storedName: string) {
  if (!CASE_ID_PATTERN.test(caseId) || !STORED_NAME_PATTERN.test(storedName)) {
    throw new ApiError(400, "INVALID_UPLOAD_PATH", "The stored upload path is invalid.");
  }

  const caseDirectory = path.resolve(getDataDirectory(), "uploads", caseId);
  const filePath = path.resolve(caseDirectory, storedName);
  if (!filePath.startsWith(`${caseDirectory}${path.sep}`)) {
    throw new ApiError(400, "INVALID_UPLOAD_PATH", "The stored upload path is invalid.");
  }
  return filePath;
}

export async function deleteStoredUploads(storedNames: string[]) {
  if (storedNames.length === 0 || getStorageMode() !== "cloud") return;
  await del(storedNames);
}

export async function deleteCaseUploads(caseId: string, storedNames: string[] = []) {
  if (!CASE_ID_PATTERN.test(caseId)) return;
  if (getStorageMode() === "cloud") {
    await deleteStoredUploads(storedNames.filter((name) => {
      try {
        assertCloudStoredName(caseId, name);
        return true;
      } catch {
        return false;
      }
    }));
    return;
  }
  const caseDirectory = path.join(getDataDirectory(), "uploads", caseId);
  await rm(caseDirectory, { recursive: true, force: true });
}

export function deleteCaseUploadsSync(caseId: string) {
  if (!CASE_ID_PATTERN.test(caseId)) return;
  const caseDirectory = path.join(getDataDirectory(), "uploads", caseId);
  rmSync(caseDirectory, { recursive: true, force: true });
}
