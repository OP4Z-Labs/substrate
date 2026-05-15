---
scope: frontend
area: accessibility
last_updated: TODO
rules:
  - FE-A11Y-001
  - FE-A11Y-002
update_triggers:
  - WCAG conformance bar changes
  - Component-library updates
---

# Frontend Accessibility Standards

> Cadence scaffold — fill in the TODOs.

The accessibility bar this product holds and the patterns that meet it.

## 1. Conformance target

TODO: WCAG 2.1 AA (or your target). Tested how often, with which tools.

## 2. Semantic HTML

TODO: Prefer real elements over divs with roles. `<button>` not
`<div onClick>`. Headings in order. Landmarks present.

## 3. Keyboard navigation

TODO: Every interactive element reachable via Tab. Focus order matches
visual order. Focus rings visible (don't `outline: none` without a
replacement).

## 4. Touch targets (FE-A11Y-001)

TODO: Minimum 44×44 px for primary actions on mobile.

```tsx
// Wrap small icon controls
<label className="flex items-center min-h-[44px] min-w-[44px]">
  <Checkbox />
</label>
```

## 5. Color and contrast

TODO: Minimum contrast ratios (4.5:1 normal text, 3:1 large). Color
never the only indicator (pair with icons / shapes / text).

## 6. Forms

- Every input has a label (visible or `aria-label`).
- Errors associated with their inputs via `aria-describedby`.
- Required fields announced.
- Inline validation announced to screen readers.

## 7. Images and media

- Every `<img>` has `alt` (`""` for decorative).
- Video has captions; audio has transcripts.
- Auto-playing media has a way to pause.

## 8. Dynamic content

TODO: `aria-live` regions for important updates. `role="status"` for
informational, `role="alert"` for urgent.

## 9. Motion

TODO: Respect `prefers-reduced-motion`. Don't animate critical UI.

## 10. Tooling

TODO: axe-core, jest-axe, Storybook addon, Lighthouse a11y score.
Where these run.

## 11. Manual review cadence

TODO: How often a human walks the app with a screen reader. Which
flows are required.

## Common anti-patterns

- `<div onClick>` instead of `<button>`
- `tabIndex={-1}` on interactive elements to hide them from keyboard
- Toast notifications that aren't announced
- Modal dialogs without focus trapping
