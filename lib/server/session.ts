import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { ApiError } from "@/lib/server/api-error";
import { deleteCaseUploadsSync, deleteStoredUploads } from "@/lib/server/uploads";
import { deleteExpiredRows, expiredUploadNames } from "@/lib/server/cloud-case-repository";
import { ensureCloudSchema, getCloudSql } from "@/lib/server/neon";
import { getStorageMode } from "@/lib/server/storage-mode";

const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1_000;
const SESSION_IDLE_MS = 30 * 60 * 1_000;

export const sessionCookieName =
  process.env.NODE_ENV === "production" ? "__Host-mre_session" : "mre_session";

type SessionRow = {
  token_hash: string;
  csrf_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
};

export type AuthSession = {
  tokenHash: string;
  csrfToken: string;
  expiresAt: number;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function csrfTokenForSession(token: string) {
  return hash(`vera-csrf-v1:${token}`);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function purgeExpiredData(now: number) {
  const idleCutoff = now - SESSION_IDLE_MS;
  if (getStorageMode() === "cloud") {
    try {
      const storedNames = await expiredUploadNames(now, idleCutoff);
      await deleteStoredUploads(storedNames);
      await deleteExpiredRows(now, idleCutoff);
    } catch (error) {
      console.error(`Cloud retention cleanup failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    }
    return;
  }

  const expiredCases = db
    .prepare(
      `SELECT c.id
       FROM cases c
       JOIN auth_sessions s ON s.token_hash = c.session_hash
       WHERE c.expires_at <= ? OR s.expires_at <= ? OR s.last_seen_at <= ?`,
    )
    .all(now, now, idleCutoff) as Array<{ id: string }>;

  for (const expiredCase of expiredCases) {
    deleteCaseUploadsSync(expiredCase.id);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `DELETE FROM cases
       WHERE expires_at <= ?
          OR session_hash IN (
            SELECT token_hash FROM auth_sessions
            WHERE expires_at <= ? OR last_seen_at <= ?
          )`,
    ).run(now, now, idleCutoff);
    db.prepare(
      "DELETE FROM auth_sessions WHERE expires_at <= ? OR last_seen_at <= ?",
    ).run(now, idleCutoff);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function createSession() {
  const now = Date.now();
  const token = randomToken();
  const csrfToken = csrfTokenForSession(token);
  const tokenHash = hash(token);
  const expiresAt = now + SESSION_ABSOLUTE_MS;

  if (getStorageMode() === "cloud") {
    await ensureCloudSchema();
    await getCloudSql().query(
      `INSERT INTO auth_sessions
        (token_hash, csrf_hash, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [tokenHash, hash(csrfToken), now, expiresAt],
    );
  } else {
    db.prepare(
      `INSERT INTO auth_sessions
        (token_hash, csrf_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(tokenHash, hash(csrfToken), now, now, expiresAt);
  }

  return { token, csrfToken, tokenHash, expiresAt };
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: number) {
  response.cookies.set({
    name: sessionCookieName,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function getSession(request: NextRequest): Promise<AuthSession | null> {
  const now = Date.now();
  await purgeExpiredData(now);

  const token = request.cookies.get(sessionCookieName)?.value;
  if (!token) return null;

  const tokenHash = hash(token);
  let row: SessionRow | undefined;
  if (getStorageMode() === "cloud") {
    await ensureCloudSchema();
    const rows = await getCloudSql().query(
      "SELECT token_hash, csrf_hash, created_at, last_seen_at, expires_at FROM auth_sessions WHERE token_hash = $1",
      [tokenHash],
    ) as Array<Record<keyof SessionRow, string | number>>;
    const cloudRow = rows[0];
    row = cloudRow ? {
      token_hash: String(cloudRow.token_hash),
      csrf_hash: String(cloudRow.csrf_hash),
      created_at: Number(cloudRow.created_at),
      last_seen_at: Number(cloudRow.last_seen_at),
      expires_at: Number(cloudRow.expires_at),
    } : undefined;
  } else {
    row = db
      .prepare("SELECT * FROM auth_sessions WHERE token_hash = ?")
      .get(tokenHash) as SessionRow | undefined;
  }

  if (!row) return null;

  if (row.expires_at <= now || row.last_seen_at + SESSION_IDLE_MS <= now) {
    if (getStorageMode() === "cloud") {
      await getCloudSql().query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
    } else {
      db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
    }
    return null;
  }

  if (getStorageMode() === "cloud") {
    await getCloudSql().query(
      "UPDATE auth_sessions SET last_seen_at = $1 WHERE token_hash = $2",
      [now, tokenHash],
    );
  } else {
    db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?").run(
      now,
      tokenHash,
    );
  }

  return {
    tokenHash,
    csrfToken: csrfTokenForSession(token),
    expiresAt: row.expires_at,
  };
}

export async function requireSession(request: NextRequest) {
  const session = await getSession(request);
  if (!session) {
    throw new ApiError(401, "SESSION_REQUIRED", "Your secure session expired. Please start again.");
  }
  return session;
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== request.nextUrl.origin) {
    throw new ApiError(403, "ORIGIN_REJECTED", "The request origin could not be verified.");
  }
}

export async function requireMutationSession(request: NextRequest) {
  assertSameOrigin(request);
  const session = await requireSession(request);
  const csrfToken = request.headers.get("x-csrf-token");

  if (!csrfToken || !safeEqual(csrfToken, session.csrfToken)) {
    throw new ApiError(403, "CSRF_REJECTED", "The secure form token is missing or expired.");
  }

  return session;
}
