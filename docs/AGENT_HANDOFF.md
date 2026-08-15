# Vera Agent Handoff

**Status:** Current as of 16 August 2026
**Repository:** <https://github.com/uniyalabhishek/vera-medical-report-agent>
**Deployment:** <https://vera-medical-report-agent.vercel.app/>
**Branch and deployed code:** `main` at `597d117` (`Harden end-to-end report experience`)

**Local working tree:** Contains the uncommitted four-screen redesign, localization, source-free patient UI, document hardening, speech, generated-picture feature, tests, and documentation reconciliation described below. Vercel does not contain these local changes yet.

This is the first document a new agent should read. It records what is shipped, what was intentionally decided, what was tested, and what remains unsafe or incomplete.

## 1. Read in this order

1. **This handoff** — operational truth and next work.
2. [Final MVP architecture](./medical-report-explainer-final-architecture.md) — authoritative product and system decisions.
3. [Design QA](../design-qa.md) and [fidelity ledger](../design/fidelity-ledger.md) — approved four-screen UX and intentional deviations.
4. [Detailed research reference](./medical-report-explainer-architecture.md) — model, cost, privacy, regulatory, OCR, DICOM, and production research. It is not the shipped spec.
5. [Original brief](../initial-idea-brainstorm.md) — starting idea only; later safety and scope decisions override it.
6. [Reference HTML](../Vera%20-%20Medical%20Report%20Agent.html) — primary visual reference. Also use the supplied Claude artifact: <https://claude.ai/code/artifact/5bc40f83-c472-45f5-a86c-41f15896d174>.

## 2. Current product

Vera explains medical reports and written prescriptions for adults. It is designed for Indian users who may have low medical literacy, limited digital literacy, or limited English.

The shipped journey has exactly four screens:

1. About you.
2. Your documents.
3. Your five-point summary.
4. Follow-up questions.

Do not add a screen that asks the user to approve every extracted value. That UX was built, rejected, and removed. The system must do the checking. If a critical field cannot be checked safely, omit it or block the analysis with a plain explanation.

The product explains source documents. It does not diagnose, infer causes, recommend treatment, change medicine, interpret diagnostic images, or search the live web with patient context.

## 3. Current repository and deployment state

- Framework: Next.js 16.3.1, React 19, TypeScript, Node 24, Bun.
- Git remote: `origin` points to `uniyalabhishek/vera-medical-report-agent`.
- Local `main` and `origin/main` point to `597d117` in the current checkout.
- The full redesign, localization, document checks, speech, generated picture, tests, and documentation reconciliation are intentionally uncommitted in the current working tree. Review them as one product pass before committing.
- Vercel health endpoint returned `{"status":"ok"}` on 15 August 2026.
- The deployed home page returned `401` without credentials, confirming the Basic access gate.
- Production username is `vera`; the password is `MVP_ACCESS_CODE` in Vercel. Never put it in code or docs.
- Production uses Neon Postgres plus a private Vercel Blob store.
- Local development uses Node SQLite plus `.data/uploads`.
- Two report-test PDFs are present locally and untracked. Preserve them and do not commit them:
  - `75cfc491-2e72-4da3-b4e8-748fca893f30_TC-02__Iron_deficiency_anaemia_in_a_young_woman_(Tamil).pdf`
  - `e8bb8dc3-6461-4bc4-b96b-666fb1c043b2_TC-01__Uncontrolled_Type_2_Diabetes_with_early_complications_(Hindi).pdf`

Do not assume these PDFs are safe for public distribution even if they are test cases. Keep secrets and `.env.local` untracked. A test database URI was pasted into chat during the buildathon; rotate that database credential after the demo.

## 4. Architecture in one view

```text
Browser
  → Vercel Basic access gate
  → anonymous httpOnly session + same-origin CSRF
  → private upload storage
  → Sarvam document digitisation
  → OpenAI structured fact extraction
  → exact-source and deterministic numeric checks
  → internal auto-accept
  → OpenAI five-card synthesis
  → separate OpenAI synthesis safety check
  → display sanitizer
  → summary, deterministic visuals, optional checked picture, and grounded Q&A

State: SQLite locally / Neon on Vercel
Files: local private directory / private Vercel Blob
```

There is one bounded workflow, not an autonomous agent swarm. See the final architecture for the exact models, routes, limits, state machine, and security controls.

## 5. Critical code map

| Area | Source of truth |
|---|---|
| Four-screen orchestration and auto-accept | `components/medical-report-app.tsx` |
| About and document upload UI | `components/intake-upload-step.tsx` |
| Summary, visuals, internal citations, and Q&A | `components/explanation-step.tsx` |
| Generated-picture UI and provider boundary | `components/picture-summary.tsx`, `lib/server/visual-explanation.ts` |
| Turn-based voice input and playback | `components/voice-controls.tsx`, `lib/server/sarvam-speech.ts` |
| API and model contracts | `lib/contracts.ts` |
| Browser API client and Blob upload | `lib/client/api.ts` |
| Provider routing | `lib/model/gateway.ts` |
| Sarvam and OpenAI live pipeline | `lib/model/live-provider.ts` |
| Stable synthetic demonstration | `lib/model/demo-provider.ts` |
| Display-text and citation cleanup | `lib/display-text.ts` |
| Session, CSRF, and retention cleanup | `lib/server/session.ts` |
| Local/cloud repository switch | `lib/server/case-repository.ts` |
| Neon schema and repository | `lib/server/neon.ts`, `lib/server/cloud-case-repository.ts` |
| Upload validation and storage | `lib/server/uploads.ts` |
| Vercel Basic access gate | `proxy.ts` |
| CSP and security headers | `next.config.ts` |

`components/review-step.tsx` from the rejected review screen is removed in the current working tree.

## 6. Environment configuration

Required for live analysis:

```text
OPENAI_API_KEY
SARVAM_API_KEY
```

Also required in production:

```text
DATABASE_URL
BLOB_READ_WRITE_TOKEN
MVP_ACCESS_CODE
```

Optional:

```text
VERA_DATA_DIR
OPENAI_EXTRACTION_MODEL
OPENAI_SYNTHESIS_MODEL
OPENAI_QUESTION_MODEL
```

`ALLOW_UNPROTECTED_MVP=true` bypasses the production access gate. Keep it unset. The application fails closed in production if database and Blob configuration are incomplete.

## 7. What has been verified

The deployed `597d117` build was verified as follows:

- lint passed;
- TypeScript checks passed;
- 3 test files and 10 tests passed;
- production build passed;
- local synthetic flow passed all four screens and Q&A;
- local real Hindi PDF flow passed upload, Sarvam OCR, extraction, synthesis, summary, and Q&A;
- observed local live latency was about 28 seconds for Sarvam plus 56 seconds for synthesis and verification;
- deployed synthetic flow passed all four screens and Q&A after one transient `Failed to fetch` retry;
- deployed haemoglobin Q&A returned the haemoglobin fact, not HbA1c;
- generic cleanup removed raw `span_UUID` values from summary and Q&A display.

Be precise about the evidence: a real PDF completed locally; a synthetic case completed on the deployed site. A deployed real-PDF end-to-end run was not completed. The stricter 55-word synthesis prompt was added after the observed dense Hindi result and was not re-run on a fresh live PDF.

The latest uncommitted local tree adds the final internal-MVP UX and safety pass:

- missing prescription fields such as `not provided`, `not specified`, `not stated`, `unknown`, `N/A`, `-`, or an empty value are omitted from medication rows and the source-detail view;
- the synthesis prompt tells the model not to show absent-field placeholders;
- the selected language now controls the complete four-screen UI, dates, loading, errors, speech, and picture copy across English, Hindi, Tamil, Kannada, and Marathi;
- patient-facing source pills and the source dialog are removed, while source spans, citations, the original-file route, and source component remain intact;
- Sarvam turn-based speech input and playback are wired through same-origin server routes;
- the picture action now creates one text-free GPT Image 2 physiology illustration from a server-owned `VisualSpec`, then runs a separate visual check before display;
- exact values, units, ranges, and localized explanation remain accessible HTML outside generated artwork;
- TypeScript, ESLint, 10 test files with 64 tests, and the production build pass;
- the local four-screen synthetic flow, grounded Q&A, source-free UI, Hindi first screen, and a real generated/validated HbA1c picture passed in Chrome.

Example: `METFORMIN 1000 mg · 1-0-1 after food` is shown without an unexplained trailing `not provided` value.

This complete local pass has **not** been committed, pushed, or deployed. The Vercel site still shows the behavior from `597d117` until the working tree is reviewed and published.

## 8. Decisions that must survive the handoff

- Keep the reference design's calm, editorial, warm-paper visual language. Adapt it for responsive web; do not copy decorative phone chrome.
- Keep native-script language pills: English, हिन्दी, தமிழ், ಕನ್ನಡ, मराठी.
- Keep the product mobile-first and desktop-compatible.
- Keep the four-screen journey. Do not restore manual parameter checkboxes.
- Use internal checking and fail safely on uncertainty.
- Use deterministic range, trend, and prescription views. The picture feature may generate one checked, text-free physiology illustration; exact medical facts must stay in accessible HTML.
- Use only synthetic or fully de-identified documents for the MVP.
- Keep DICOM and all diagnostic-image pixels out.
- Keep live patient-context web research out. An approved evidence corpus is a later, reviewed system.
- Keep Neon and Vercel Blob. Do not add Convex.
- Keep a stable synthetic path so the demo works when providers are slow or unavailable.
- Do not promise that any report will be handled perfectly.
- Do not commit, push, deploy, rotate credentials, or change external services without the user's explicit instruction.
- GitHub accepts unsigned commits. If local GPG signing blocks an authorized commit, use a one-command signing override; do not change global Git settings.

## 9. Known gaps and risks

### Fix next

1. **Durable long-running work:** staged progress is now visible, but analysis still has no durable job queue, lease, or polling contract. A serverless timeout can leave an in-progress case.
2. **No deployed real-file proof:** run one synthetic/de-identified PDF through the protected Vercel deployment and capture timings and failures.
3. **Native review:** all static UI keys exist in all five languages, but native speakers and a clinician still need to review every Indic string and spoken output.
4. **Picture reuse and cost:** the browser reuses a generated picture only while the tab is open. Add a private, case-linked cache and request rate limit before a wider pilot.
5. **Internal naming debt:** replace the misleading `confirmed`/`NEEDS_REVIEW` terminology with `accepted`/`CHECKED` or an equivalent internal state.
6. **Voice duration enforcement:** the browser stops at 28 seconds, but the server does not inspect media duration independently.

### Required before any real-patient pilot

- Extraction confidence is enforced at the live-provider boundary but not persisted for later audit. Build a clinician-labeled evaluation set and retain safe audit metadata before real-person use.
- Mixed-patient uploads are not detected.
- Live source bounding boxes are placeholders (`[0,0,1,1]`); the source view shows an OCR excerpt, not the original highlighted page.
- Upload validation checks magic bytes and size, but there is no malware scan or structural document sanitation.
- Cleanup is opportunistic, not a durable scheduled deletion job.
- There is no PHI-safe tracing, provider-stage latency dashboard, alerting, or kill switch.
- Multilingual deterministic treatment-change boundaries exist, but they still need clinician-reviewed adversarial tests in all five languages.
- There is no clinician-labeled multilingual evaluation set or release threshold.
- There is no approved health-data vendor contract, security review, clinical review, Indian legal/regulatory review, or real-PHI authorization.

## 10. Recommended next execution order

1. Review the current diff and ensure the two untracked report-test PDFs are excluded.
2. Re-run lint, typecheck, tests, and build; then commit and push only with the user's approval.
3. Confirm Vercel deploys the new commit and verify that missing medication fields are omitted there.
4. Run the protected deployed real-PDF vertical slice once and record stage timings.
5. Make long-running analysis resumable with a durable job/lease and polling contract.
6. Add private generated-picture caching plus case and session rate limits.
7. Complete native-language and clinician review, including speech and adversarial Q&A.
8. Build the de-identified evaluation harness before changing models or adding providers.
9. Persist safe extraction-confidence audit metadata without adding user checkboxes.
10. Add durable deletion, source coordinates, document sanitation, mixed-patient checks, and operational telemetry before any pilot.

## 11. Commands

```bash
bun install
cp .env.example .env.local
bun run dev
```

Verify:

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

With local live-provider keys and the server already running:

```bash
bun scripts/smoke-live-api.ts
```

The smoke script uses the tracked synthetic fixture and deletes its temporary case. For manual browser validation, test 430 px mobile and a normal desktop width, then cover all four screens, the picture explanation, Q&A, deletion, refresh/session expiry, and one provider failure. Source links remain an internal grounding mechanism and are intentionally hidden from the patient UI.

## 12. Definition of the next safe milestone

The next milestone is not “supports more features.” It is:

- one real de-identified report completes reliably on Vercel;
- the user sees honest progress and a recoverable failure state;
- unsafe or uncertain critical facts are omitted or blocked internally;
- summary and Q&A are short and readable in one reviewed Indic language;
- every displayed patient fact retains a valid internal source binding;
- the synthetic demo remains deterministic.
