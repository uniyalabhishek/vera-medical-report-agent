import { upload as uploadBlob } from "@vercel/blob/client";
import type { CaseView, Fact, Intake, QuestionResponse } from "@/lib/contracts";

type SessionResponse = {
  csrfToken: string;
  expiresAt: string;
  dataMode: "synthetic_only" | "live_enabled";
  storageMode: "local" | "cloud";
};

type UploadResponse = {
  uploads: Array<{
    id: string;
    displayName: string;
    mimeType: string;
    sizeBytes: number;
  }>;
};

export class ClientApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

class MedicalReportApi {
  private csrfToken = "";
  private storageMode: "local" | "cloud" = "local";
  private initialization: Promise<SessionResponse> | null = null;

  async initialize() {
    if (this.initialization) return this.initialization;

    this.initialization = (async () => {
      const response = await fetch("/api/session", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await response.json()) as SessionResponse;
      if (!response.ok) {
        throw new ClientApiError("SESSION_FAILED", "Could not start a secure session.", response.status);
      }
      this.csrfToken = body.csrfToken;
      this.storageMode = body.storageMode;
      return body;
    })();

    try {
      return await this.initialization;
    } catch (error) {
      this.initialization = null;
      throw error;
    }
  }

  private async mutation<T>(url: string, init: RequestInit): Promise<T> {
    if (!this.csrfToken) await this.initialize();

    const headers = new Headers(init.headers);
    headers.set("x-csrf-token", this.csrfToken);
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, {
      ...init,
      headers,
      credentials: "same-origin",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      throw new ClientApiError(
        body?.error?.code ?? "REQUEST_FAILED",
        body?.error?.message ?? "The request could not be completed.",
        response.status,
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async createCase(intake: Intake, mode: "demo" | "uploaded") {
    const body = await this.mutation<{ case: CaseView }>("/api/cases", {
      method: "POST",
      body: JSON.stringify({ intake, mode }),
    });
    return body.case;
  }

  async uploadFiles(caseId: string, files: File[]) {
    if (!this.csrfToken) await this.initialize();
    if (this.storageMode === "cloud") {
      const completed: UploadResponse["uploads"] = [];
      for (const file of files) {
        const extension = file.type === "application/pdf"
          ? "pdf"
          : file.type === "image/png" ? "png" : "jpg";
        const pathname = `cases/${caseId}/${crypto.randomUUID()}.${extension}`;
        const blob = await uploadBlob(pathname, file, {
          access: "private",
          handleUploadUrl: `/api/cases/${caseId}/uploads/token`,
          headers: { "x-csrf-token": this.csrfToken },
          contentType: file.type,
        });
        const finalized = await this.mutation<UploadResponse>(`/api/cases/${caseId}/uploads`, {
          method: "POST",
          body: JSON.stringify({ pathname: blob.pathname, displayName: file.name }),
        });
        completed.push(...finalized.uploads);
      }
      return { uploads: completed };
    }

    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    return this.mutation<UploadResponse>(`/api/cases/${caseId}/uploads`, {
      method: "POST",
      body: form,
    });
  }

  async extract(caseId: string, mode: "demo" | "uploaded") {
    const body = await this.mutation<{ case: CaseView }>(`/api/cases/${caseId}/extract`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
    return body.case;
  }

  async confirm(caseId: string, facts: Fact[]) {
    const body = await this.mutation<{ case: CaseView }>(
      `/api/cases/${caseId}/confirmation`,
      { method: "POST", body: JSON.stringify({ facts }) },
    );
    return body.case;
  }

  async ask(caseId: string, question: string) {
    const body = await this.mutation<{ response: QuestionResponse }>(
      `/api/cases/${caseId}/questions`,
      { method: "POST", body: JSON.stringify({ question }) },
    );
    return body.response;
  }

  async deleteCase(caseId: string) {
    await this.mutation<void>(`/api/cases/${caseId}`, { method: "DELETE" });
  }
}

export const medicalReportApi = new MedicalReportApi();
