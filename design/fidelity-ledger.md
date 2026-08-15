# Vera fidelity ledger

Reference: `Vera - Medical Report Agent.html` and the supplied Claude artifact.  
Implementation evidence: live local Chrome renders at a 430 px mobile viewport and in the centered desktop shell on 16 August 2026. Older files under `design/implementation/` predate the final four-screen pass and are not authoritative.
Capture method: Chrome screenshots plus visible-DOM and console checks.

| Point | Reference | Implementation | Result |
|---|---|---|---|
| Visual tone | Warm paper, dark ink, muted green | Same calm palette; no alarming red | Matched |
| Typography | Editorial serif headings with quiet body text | Serif display hierarchy with compact sans-serif body | Matched |
| Progress | Four thin mobile progress marks | Same four compact marks at every viewport | Matched |
| Surfaces | Soft rounded document and prescription cards | Rounded intake, upload, fact, picture, and answer cards | Matched |
| Controls | Dark primary pills and pale secondary controls | Same hierarchy with accessible focus and disabled states | Matched |
| Information density | Spacious mobile document flow | Same centered mobile reading shell on larger screens | Intentional adaptation |
| Medical visuals | Calm status treatments | Deterministic range and timeline views plus one checked, text-free physiology illustration | Safer adaptation |

Above the fold differs intentionally. The reference opens on “Add your reports.” Vera opens on “A little about you” because name, age, language, symptoms, and history are required before document upload. The implementation keeps the reference tone and step language while making the data boundary clear first.

Intentional deviations:

- DICOM is excluded from the MVP; Vera accepts only PDF, JPG, and PNG.
- The adult age limit stays in the form. Data-handling concerns stay out of the primary four-screen flow and are recorded in the release document.
- Extracted facts are accepted without a separate review screen; internal checks and a separate synthesis verifier protect the four-screen low-literacy flow.
- Sticky bottom actions were removed because they covered report details on short screens. Summary actions now stay in normal document flow.
- Exact ranges and trends stay deterministic. The optional generated picture is a checked, text-free physiology illustration; exact medical facts stay in accessible HTML.
