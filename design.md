# Design System — Course Enrollment Kiosk

Visual direction derived from the **Tabby Business** UI. Built with **HeroUI v3** + **Tailwind CSS v4**.

---

## 1. Design direction

Tabby's interface is confident and quiet. It earns clarity through **scale and space**, not through
borders, gradients or shadows. Five traits define the look, and every screen in this kiosk should
be checkable against them:

| Trait | What it means here |
| --- | --- |
| **One thing per screen** | A single centred card owns the viewport. No sidebars, no competing panels. |
| **Oversized display type** | Headings are dramatically larger than body text (44px vs 18px). The size gap *is* the hierarchy. |
| **Borderless surfaces** | Inputs and buttons are defined by a filled background, never a 1px outline. |
| **Soft, generous radii** | 24px on cards, 14–16px on controls. Nothing is sharp; nothing is a full pill except chips. |
| **Restrained colour** | The palette is greys and one dark slate. Colour appears only for brand, price and status. |

The kiosk adds one constraint Tabby does not have: **it is touched, not clicked.** Every interactive
target grows accordingly (§6).

---

## 2. Colour

### 2.1 Light theme (default)

| Token | Hex | Role |
| --- | --- | --- |
| `--color-canvas` | `#F2F4F7` | Page background — the cool grey behind everything |
| `--color-shell` | `#373E4B` | Dark strip above the header; kiosk chrome |
| `--color-surface` | `#FFFFFF` | Cards, header bar, modals |
| `--color-surface-sunken` | `#EDF0F4` | Input fills, table header rows, skeletons |
| `--color-surface-accent` | `#E7EEF9` | Secondary button fill, info callouts |
| `--color-text` | `#191C22` | Headings and primary body |
| `--color-text-muted` | `#6B7280` | Supporting copy, labels, placeholders |
| `--color-text-subtle` | `#98A1B0` | Metadata, timestamps, disabled text |
| `--color-primary` | `#101418` | Primary button, active states — near-black |
| `--color-primary-hover` | `#000000` | Primary pressed |
| `--color-brand` | `#14306B` | Delta dark blue. Success mark, discount badge, selection |
| `--color-brand-ink` | `#FFFFFF` | Text placed **on** the brand blue |
| `--color-border` | `#E3E7ED` | Hairlines only — dividers, table rules |

Primary actions are **near-black, not the reference's slate** — on the grey canvas black gives
the strongest contrast and leaves the dark blue free to mean *brand* rather than *action*.

### 2.2 Status

| Token | Hex | Used for |
| --- | --- | --- |
| `--color-success` / `-bg` | `#0E9F6E` / `#E4F7EF` | Payment succeeded, enrollment confirmed, course active |
| `--color-danger` / `-bg` | `#DC2626` / `#FDECEC` | Payment failed, validation errors, delete |
| `--color-warning` / `-bg` | `#D97706` / `#FEF4E6` | Pending payment, low seats |
| `--color-info` / `-bg` | `#2563EB` / `#E7EEF9` | Online mode badge, neutral notices |

### 2.3 Dark theme

Dark mode is required for the admin panel and for kiosks in low-light lobbies.
Invert the *surfaces*, keep the *hues*.

| Token | Hex |
| --- | --- |
| `--color-canvas` | `#111419` |
| `--color-surface` | `#1A1E26` |
| `--color-surface-sunken` | `#232833` |
| `--color-surface-accent` | `#252E3D` |
| `--color-text` | `#F3F5F8` |
| `--color-text-muted` | `#9BA5B4` |
| `--color-primary` | `#E7EAEF` (light slate — inverts to a light button with dark text) |
| `--color-border` | `#2C323D` |

Brand mint and status hues stay the same; only their `-bg` tints darken to ~12% opacity of the hue.

### 2.4 Rules

- Status colours are for status only — never decorate a category chip with `--color-success`.
- Two greys maximum in any one component. If you need a third, you need less nesting.

### 2.5 Logo

`frontend/public/logo.png` is a **white** wordmark with teal accents, drawn for a dark
background. It is invisible on our white header, so the `.brand-logo` class recolours it rather
than shipping a second asset:

```css
.brand-logo      { filter: brightness(0); }            /* flatten to solid black */
.dark .brand-logo{ filter: brightness(0) invert(1); }  /* back to white */
```

`brightness(0)` drives every opaque pixel to black regardless of its original hue, which is why
it works on a multi-colour mark where `invert()` alone would turn teal into magenta. An academy
that supplies its own `logoUrl` through the admin config gets it rendered unfiltered.

---

## 3. Typography

### 3.1 Families

```
--font-sans   : "DM Sans", system-ui, sans-serif                /* the whole product */
--font-arabic : "IBM Plex Sans Arabic", "Almarai", sans-serif   /* ar locale */
```

**DM Sans is the single typeface**, loaded as a variable font via `next/font/google` so every
weight from 400–700 is available at no extra request. It is a low-contrast geometric sans with a
large x-height — it holds up at 18px on a glare-heavy kiosk screen, and its tight geometric
rhythm is what makes the Tabby reference read as confident rather than shouty.

DM Sans has no Arabic coverage, so the `ar` locale swaps to IBM Plex Sans Arabic, which is
metrically close enough to reuse the same scale.

### 3.2 Weights

**SemiBold (600) is the workhorse.** It carries every heading, button, label and emphasis in the
product. Reach past it only when a screen genuinely has one hero element.

| Weight | Name | Used for |
| --- | --- | --- |
| 400 | Regular | Body copy, descriptions, table cells |
| 500 | Medium | Metadata, captions, muted secondary text |
| **600** | **SemiBold** | **Headings, buttons, labels, chips, prices, inline emphasis** |
| 700 | Bold | Reserved: the enrollment ID and the payment total, nothing else |

### 3.3 Scale

| Token | Size / line-height | Weight | Tracking | Use |
| --- | --- | --- | --- | --- |
| `display` | 44 / 48 | 600 | `-0.02em` | Screen headline ("Enter your details") |
| `title` | 32 / 38 | 600 | `-0.02em` | Modal heading, course name in details |
| `heading` | 24 / 30 | 600 | `-0.01em` | Section heading, card title in listing |
| `subheading` | 20 / 28 | 600 | `-0.01em` | Course card name, table caption |
| `body-lg` | 18 / 28 | 400 | `0` | Primary body — the kiosk default |
| `body` | 16 / 24 | 400 | `0` | Dense areas, admin tables |
| `label` | 15 / 20 | 600 | `0` | Field labels, chips |
| `caption` | 13 / 18 | 500 | `0.01em` | Metadata, legal footer |

**The 44 → 18 jump is the signature.** Do not soften it by introducing a 28px step between them.
Because weight stays flat at 600 across every heading tier, **size alone carries the hierarchy** —
which is exactly why the scale steps are large.

### 3.4 Emphasis

SemiBold (600) inline marks the one value that matters in a sentence — the masked phone number,
the total amount. Bold (700) is reserved for the enrollment ID and the payment total. Never use
colour for inline emphasis.

---

## 4. Space, radius, elevation

### 4.1 Spacing scale (4px base)

`4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64 · 80`

| Context | Value |
| --- | --- |
| Card inner padding (kiosk) | `48px` |
| Card inner padding (admin / mobile) | `24px` |
| Gap between stacked form controls | `16px` |
| Gap between heading block and first control | `32px` |
| Gap between primary and secondary button | `12px` |
| Course grid gutter | `24px` |

### 4.2 Radius

| Token | Value | Applied to |
| --- | --- | --- |
| `--radius-card` | `24px` | Cards, modals, the header bar's bottom corners |
| `--radius-control` | `16px` | Buttons, inputs, selects, textareas |
| `--radius-chip` | `999px` | Chips, badges, language toggle |
| `--radius-image` | `16px` | Course thumbnails |

### 4.3 Elevation

Tabby is almost flat. Three levels only:

```
--shadow-none  : none                                    /* default for cards on canvas */
--shadow-card  : 0 1px 2px rgb(16 24 40 / 0.04),
                 0 8px 24px rgb(16 24 40 / 0.06)         /* hover / raised course card */
--shadow-modal : 0 24px 64px rgb(16 24 40 / 0.18)        /* modal + drawer only */
```

A card sitting on `--color-canvas` needs **no shadow** — the surface contrast is the separation.

---

## 5. Layout

### 5.1 Shell

```
┌──────────────────────────────────────────────┐  ← --color-shell, 8px
│ ╭──────────────────────────────────────────╮ │
│ │  [tabby] Business            [ العربية ] │ │  ← white header, 88px tall,
│ ╰──────────────────────────────────────────╯ │     bottom corners 24px
│                                              │
│              ╭────────────────╮              │  ← --color-canvas
│              │   page card    │              │     card max-width 592px
│              ╰────────────────╯              │     centred, 48px padding
└──────────────────────────────────────────────┘
```

- Header is `--color-surface`, full-bleed, with **only its bottom corners** rounded (24px).
- A thin `--color-shell` band sits above it, so the header reads as a card tucked under the bezel.
- Header left: logo chip (mint, radius 10px, dark text) + wordmark at `heading`.
- Header right: language toggle — `--color-surface-accent` fill, `--radius-chip`, 48px tall.

### 5.2 Content widths

| Screen | Max width |
| --- | --- |
| Focused flow (enroll, payment, confirmation) | `592px` centred |
| Course listing | `1280px`, grid |
| Course details modal | `860px` |
| Admin | `1440px` |

### 5.3 Course grid

| Viewport | Columns |
| --- | --- |
| ≥ 1536px | 4 |
| 1280–1535px | 3 |
| 768–1279px | 2 |
| < 768px | 1 |

Filters sit in a **sticky bar** below the header, not a sidebar — kiosks are landscape and a
sidebar steals the thumb zone.

---

## 6. Kiosk ergonomics

These override anything above when the two conflict.

| Rule | Value |
| --- | --- |
| Minimum touch target | **64 × 64px** (WCAG asks 44; fingers on a tablet want more) |
| Primary button height | **68px** |
| Input height | **64px** |
| Minimum gap between adjacent targets | **12px** |
| Body text floor | **18px** — never ship 14px to a kiosk |
| Primary action position | Bottom of card, full width, always reachable |

Additional rules:

- **No hover-only affordances.** Every state must be reachable by touch.
- **No native `select`.** Use HeroUI `Select` with a large touch popover.
- **Numeric keypad** for the mobile field: `inputMode="tel"`.
- **Destructive actions need a second tap** (`AlertDialog`), never a single-tap delete.
- Focus ring: `3px` `--color-primary` at 40% opacity, offset `2px` — visible for tethered keyboards.

---

## 7. Components

### 7.1 Button

| Variant | Fill | Text | Height | Use |
| --- | --- | --- | --- | --- |
| **Primary** | `--color-primary` | white, 700 | 68px | Continue, Pay, Enroll Now |
| **Secondary** | `--color-surface-accent` | `--color-text`, 700 | 68px | Resend, Back, Cancel |
| **Ghost** | transparent | `--color-text-muted`, 600 | 56px | Tertiary links, Close |
| **Danger** | `--color-danger` | white, 700 | 56px | Delete (admin only) |

Full-width in the focused flow; auto-width in admin. Radius `--radius-control`. **No border, no
gradient, no shadow.** Pressed state darkens the fill by ~8%; disabled drops opacity to 40%.

> HeroUI v3 buttons use `onPress`, not `onClick`, and `isDisabled`, not `disabled`.

### 7.2 Input / TextField

- Fill `--color-surface-sunken`, **no border**, radius `--radius-control`, height 64px.
- Padding `0 20px`; text `body-lg`; placeholder `--color-text-subtle`.
- Focus: fill lightens to `#FFFFFF` **plus** a 2px inset ring of `--color-primary`.
- Error: fill `--color-danger-bg`, 2px inset ring `--color-danger`, message below at `caption`
  in `--color-danger`.
- Label sits **above** the field at `label` weight 600 — never a floating/placeholder label
  (they fail at 18px on glare-heavy kiosk screens).

### 7.3 Card (course)

```
╭─────────────────────────────╮
│  ▢ image  16:9, radius 16   │
│                             │
│  Chip Online   Chip Beginner│  ← 12px gap
│  Course name        (subhd) │
│  Short description   (body) │  ← clamp 2 lines, --color-text-muted
│  ─────────────────────────  │  ← --color-border hairline
│  8 weeks            ₹12,000 │  ← muted left, price 700 --color-text
╰─────────────────────────────╯
```

Padding 20px, radius `--radius-card`, `--shadow-none` at rest → `--shadow-card` + `translateY(-2px)`
on hover/press, 160ms ease-out. **The whole card is the target**, not a button inside it.

HeroUI v3 anatomy — note it is `Card.Content`, **not** `CardBody`:

```tsx
<Card>
  <Card.Header>
    <Card.Title>…</Card.Title>
    <Card.Description>…</Card.Description>
  </Card.Header>
  <Card.Content>…</Card.Content>
  <Card.Footer>…</Card.Footer>
</Card>
```

### 7.4 Chip

Height 32px, radius `--radius-chip`, padding `0 14px`, `label` type at weight 600.

| Meaning | Fill / text |
| --- | --- |
| Category | `--color-surface-sunken` / `--color-text-muted` |
| Online | `--color-info-bg` / `--color-info` |
| Offline | `--color-surface-accent` / `--color-primary` |
| Level | `--color-surface-sunken` / `--color-text-muted` |
| Certificate | `--color-success-bg` / `--color-success` |

### 7.5 Modal

- Backdrop `rgb(16 24 40 / 0.48)`, no blur.
- Panel `--color-surface`, radius `--radius-card`, `--shadow-modal`, max-width per §5.2.
- Padding 40px; close button top-**end** (flips in RTL), 48px ghost target.
- Enter: fade + `scale(0.97 → 1)` over 200ms ease-out. Exit 150ms.
- Body scrolls internally; header and footer stay pinned.

### 7.6 Table (admin)

Header row `--color-surface-sunken`, `label` type, `--color-text-muted`, uppercase off.
Rows 64px tall, separated by `--color-border` hairlines, no vertical rules, no zebra striping.
Numeric columns right-aligned and tabular (`font-variant-numeric: tabular-nums`).

### 7.7 Status badge

Radius `--radius-chip`, height 28px, `caption` weight 600, `-bg` fill with solid hue text.
`success` = paid/confirmed · `warning` = pending · `danger` = failed · `info` = refunded.

---

## 8. Motion

| Interaction | Duration | Easing |
| --- | --- | --- |
| Button / chip press | 120ms | `ease-out` |
| Card hover lift | 160ms | `ease-out` |
| Modal enter / exit | 200 / 150ms | `cubic-bezier(.16,1,.3,1)` |
| Filter re-flow | 200ms | `ease-in-out` |
| Payment processing spinner | continuous | linear |
| Confirmation reveal | 320ms | spring-ish overshoot |

Respect `prefers-reduced-motion: reduce` — drop to opacity-only fades. Nothing animates longer
than 320ms; a kiosk queue has no patience.

---

## 9. RTL & Arabic

Locale switching is a first-class control in the header (per the Tabby reference).

- Set `dir="rtl"` on `<html>` and swap `--font-body`/`--font-display` to `--font-arabic`.
- Use **logical properties everywhere**: `ps-*`/`pe-*`, `ms-*`/`me-*`, `text-start`/`text-end`.
  Never `pl-*`/`ml-*`/`text-left`.
- Mirror directional icons — back arrows, chevrons, progress steppers. Do **not** mirror the logo,
  course images, or the play icon.
- Arabic runs ~15% taller at the same size; give headings `line-height: 1.35` minimum in `ar`.
- Keep Latin numerals for prices and enrollment IDs (`٠١٢` on a receipt causes support calls).

HeroUI v3 exposes `I18nProvider` and `isRTL` from `@heroui/react` — drive both from the same
locale value used for the dictionary.

---

## 10. Screen specs

### 10.1 Course listing
Sticky filter bar under the header: `SearchField` (flex-1) + Category, Mode, Level, Duration
selects + Sort. Active filters render as removable chips below the bar. Result count at `caption`.
Grid per §5.3. Empty state: centred, 20px muted copy + "Clear filters" secondary button.

### 10.2 Course details modal
860px. Hero image 16:9 top, radius 16px. Title at `title`. Chip row. Two-column body ≥768px:
left = full description + learning outcomes (check-marked list); right = a sunken summary panel
with duration, mode, instructor, batch schedule, certificate, price. Footer pinned:
**Enroll Now** primary + **Close** ghost.

### 10.3 Enrollment modal
592px. Heading `display`: "Enter your details". Two fields only — Full Name, Mobile Number.
Inline validation on blur, not on every keystroke. **Continue** primary + **Cancel** secondary.
A compact course summary strip sits above the fields so the student can confirm what they picked.

### 10.4 Payment
592px. Order summary card (`--color-surface-sunken`): course, name, mobile, **total** at `title`.
Method chooser as three large `ToggleButton`-style tiles (UPI / Card / Net Banking), 88px tall,
selected = 2px `--color-primary` ring + `--color-surface-accent` fill. Method-specific fields
below. **Pay ₹X** primary. Processing = full-card spinner with a "Do not close this window" line.
Failure = `--color-danger-bg` alert + **Retry** primary + **Change method** secondary.

### 10.5 Confirmation
592px. Mint success mark (72px circle, `--color-brand`, dark check) → heading "Enrollment
Successful" → a definition list of Enrollment ID, Course, Student, Mobile, Payment Status,
Reference, Date & Time. Enrollment ID is the hero: `title` size, tabular, selectable.
Actions: **Download Receipt** primary, **Print** secondary, **Enroll in Another Course** ghost.
A slim countdown bar shows the auto-return timer; touching anywhere cancels it.

### 10.6 Admin
Same tokens, denser: 24px padding, 16px body, 56px controls. Dashboard = five stat tiles
(label `caption` muted above, value `title`) then charts. Left nav rail 240px, `--color-surface`.

---

## 11. Implementation

`frontend/app/globals.css` — Tailwind v4 with HeroUI v3. **Import order matters.**

```css
@import "tailwindcss";
@import "@heroui/styles";

@theme {
  /* --font-dm-sans is set by next/font/google in app/layout.tsx */
  --font-sans: var(--font-dm-sans), system-ui, sans-serif;
  --font-arabic: "IBM Plex Sans Arabic", "Almarai", sans-serif;

  --color-canvas: #f2f4f7;
  --color-shell: #373e4b;
  --color-surface: #ffffff;
  --color-surface-sunken: #edf0f4;
  --color-surface-accent: #e7eef9;
  --color-text: #191c22;
  --color-text-muted: #6b7280;
  --color-text-subtle: #98a1b0;
  --color-primary: #3f4857;
  --color-primary-hover: #2e3542;
  --color-brand: #3ee9be;
  --color-brand-ink: #0b3b31;
  --color-border: #e3e7ed;

  --radius-card: 24px;
  --radius-control: 16px;
}
```

Tokens are then available as Tailwind utilities: `bg-canvas`, `text-muted`, `rounded-card`,
`font-sans`. **Never hard-code a hex value in a component** — if a colour is missing, add a
token here first.

DM Sans is loaded once in `app/layout.tsx` and exposed to the `@theme` block as a CSS variable:

```tsx
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});
```

Apply `dmSans.variable` to `<html>`, and `font-sans` on `<body>`.

---

## 12. Checklist

Before any screen is called done:

- [ ] Every touch target ≥ 64px, with ≥ 12px between neighbours
- [ ] No text below 18px in the kiosk flow
- [ ] No `pl-*` / `text-left` — logical properties only
- [ ] Renders correctly at `dir="rtl"` with Arabic copy
- [ ] Works in light **and** dark theme
- [ ] Primary action is full-width at the bottom of the card
- [ ] No hover-only information
- [ ] Zero hard-coded hex values
- [ ] `prefers-reduced-motion` honoured
- [ ] Passes 4.5:1 contrast (muted text on sunken fills is the usual offender)
