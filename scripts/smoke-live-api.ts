import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = "http://localhost:3000";
const fixturePath = new URL("../fixtures/synthetic-medical-report.pdf", import.meta.url);

type JsonObject = Record<string, unknown>;

async function jsonResponse(response: Response) {
  const body = await response.json() as JsonObject;
  if (!response.ok) {
    const message = (body.error as { message?: string } | undefined)?.message;
    throw new Error(`${response.status} ${message ?? "Request failed"}`);
  }
  return body;
}

async function transcodeToM4a(inputPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    const process = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputPath,
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      outputPath,
    ], { stdio: "ignore" });
    process.once("error", reject);
    process.once("exit", (code) => code === 0
      ? resolve()
      : reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}`)));
  });
}

const sessionResponse = await fetch(`${baseUrl}/api/session`, { cache: "no-store" });
const session = await jsonResponse(sessionResponse) as {
  csrfToken: string;
  dataMode: string;
};
const cookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
if (!cookie) throw new Error("The smoke test session did not return a cookie.");
if (session.dataMode !== "live_enabled") throw new Error("Live provider mode is not enabled.");

const mutationHeaders = {
  cookie,
  origin: baseUrl,
  "x-csrf-token": session.csrfToken,
};

let caseId: string | null = null;

try {
  const created = await jsonResponse(await fetch(`${baseUrl}/api/cases`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      mode: "uploaded",
      intake: {
        preferredName: "Demo",
        age: 42,
        language: "English",
        documentLanguage: "English",
        symptoms: "",
        medicalHistory: "",
      },
    }),
  })) as { case: { id: string } };
  caseId = created.case.id;

  const form = new FormData();
  const fixtureBytes = await readFile(fixturePath);
  form.append(
    "files",
    new Blob([fixtureBytes], { type: "application/pdf" }),
    "synthetic-medical-report.pdf",
  );
  form.append("categories", JSON.stringify(["report"]));
  await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/uploads`, {
    method: "POST",
    headers: mutationHeaders,
    body: form,
  }));

  const extracted = await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/extract`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({ mode: "uploaded" }),
  })) as {
    case: {
      facts: Array<{
        confirmed: boolean;
        kind: "observation" | "medication";
        name?: string;
        medicine?: string;
        source: { excerpt: string };
      }>;
    };
  };

  const confirmed = await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/confirmation`, {
    method: "POST",
    headers: mutationHeaders,
  })) as { case: { analysis: { cards: Array<{ id: string }>; providerMode: string } } };

  const firstFact = extracted.case.facts[0];
  const question = firstFact.kind === "observation"
    ? `What value is recorded for ${firstFact.name}?`
    : `What written dose is shown for ${firstFact.medicine}?`;
  const answer = await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/questions`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({ question }),
  })) as { response: { answerType: string; answer: string; citations: unknown[] } };

  const speechResponse = await fetch(`${baseUrl}/api/cases/${caseId}/speech/synthesize`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({ text: answer.response.answer }),
  });
  if (!speechResponse.ok) await jsonResponse(speechResponse);
  if (speechResponse.headers.get("content-type") !== "audio/mpeg") {
    throw new Error("Speech playback did not return MP3 audio.");
  }
  const speechBytes = new Uint8Array(await speechResponse.arrayBuffer());
  if (speechBytes.byteLength === 0) throw new Error("Speech playback returned no audio.");

  const voiceDirectory = await mkdtemp(join(tmpdir(), "vera-voice-smoke-"));
  let transcript = "";
  try {
    const mp3Path = join(voiceDirectory, "answer.mp3");
    const m4aPath = join(voiceDirectory, "answer.m4a");
    await writeFile(mp3Path, speechBytes);
    await transcodeToM4a(mp3Path, m4aPath);
    const voiceForm = new FormData();
    voiceForm.append(
      "audio",
      new Blob([await readFile(m4aPath)], { type: "audio/mp4" }),
      "voice.m4a",
    );
    const transcription = await jsonResponse(await fetch(
      `${baseUrl}/api/cases/${caseId}/speech/transcribe`,
      { method: "POST", headers: mutationHeaders, body: voiceForm },
    )) as { transcript: string };
    transcript = transcription.transcript.trim();
    if (!transcript) throw new Error("Speech transcription returned no words.");
  } finally {
    await rm(voiceDirectory, { recursive: true, force: true });
  }

  console.log(JSON.stringify({
    dataMode: session.dataMode,
    extractedFacts: extracted.case.facts.length,
    factKinds: extracted.case.facts.map((fact) => fact.kind),
    allFactsHaveSourceExcerpts: extracted.case.facts.every((fact) => fact.source.excerpt.length > 0),
    analysisProvider: confirmed.case.analysis.providerMode,
    cards: confirmed.case.analysis.cards.map((card) => card.id),
    answerType: answer.response.answerType,
    answerCitations: answer.response.citations.length,
    speechBytes: speechBytes.byteLength,
    voiceTranscriptPresent: transcript.length > 0,
  }, null, 2));
} finally {
  if (caseId) {
    await fetch(`${baseUrl}/api/cases/${caseId}`, {
      method: "DELETE",
      headers: mutationHeaders,
    }).catch(() => undefined);
  }
}
