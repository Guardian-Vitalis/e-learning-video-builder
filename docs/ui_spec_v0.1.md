# UI Spec v0.1 (Binding)

## 1) Purpose
- This UI spec is the single binding authority for UI/UX decisions in this repo.
- All UI work must align with this spec before any design or behavior changes.
- The goal is consistent layout, typography, spacing, and component patterns across the local app.

## 2) Product UX principles (MVP)
- Local-first clarity: always state what is stored locally vs. in the cloud.
- Review & Approve gate: the approval step must be obvious and blocking for generation.
- Progressive disclosure: advanced details live behind toggles (e.g., Details).
- Recovery-first errors: every error state must provide a clear next action.

## 3) Layout rules
- App shell: max width 1100px, centered with horizontal padding 24px (16px on mobile).
- Page header: H1 + short summary line; optional secondary actions aligned to the right.
- Primary content uses stacked cards with 16–24px gaps.
- No horizontal scroll on mobile; controls wrap or stack.
- Side-by-side panels only when viewport >= 1024px; otherwise stacked.

## 4) Typography rules
- H1: page title (1 per page), 28–32px, medium/semibold.
- H2: section title, 20–24px, medium.
- H3: subsection title, 16–18px, medium.
- Body text: 14–16px, regular.
- Helper text: 12–14px, muted.
- Labels: 12–14px, medium.
- Heading length guidance: H1 <= 40 chars, H2/H3 <= 60 chars.

## 5) Color + status semantics
- Use existing Tailwind palette. Do not introduce a new theme system.
- Semantic mapping:
  - Success / OK: green
  - Warning / Needs attention: amber/yellow
  - Error / Failed: red
  - Neutral / Info: slate/gray/blue
- Status badges:
  - Compact chip with subtle background + readable text.
  - Do not use color alone; include text labels.

## 6) Components (binding patterns)
### Buttons
- Primary: main action, solid fill.
- Secondary: supporting action, outlined or light fill.
- Ghost: low-emphasis actions.
- Disabled: lower contrast and no hover.
- Loading: show text like "Saving..." or spinner; prevent double submit.

### Form fields
- Label above input.
- Helper text below when needed.
- Inline validation error below field (red text).
- Save state visible at the form level (e.g., "Saved.").

### Cards
- Structure: header (title) + body + footer actions.
- Use cards for distinct blocks (Upload, Preview, Export, Artifacts).
- Consistent internal padding (16–20px).

### Banners / alerts
- Error banner: short summary + optional Details toggle.
- Recovery action included when possible.
- For technical errors, hide details by default in a Details block.

### Empty states
- Short statement + single primary CTA.
- Avoid multi-paragraph explanations.

### Details disclosure
- Use Details/summary toggles for advanced info.
- Avoid dumping raw JSON by default.

### Tables / lists
- Clickable rows highlight on hover.
- Keyboard focus visible.
- Use concise labels and consistent spacing.

### Preview block
- Video player with captions.
- Show "Refresh" action when tokens can expire.
- On failure: explain and point to a recovery action.

### Export block
- Show progress states (Preparing, Downloading, Zipping).
- If token expires, retry once and show clear error if still blocked.

## 7) Error states (must-have)
Every error message must include:
1) What happened (plain language).
2) Why it matters (one line).
3) What to do next (clear action).
4) Optional Details toggle for technical info.

Never show stack traces by default.

## 8) Accessibility + UX basics
- Focus rings visible on keyboard navigation.
- Contrast meets WCAG AA for text and controls.
- Buttons have clear text labels (no icon-only actions without aria-labels).
- Form inputs are associated with labels.
- Avoid motion that distracts; if used, keep subtle and purposeful.
- Buttons reachable by keyboard.
- Form errors tied to fields.
- Color is not the only signal for status.

## 9) Non-goals (UI)
- No complex slide animations.
- No realtime collab UI.
- No SCORM/Moodle upload UI.

## 10) How to apply this spec
Checklist for any UI change:
- Use existing patterns/components first.
- Match spacing + typography.
- Add error + recovery states.
- Confirm local/cloud transparency is maintained.
