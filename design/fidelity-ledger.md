# Vera fidelity ledger

Reference: `Vera - Medical Report Agent.html` and the supplied Claude artifact.  
Implementation evidence: `design/implementation/vera-explanation-desktop.png` and `design/implementation/vera-about-mobile-production.png`.  
Capture method: in-app Browser screenshots at desktop and mobile viewports, followed by local `view_image` comparison.

| Point | Reference | Implementation | Result |
|---|---|---|---|
| Visual tone | Warm paper, dark ink, muted green | Same calm palette; no alarming red | Matched |
| Typography | Editorial serif headings with quiet body text | Serif display hierarchy with compact sans-serif body | Matched |
| Progress | Four thin mobile progress marks | Four labeled desktop steps and compact mobile marks | Matched, responsive |
| Surfaces | Soft rounded document and prescription cards | Rounded intake, upload, fact, source, and answer cards | Matched |
| Controls | Dark primary pills and pale secondary controls | Same hierarchy with accessible focus and disabled states | Matched |
| Information density | Spacious mobile document flow | Spacious mobile; denser two-column explanation on desktop | Intentional adaptation |
| Medical visuals | Calm status treatments | Deterministic range and timeline views; no generated diagnosis imagery | Safer adaptation |

Above the fold differs intentionally. The reference opens on “Add your reports.” Vera opens on “A little about you” because name, age, language, symptoms, and history are required before document upload. The implementation keeps the reference tone and step language while making the data boundary clear first.

Intentional deviations:

- DICOM is excluded from the MVP; Vera accepts only PDF, JPG, and PNG.
- A required de-identification consent appears before processing.
- Users review every extracted fact before analysis.
- A sticky bottom action was removed because it covered controls on short mobile screens.
- “Visual analysis” uses deterministic range and timeline graphics, not generated medical imagery.
