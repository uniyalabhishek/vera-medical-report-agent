import "server-only";

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiErrorBody } from "@/lib/contracts";
import { ProviderConfigurationError, ProviderProcessingError } from "@/lib/model/provider";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function privateJson<T>(body: T, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function privateEmpty(status = 204) {
  return new NextResponse(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return privateJson<ApiErrorBody>(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  if (error instanceof ProviderConfigurationError) {
    return privateJson<ApiErrorBody>(
      { error: { code: error.code, message: error.message } },
      { status: 503 },
    );
  }

  if (error instanceof ProviderProcessingError) {
    return privateJson<ApiErrorBody>(
      { error: { code: error.code, message: error.message } },
      { status: 502 },
    );
  }

  if (error instanceof ZodError) {
    return privateJson<ApiErrorBody>(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Please check the highlighted information.",
          fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
        },
      },
      { status: 400 },
    );
  }

  console.error("Unhandled API error", error);
  return privateJson<ApiErrorBody>(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. No unchecked result was created.",
      },
    },
    { status: 500 },
  );
}
