# Vera internal MVP: release concerns

Last reviewed: 16 August 2026

## Product boundary

Vera has one job:

> Tell an adult what a blood test report or written prescription says, in their chosen language, using details checked against the uploaded files.

Vera is not a diagnostic tool. It must not infer a disease, cause, prognosis, or treatment. It must not tell a person to start, stop, or change medicine.

The current extractor supports literal lab results and written medicine instructions. It does not safely support radiology, pathology narratives, discharge summaries, or arbitrary clinical notes. Do not market it as a general medical-record explainer.

## Stop-ship gates before any real-person use

1. **Provider privacy approval**
   - Complete a data-flow and retention review for Sarvam and OpenAI.
   - Approve contracts, data processing terms, data location, access controls, incident handling, and deletion behavior.
   - Confirm the exact deployed models and endpoints. `store: false` is not a promise of zero provider retention.
   - Until this is complete, keep the product limited to made-up test files.

2. **Native-language and clinical review**
   - A native speaker must review every Hindi, Tamil, Kannada, and Marathi string.
   - A clinician must review safety boundaries and the terms for printed ranges, medicine instructions, and doctor questions.
   - Test with people who have low medical and digital literacy. Do not accept an engineer-only language review.

3. **Grounding and safety evaluation**
   - Build a fixed synthetic test set for all five languages, formats, and common report layouts.
   - Measure wrong values, wrong units, wrong dates, wrong ranges, missing pages, unsupported claims, unsafe advice, and wrong citations.
   - Define release thresholds and fail closed when a threshold is missed.

4. **Reliable deletion and retention**
   - Current cases expire after 24 hours and sessions after 30 minutes of inactivity.
   - Cleanup runs when another session request occurs. Add scheduled cleanup with monitoring before storing real-person data.
   - Verify that database rows, uploaded blobs, questions, answers, logs, backups, and provider copies follow one approved deletion policy.

5. **Production access and abuse controls**
   - Add authenticated user or staff access. The current anonymous cookie session is suitable only for a controlled internal MVP.
   - Add rate limits and cost limits for extraction, questions, speech input, and speech playback.
   - Add security logging that never records report text, patient data, questions, audio, provider responses, or API keys.

6. **Accessibility acceptance**
   - Complete keyboard, screen-reader, 200% zoom, reduced-motion, contrast, and Android Chrome tests.
   - Test microphone permission denied, speech failure, slow networks, refresh, and expired sessions in every language.
   - Observe real low-literacy users completing the flow without coaching.

## Required checks before a wider internal pilot

- Run the complete sample flow in all five languages on desktop and a small Android-sized viewport.
- Run synthetic uploaded PDF, JPG, and PNG files in every supported report language.
- Check every displayed value, unit, range, date, and medicine instruction against the source-backed facts retained by the server.
- Confirm that a partial or failed OCR job never produces a partial explanation.
- Confirm that a file with no accepted source-backed fact fails clearly.
- Confirm that two results are compared only when name, unit, printed range, numeric values, and two distinct valid dates match.
- Confirm that unsafe questions return a boundary and never medicine-change advice.
- Test Sarvam speech recognition with medicine names, Indian accents, numbers, dates, and units in all five languages.
- Test Sarvam speech playback for pronunciation, speed, and intelligibility with native speakers.
- Confirm that recorded audio is not persisted and speech text is editable before submission.
- Generate the visual explanation in every language. Check its localized title, result, range, alt text, loading state, failure state, and download.
- Check the generated artwork for text, numbers, logos, alarming imagery, invented disease, damaged anatomy, treatment, or advice. The validator must fail closed.
- Test restart and recovery after upload failure, extraction failure, safety-check failure, refresh, and a serverless timeout.

## Known MVP limitations

- Source coordinates currently cover the whole page. Vera shows the exact extracted text, but it does not highlight the exact place inside the original PDF or image.
- Processing has no durable job queue or lease. A serverless timeout can leave a case in an in-progress state.
- Large multi-file cases can still approach the route time limit even with the current bounded OCR concurrency.
- Cloud files are committed as one pending batch, but a browser closed mid-upload can still leave private orphan blobs until expiry cleanup runs.
- Questions and answers are retained with the temporary case to enforce the 20-question limit.
- The visual explanation covers one checked blood-test result at a time. It shows the biological concept behind the marker; it does not visualize every summary point.
- Visual generation is on demand and can take about two minutes. The browser reuses the image while the current tab remains open, but a refresh can generate and charge for another image. Add private, case-linked caching before a wider pilot.
- Generated artwork is supplemental. It contains no exact value, range, medicine instruction, diagnosis, or patient identity. The localized HTML beside it remains the source of truth.
- Patient-facing source controls are intentionally hidden in this simplified MVP. Source spans, citations, original-file routes, and the source component remain in the code for evaluation and a later expert/debug mode.
- Voice is turn-based. It is not a full-duplex phone-style conversation.
- The browser stops voice capture at 28 seconds, but the server does not independently inspect media duration. Keep the speech routes behind internal access until request-level rate and duration controls exist.
- Static translations still need native-speaker approval. Machine or agent review is not enough for release.
- Model and speech availability depends on the deployed account having access to the configured OpenAI and Sarvam models.
- Trends require the same test name, unit, printed range, numeric values, and two distinct ISO dates. The extractor does not yet capture specimen or laboratory method, so a clinician must validate trend behavior before real-person use.
- Literal fields must sit inside one short source window, but this is not a full table-cell parser. Dense OCR tables can still pair nearby fields incorrectly; keep live use limited to the synthetic evaluation set.

## Current safety properties worth preserving

- The selected explanation language is separate from the language used to read the report.
- Numbers, dates, medical names, ranges, doses, and units stay literal; surrounding words may be translated.
- Every accepted fact needs a high-confidence, verbatim source link and matching critical fields.
- Every uploaded file must contribute an accepted fact or the whole explanation fails.
- Range parsing is deterministic and rejects ambiguous text.
- The server owns accepted facts. The browser cannot silently approve model output.
- Explanations and non-boundary answers receive an independent safety check.
- Report and audio filenames sent to providers are opaque.
- Raw recorded audio is sent only for transcription and is not stored by this app.
- The visual planner uses one confirmed, non-review observation. It sends a server-owned, text-free physiology scene to GPT Image 2, not the patient name, age, filename, OCR text, source excerpt, exact result, range, symptoms, history, or prescription.
- A separate vision check rejects generated text, an unrelated biological concept, alarming content, damaged anatomy, diagnosis, treatment, or advice before the image reaches the browser.
- Original uploads are available only through the same authenticated session and use private, no-store responses.

## Provider references

- Sarvam Saaras speech-to-text: https://docs.sarvam.ai/api/getting-started/models/saaras
- Sarvam Bulbul text-to-speech: https://docs.sarvam.ai/api/getting-started/models/bulbul
- Sarvam authentication: https://docs.sarvam.ai/api-reference/authentication
- Sarvam privacy policy: https://www.sarvam.ai/privacy-policy
- OpenAI API data controls: https://developers.openai.com/api/docs/guides/your-data
- OpenAI image generation: https://developers.openai.com/api/docs/guides/image-generation
- OpenAI GPT Image 2: https://developers.openai.com/api/docs/models/gpt-image-2
