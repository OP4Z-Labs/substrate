---
scope: frontend
area: accessibility
last_updated: 2026-05-14
rules:
  - FE-A11Y-001
  - FE-A11Y-002
update_triggers:
  - WCAG version target changed
  - New a11y audit findings
  - Component library upgraded
---

# Accessibility

> **Substrate default standard.** WCAG 2.1 AA as the floor. Most of these
> rules are also legal requirements in the EU and US public sector.

## Scope

Every user-facing UI surface — web, hybrid mobile, embedded
widgets. Documentation sites, marketing pages, and internal admin UIs
all qualify.

## Rules

### 1. Real semantic HTML (FE-A11Y-001)

Use the element that means what you want:

| What                       | Element              |
| -------------------------- | -------------------- |
| Click target with action   | `<button>`           |
| Link to another page / URL | `<a href>`           |
| Text input                 | `<input>` + `<label>` |
| Group of inputs            | `<fieldset>` + `<legend>` |
| Section heading            | `<h1>` … `<h6>` (in order) |
| Navigation                 | `<nav>`              |
| Page main region           | `<main>`             |
| Page footer                | `<footer>`           |

`<div onClick>` is wrong — it's invisible to keyboard nav,
screen readers, and accessibility tooling. The substrate detector for
`FE-A11Y-001` flags it.

### 2. Touch targets at least 44 × 44 px (FE-A11Y-002)

WCAG 2.5.5: any touch target the user interacts with is at least
44px in both dimensions. That's the size where the average finger
can hit reliably.

Most "clickable" UI passes by default; the failure mode is icon-only
buttons that visually render at 24px. Wrap them:

```tsx
<button
  aria-label="Delete task"
  className="flex items-center justify-center min-h-[44px] min-w-[44px]"
>
  <TrashIcon className="h-4 w-4" />
</button>
```

### 3. Every interactive element has an accessible name

```tsx
// WRONG — icon button, no label
<button><TrashIcon /></button>

// RIGHT
<button aria-label="Delete task"><TrashIcon /></button>

// RIGHT — visible text counts as the name
<button>Delete <TrashIcon aria-hidden /></button>
```

`aria-hidden="true"` on decorative SVGs so the screen reader doesn't
double-announce.

### 4. Forms: every input has a label

```tsx
// PREFERRED — explicit association
<label htmlFor="email">Email</label>
<input id="email" type="email" />

// ALSO FINE — wrapping
<label>
  Email
  <input type="email" />
</label>
```

Placeholder text is NOT a label — it disappears the moment the user
types.

For required, invalid, and disabled states, add the corresponding
`aria-required` / `aria-invalid` / `disabled` attributes.

### 5. Headings: one `<h1>` per page, ordered cascade

```html
<h1>Tasks</h1>
  <h2>Filters</h2>
  <h2>Task list</h2>
    <h3>Today</h3>
    <h3>This week</h3>
```

Don't skip levels (`<h2>` → `<h4>`). The heading tree is a navigation
aid for screen reader users.

### 6. Color is not the only signal

Status communicated via:

```tsx
// WRONG — red dot only
<span className="bg-red-500 rounded-full" />

// RIGHT — color + icon + accessible text
<span className="flex items-center gap-1 text-red-700">
  <ExclamationIcon aria-hidden /> <span>Error</span>
</span>
```

Colorblind users (~ 8 % of men) can't rely on hue alone. Pair
color with an icon, text, or shape.

### 7. Contrast: 4.5:1 for body, 3:1 for large text and UI

Verified by a contrast checker (Lighthouse, axe, Stark). Failing
contrast is the most common a11y audit finding.

UI components (buttons, form borders, focus rings) also need 3:1
contrast against their adjacent background.

### 8. Keyboard navigation: every interactive element reachable

```
Tab          → next interactive element
Shift+Tab    → previous
Enter        → activate buttons / submit forms
Space        → activate buttons / toggle checkboxes
Escape       → close modals / dismiss
Arrows       → navigate within composite widgets (menus, lists)
```

Tab order matches visual order. Skip-to-main-content link at the top
of every page for keyboard users.

NEVER use `tabIndex={-1}` to hide an element from keyboard. That's
exactly the opposite of accessibility.

### 9. Focus is always visible

Don't remove the focus ring without replacing it. The default UA
ring is ugly; OK to restyle:

```css
:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
```

`:focus-visible` shows the ring only on keyboard focus, not mouse —
the trick that lets you keep clean mouse-clicks without losing
keyboard a11y.

### 10. Modals and overlays trap focus correctly

When a modal opens:
- Focus moves into the modal.
- Tab cycles within the modal only.
- Escape closes the modal.
- Focus returns to the trigger element on close.

Most component libraries (Radix, headless UI, ARIA Authoring Practices)
ship this for free. Don't roll your own.

### 11. Live regions for async updates

```tsx
<div aria-live="polite" aria-atomic="true">
  {status}
</div>
```

`polite` — screen reader announces when idle.
`assertive` — interrupts the current announcement (use sparingly).

Toast notifications, validation errors that appear async, and
progress updates all need live regions.

### 12. Images: meaningful alt text

```tsx
// Decorative — empty alt
<img src="/decoration.svg" alt="" />

// Informational — describe the content
<img src="/chart.png" alt="Quarterly revenue: $4M Q1, $5.2M Q2, ..." />

// Functional (image as button) — describe the action
<button><img src="/save.svg" alt="Save" /></button>
```

"Image of X" or "Photo of Y" is wordy; just describe what's there
or its function.

## Examples

### Do — accessible icon button

```tsx
<Tooltip content="Delete task">
  <button
    type="button"
    aria-label="Delete task"
    className="flex items-center justify-center h-11 w-11 hover:bg-red-50"
    onClick={() => onDelete(task.id)}
  >
    <TrashIcon aria-hidden className="h-4 w-4" />
  </button>
</Tooltip>
```

### Don't — div + icon, no label

```tsx
<div onClick={() => onDelete(task.id)} className="text-red-500">
  <TrashIcon />
</div>
```

Not reachable by keyboard, no name, no role.

### Do — labeled form input

```tsx
<div>
  <label htmlFor="title" className="block">Task title</label>
  <input
    id="title"
    name="title"
    type="text"
    required
    aria-required="true"
    aria-invalid={!!errors.title}
    aria-describedby={errors.title ? "title-error" : undefined}
  />
  {errors.title && (
    <span id="title-error" className="text-red-600" role="alert">
      {errors.title.message}
    </span>
  )}
</div>
```

### Don't — placeholder as label

```tsx
<input type="text" placeholder="Task title" />
```

When the user starts typing, they can't see what the field was for.

## Rationale

Accessibility isn't a feature — it's the cost of being a UI at all.
~15 % of the population has some form of disability that affects how
they use software. The conventions above don't compromise the
visual design; they just remove the artificial barriers.

It's also the law in most jurisdictions for public-facing software
(ADA, EU Web Accessibility Directive, ACT). A lawsuit over an
inaccessible button costs more than implementing the button correctly.

## See also

- `react.md` — component patterns.
- `performance.md` — fast TTI matters for assistive tech too.
- `testing.md` — automated a11y testing.
- WCAG 2.1 AA: https://www.w3.org/WAI/WCAG21/quickref/
