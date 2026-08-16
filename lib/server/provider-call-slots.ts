import "server-only";

import { db } from "@/lib/server/db";
import { ensureCloudSchema, getCloudSql } from "@/lib/server/neon";
import { getStorageMode } from "@/lib/server/storage-mode";

export type ProviderCallSlot =
  | { claimed: true; retryAfterMs: 0 }
  | { claimed: false; retryAfterMs: number };

async function claimCloudSlot(
  provider: string,
  intervalMs: number,
  now: number,
): Promise<ProviderCallSlot> {
  await ensureCloudSchema();
  const sql = getCloudSql();
  const nextAllowedAt = now + intervalMs;
  const rows = await sql.query(
    `INSERT INTO provider_call_slots (provider, next_allowed_at)
     VALUES ($1, $2)
     ON CONFLICT (provider) DO UPDATE SET next_allowed_at = EXCLUDED.next_allowed_at
     WHERE provider_call_slots.next_allowed_at <= $3
     RETURNING next_allowed_at`,
    [provider, nextAllowedAt, now],
  ) as Array<{ next_allowed_at: string | number }>;
  if (rows[0]) return { claimed: true, retryAfterMs: 0 };

  const current = await sql.query(
    "SELECT next_allowed_at FROM provider_call_slots WHERE provider = $1",
    [provider],
  ) as Array<{ next_allowed_at: string | number }>;
  return {
    claimed: false,
    retryAfterMs: Math.max(250, Number(current[0]?.next_allowed_at ?? now + intervalMs) - now),
  };
}

function claimLocalSlot(
  provider: string,
  intervalMs: number,
  now: number,
): ProviderCallSlot {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      "SELECT next_allowed_at FROM provider_call_slots WHERE provider = ?",
    ).get(provider) as { next_allowed_at: number } | undefined;
    if (row && row.next_allowed_at > now) {
      db.exec("COMMIT");
      return { claimed: false, retryAfterMs: Math.max(250, row.next_allowed_at - now) };
    }
    db.prepare(
      `INSERT INTO provider_call_slots (provider, next_allowed_at) VALUES (?, ?)
       ON CONFLICT (provider) DO UPDATE SET next_allowed_at = excluded.next_allowed_at`,
    ).run(provider, now + intervalMs);
    db.exec("COMMIT");
    return { claimed: true, retryAfterMs: 0 };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Atomically reserves one account-wide provider call window. */
export async function claimProviderCallSlot(
  provider: string,
  intervalMs: number,
  now = Date.now(),
): Promise<ProviderCallSlot> {
  if (!provider || !Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new Error("The provider call slot is invalid.");
  }
  if (getStorageMode() === "cloud") {
    return claimCloudSlot(provider, intervalMs, now);
  }
  return claimLocalSlot(provider, intervalMs, now);
}
