# Vera MVP design system

The visual source of truth is `Vera - Medical Report Agent.html` plus the supplied Claude artifact. The product uses one calm, centered mobile reading shell at every viewport. Larger screens add breathing room around the shell; they do not turn the experience into a dashboard.

## Direction

- Warm, calm, editorial, and human.
- Ivory paper on a warm neutral canvas.
- Dark ink for primary actions; muted sage and amber for status.
- Serif display headings with a highly readable multilingual sans-serif body.
- One clear action at a time. Avoid technical controls and dense metadata.
- Never use alarming red or generated diagnosis imagery.

## Core tokens

| Token | Value | Use |
|---|---|---|
| Canvas | `#efeae1` | Page background |
| Paper | `#fffdf9` | Main reading surface |
| Field | `#f6f2ea` | Quiet inputs and notes |
| Ink | `#23201c` | Primary text and actions |
| Muted | `#6e675d` | Supporting text |
| Sage | `#5f8b70` | Within-range and calm positive state |
| Sage soft | `#e5f3e9` | Summary and selected surfaces |
| Amber | `#c79a50` | Result to discuss, without alarm |
| Amber soft | `#f7ead2` | Quiet attention surface |
| Border | `#e7dfd2` | Dividers and controls |

Display text uses Instrument Serif with Noto script fallbacks. Interface text uses Plus Jakarta Sans with Noto Devanagari, Tamil, and Kannada fallbacks. Keep normal body and help text at 14–16 px. Keep primary touch targets at least 44 px high.

## Layout

- Reading shell: maximum 430 px wide.
- Outer page padding: 20–32 px when space permits.
- Paper surface: soft 44 px outer radius on larger viewports; reduced radius and padding on small phones.
- Progress: four thin marks. Do not add a separate review step.
- Questions: a dedicated fourth screen, not a desktop side rail.
- Dialogs: bottom-aligned sheets on mobile, centered within the viewport when space permits.

## Component families

- Native-script language pills at the start of the first screen.
- Large labeled inputs with plain validation text.
- Report, current-prescription, and past-prescription upload groups.
- Short three-stage processing state: uploading, reading, writing.
- Five-point mint summary with exact range and trend components below it.
- Written prescription restatement for current-prescription files only.
- Two visible summary actions: ask questions and see the picture explanation.
- Turn-based microphone input with an editable transcript.
- Explicit audio playback; never autoplay.
- Source spans and original-file viewing stay available to internal code, not the patient UI.

## Visual explanation

- Exact numbers, ranges, medicine instructions, and localized copy stay in HTML.
- Deterministic range and trend graphics stay exact.
- The optional generated image is one checked, text-free physiology illustration.
- It explains the biological concept behind a selected blood marker. It is not a scan, diagnosis, damaged organ, treatment, or picture of the user.

## Accessibility

- Localize every visible label, status, error, dialog, date, and accessibility name.
- Keep visible controls labeled. An icon-only control needs an accessible name and is reserved for familiar actions such as close or back.
- Use a visible focus ring, semantic headings, live status regions, and a skip link.
- Preserve keyboard focus inside dialogs and return it to the trigger on close.
- Respect reduced motion.
- Test keyboard use, screen readers, 200% zoom, contrast, microphone denial, and small Android viewports before wider use.

## Motion

- Use a short 160–220 ms opacity and vertical entry transition between screens.
- Use motion only to explain state change.
- Disable non-essential animation when `prefers-reduced-motion` is active.
