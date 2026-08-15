import { upload as uploadBlob } from "@vercel/blob/client";
import type {
  CaseView,
  DocumentCategory,
  Intake,
  QuestionResponse,
} from "@/lib/contracts";

type SessionResponse = {
  csrfToken: string;
  expiresAt: string;
  dataMode: "synthetic_only" | "live_enabled";
  storageMode: "local" | "cloud";
  speechInput: boolean;
  speechOutput: boolean;
};

type UploadResponse = {
  uploads: Array<{
    id: string;
    displayName: string;
    mimeType: string;
    sizeBytes: number;
    category: DocumentCategory;
  }>;
};

function voiceFilename(audio: Blob) {
  return audio.type.split(";", 1)[0].toLocaleLowerCase("en-IN") === "audio/mp4"
    ? "voice.mp4"
    : "voice.webm";
}

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

  resetSession() {
    this.csrfToken = "";
    this.initialization = null;
  }

  private async authenticatedFetch(
    url: string,
    init: RequestInit,
    mayRetry = true,
  ): Promise<Response> {
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
      cache: "no-store",
    });

    if (mayRetry && (response.status === 401 || response.status === 403)) {
      this.resetSession();
      await this.initialize();
      return this.authenticatedFetch(url, init, false);
    }
    return response;
  }

  private async mutation<T>(url: string, init: RequestInit): Promise<T> {
    const response = await this.authenticatedFetch(url, init);

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

  async getCase(caseId: string) {
    const response = await this.authenticatedFetch(`/api/cases/${caseId}`, { method: "GET" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      throw new ClientApiError(
        body?.error?.code ?? "REQUEST_FAILED",
        body?.error?.message ?? "The case could not be opened.",
        response.status,
      );
    }
    return ((await response.json()) as { case: CaseView }).case;
  }

  async createCase(intake: Intake, mode: "demo" | "uploaded") {
    const body = await this.mutation<{ case: CaseView }>("/api/cases", {
      method: "POST",
      body: JSON.stringify({ intake, mode }),
    });
    return body.case;
  }

  async uploadFiles(caseId: string, files: Array<{ file: File; category: DocumentCategory }>) {
    if (!this.csrfToken) await this.initialize();
    if (this.storageMode === "cloud") {
      const completed: UploadResponse["uploads"] = [];
      for (const [index, selected] of files.entries()) {
        const { file, category } = selected;
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
          body: JSON.stringify({
            pathname: blob.pathname,
            displayName: file.name,
            category,
            complete: index === files.length - 1,
          }),
        });
        completed.push(...finalized.uploads);
      }
      return { uploads: completed };
    }

    const form = new FormData();
    files.forEach(({ file }) => form.append("files", file));
    form.append("categories", JSON.stringify(files.map(({ category }) => category)));
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

  async confirm(caseId: string) {
    const body = await this.mutation<{ case: CaseView }>(
      `/api/cases/${caseId}/confirmation`,
      { method: "POST", body: JSON.stringify({}) },
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

  async transcribe(caseId: string, audio: Blob) {
    const form = new FormData();
    form.append("audio", audio, voiceFilename(audio));
    const body = await this.mutation<{ transcript: string }>(
      `/api/cases/${caseId}/speech/transcribe`,
      { method: "POST", body: form },
    );
    return body.transcript;
  }

  async transcribeIntake(language: Intake["language"], audio: Blob) {
    const form = new FormData();
    form.append("audio", audio, voiceFilename(audio));
    form.append("language", language);
    const body = await this.mutation<{ transcript: string }>(
      "/api/speech/transcribe",
      { method: "POST", body: form },
    );
    return body.transcript;
  }

  async speak(caseId: string, text: string) {
    const response = await this.authenticatedFetch(
      `/api/cases/${caseId}/speech/synthesize`,
      { method: "POST", body: JSON.stringify({ text }) },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      throw new ClientApiError(
        body?.error?.code ?? "SPEECH_FAILED",
        body?.error?.message ?? "Audio could not be created.",
        response.status,
      );
    }
    return response.blob();
  }

  async createVisualExplanation(caseId: string) {
    const response = await this.authenticatedFetch(
      `/api/cases/${caseId}/visual-explanation`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { code?: string; message?: string } }
        | null;
      throw new ClientApiError(
        body?.error?.code ?? "VISUAL_FAILED",
        body?.error?.message ?? "The visual explanation could not be created.",
        response.status,
      );
    }
    const image = await response.blob();
    if (image.type !== "image/jpeg" || image.size === 0) {
      throw new ClientApiError(
        "VISUAL_FAILED",
        "The visual explanation could not be created.",
        502,
      );
    }
    return image;
  }
}

export const medicalReportApi = new MedicalReportApi();
