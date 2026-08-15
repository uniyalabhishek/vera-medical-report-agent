# Vera

Vera is a mobile-first medical report explainer for synthetic or de-identified files. It checks source-linked facts internally, creates a five-part summary and one calm physiology picture, and answers questions from those facts only.

It does not diagnose, recommend treatment, or tell a user to change medicine.

## Run locally

```bash
bun install
cp .env.example .env.local
bun run dev
```

Add `OPENAI_API_KEY` and `SARVAM_API_KEY` to `.env.local` to enable live PDF, JPG, and PNG analysis. Without both keys, the safe synthetic sample still works.

Open `http://localhost:3000`.

## Verify

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

With the local server running and both keys configured:

```bash
bun scripts/smoke-live-api.ts
```

The smoke test uses only [the synthetic fixture](./fixtures/synthetic-medical-report.pdf) and deletes its temporary case.

## Current MVP boundary

- Adults only.
- Synthetic or fully de-identified files only.
- PDF, JPG, and PNG; up to 10 files and 10 MB each.
- No DICOM or medical-image interpretation.
- Generated pictures explain one blood marker; they are not scans, diagnoses, or pictures of the user's body.
- No live web research, diagnosis, treatment, or medication changes.
- Case access expires after 24 hours; “Start over” deletes the case and stored files immediately.
- Automated physical deletion is opportunistic in this MVP, so identified patient data is out of scope.

## Deploy the buildathon MVP to Vercel

Connect two storage integrations in the Vercel project:

1. Neon Postgres, which supplies `DATABASE_URL`.
2. A **private** Vercel Blob store, which supplies `BLOB_READ_WRITE_TOKEN`.

Then add `OPENAI_API_KEY`, `SARVAM_API_KEY`, and `MVP_ACCESS_CODE` as encrypted Production environment variables. The access username is `vera`; use a unique high-entropy access code. Production fails closed if the database, Blob store, or access code is missing.

The browser uploads directly to the private Blob store with a short-lived, case-scoped token. Vera validates the real file bytes before recording the upload. Use only synthetic or fully de-identified files for this MVP.

For continued work, read the [agent handoff](./docs/AGENT_HANDOFF.md), then the [final MVP architecture](./docs/medical-report-explainer-final-architecture.md). The [detailed research reference](./docs/medical-report-explainer-architecture.md) records the broader production analysis and sources.
