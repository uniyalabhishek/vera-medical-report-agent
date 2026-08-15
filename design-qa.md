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
