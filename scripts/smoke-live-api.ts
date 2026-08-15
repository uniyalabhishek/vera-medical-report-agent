import { readFile } from "node:fs/promises";

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
  await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/uploads`, {
    method: "POST",
    headers: mutationHeaders,
    body: form,
  }));

  const extracted = await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/extract`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({ mode: "uploaded" }),
  })) as { case: { facts: Array<{ confirmed: boolean; kind: string; source: { excerpt: string } }> } };

  const confirmedFacts = extracted.case.facts.map((fact) => ({ ...fact, confirmed: true }));
  const confirmed = await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/confirmation`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({ facts: confirmedFacts }),
  })) as { case: { analysis: { cards: Array<{ id: string }>; providerMode: string } } };

  const answer = await jsonResponse(await fetch(`${baseUrl}/api/cases/${caseId}/questions`, {
    method: "POST",
    headers: { ...mutationHeaders, "content-type": "application/json" },
    body: JSON.stringify({ question: "What value is recorded for HbA1c?" }),
  })) as { response: { answerType: string; citations: unknown[] } };

  console.log(JSON.stringify({
    dataMode: session.dataMode,
    extractedFacts: extracted.case.facts.length,
    factKinds: extracted.case.facts.map((fact) => fact.kind),
    allFactsHaveSourceExcerpts: extracted.case.facts.every((fact) => fact.source.excerpt.length > 0),
    analysisProvider: confirmed.case.analysis.providerMode,
    cards: confirmed.case.analysis.cards.map((card) => card.id),
    answerType: answer.response.answerType,
    answerCitations: answer.response.citations.length,
  }, null, 2));
} finally {
  if (caseId) {
    await fetch(`${baseUrl}/api/cases/${caseId}`, {
      method: "DELETE",
      headers: mutationHeaders,
    }).catch(() => undefined);
  }
}
