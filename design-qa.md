# Vera design QA

Reference: the four-screen mobile mockup supplied on 2026-08-15.

Render checked: localhost in Chrome at the existing 430 px mobile viewport.

## Comparison

| Area | Reference | Render | Result |
| --- | --- | --- | --- |
| Journey | About, documents, summary, follow-up questions | Same four stages; no fact-review stage | Pass |
| Languages | English, हिन्दी, தமிழ், ಕನ್ನಡ, मराठी | Same native-script labels and pill treatment | Pass |
| Summary | Large serif heading and calm mint five-point panel | Same hierarchy, palette, numbered list, and status pills | Pass |
| Report details | Result range, trend, and written prescription below the summary | Same evidence-backed detail order | Pass |
| Questions | Separate Ask Vera screen with suggested question and answer area | Separate fourth screen with back navigation and working question form | Pass |
| Mobile composition | Warm paper surface, dark primary actions, restrained borders | Matches the existing Vera token system and reference density | Pass |

Remaining P3 difference: device status-bar and phone-frame chrome are not reproduced because the implementation is a responsive web app.

Final result: passed

## Polish pass (2026-08-15, evening)

Rechecked against `Vera - Medical Report Agent.html` at desktop and 430 px widths.

- Ask Vera: the question input starts empty with the reference placeholder ("Ask about any result…"); example questions use neutral suggestion pills; answers stay in warm paper cards without patient-facing source controls.
- Range visual: cool grey track replaced with the reference treatment — warm sand track, mint typical band, solid amber result dot.
- Timeline: warm line and dot borders; the current point is a filled amber dot.
- Removed remaining cool blue-greys (placeholders, answer-panel border, evidence highlight now sage).
- Summary screen uses a compact localized date-and-document line above the main serif heading.

## Pre-commit accessibility pass (2026-08-16)

- Rechecked the complete synthetic flow in Chrome at 430 px and the Hindi first screen in the centered desktop shell.
- Core help text and controls now use readable text sizes and at least 44 px primary touch targets.
- “See picture explanation” is a visible localized action, not an unexplained icon.
- Summary actions stay in normal document flow and do not cover the trend or prescription.
- No application console error appeared; observed warnings came from installed browser extensions.
