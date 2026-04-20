# Slipumbrella UI Design Guideline
## Glassmorphism — When, How, and When Not To

---

## The Spotlight Rule

> **One glass element per section. Everything else is white or gray-50 with a clean border.**

Glassmorphism is not a card style. It is a spotlight. When used sparingly it says "this is the most important interactive surface on the page." When used on every card, it says nothing.

---

## The Three Glass Utilities

Defined in `app/globals.css`:

| Utility | Use case | Backdrop blur | Background opacity |
|---|---|---|---|
| `glass` | Secondary interactive surfaces (e.g. floating toolbar) | 16px | ~65% white |
| `glass-strong` | Primary hero widget, drawer panels | 24px | ~80% white |
| `glass-subtle` | Overlay hints, tooltip backdrops | 12px | ~30% white |

### CSS Variables (light mode)

```css
--glass-bg:        rgba(255, 255, 255, 0.65);   /* glass */
--glass-bg-strong: rgba(255, 255, 255, 0.80);   /* glass-strong */
--glass-bg-subtle: rgba(255, 255, 255, 0.30);   /* glass-subtle */
--glass-border:    rgba(255, 255, 255, 0.35);
--glass-shadow:    0 8px 32px rgba(100, 60, 180, 0.10);
--glass-shadow-lg: 0 12px 48px rgba(100, 60, 180, 0.18);
```

---

## When TO Use Glass

### ✅ Hero widget
The one widget that demonstrates the product's primary action.

```tsx
<div className="glass-strong rounded-[2rem] border-white/60 p-6">
  {/* primary interactive content */}
</div>
```

### ✅ Floating UI panels
Agent builder side panels, floating toolbars, command palettes — surfaces that sit above a rich visual background.

```tsx
<div className="dark-glass rounded-2xl p-4">
  {/* panel content */}
</div>
```

### ✅ Navbar on scroll
When the navbar gains a backdrop as the user scrolls past the hero.

```tsx
<nav className="glass border-b border-white/30">
```

---

## When NOT To Use Glass

### ❌ Feature cards
Use `bg-white border border-gray-200 rounded-2xl` instead. Glass on a white-background section is invisible.

### ❌ "How it works" step cards
These are informational containers, not interactive surfaces. Plain white or `bg-gray-50`.

### ❌ Orchestration / capability cards
Multiple cards with the same glass treatment cancel each other out. Use white cards with a colored left-border accent or a bordered icon instead.

### ❌ Form inputs
Inputs use `bg-white border border-gray-300` per browser convention. Glass inputs break accessibility expectations.

---

## Contrast Requirements (WCAG AA)

All text inside glass surfaces must pass 4.5:1 contrast against the **blurred composite background**, not against pure white.

| Text color | On glass-strong (≈ white 80%) | On glass (≈ white 65%) | Pass? |
|---|---|---|---|
| `text-gray-950` (`oklch(0.145 0 0)`) | ~18:1 | ~17:1 | ✅ |
| `text-gray-700` (`oklch(0.37 0 0)`) | ~8:1 | ~7.5:1 | ✅ |
| `text-gray-500` (`oklch(0.556 0 0)`) | ~4.6:1 | ~4.3:1 | ✅ / ⚠️ |
| `text-purple-600` (`oklch(0.55 0.18 290)`) | ~5.1:1 | ~4.8:1 | ✅ |
| `text-purple-500` | ~3.5:1 | ~3.2:1 | ❌ — use purple-600+ |

**Rule:** Never use `text-gray-400` or lighter as body text on any glass surface.

---

## Background Requirements for Glass to Work

Glass requires a **visually distinct background** beneath it — a mesh gradient, a colored section, or a sufficiently dark image. On a white page background, glass is invisible.

```tsx
// ✅ Works — glass on mesh gradient
<section className="mesh-rays">
  <div className="glass-strong ...">...</div>
</section>

// ❌ Invisible — glass on white
<section className="bg-white">
  <div className="glass-strong ...">...</div>  {/* looks like white card */}
</section>
```

The hero section uses `mesh-rays` (defined in `globals.css`) as the section background. This is why the hero widget glass reads correctly.

---

## Animation Rules for Glass

```tsx
// ✅ Entry animation on mount — transform + opacity only
<motion.div
  initial={{ opacity: 0, y: 16 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
  className="glass-strong ..."
>

// ❌ Never animate backdrop-filter — GPU-expensive, causes repaints
// ❌ Never animate width/height on glass panels — use transform: scaleX/scaleY
// ❌ No perpetual floating/pulse animations on background orb blobs
```

---

## Dos and Don'ts Summary

| DO | DON'T |
|---|---|
| Use `glass-strong` on one hero widget per page | Apply glass to every card in a section |
| Ensure a non-white background behind all glass | Place glass on `bg-white` sections |
| Use `text-gray-700` or darker inside glass | Use `text-gray-400` in glass containers |
| Use `rounded-[2rem]` for primary glass panels | Stack glass inside glass (nested blur) |
| Animate entry with `opacity` + `transform` | Animate `backdrop-filter` or `width/height` |
| Reserve glass for interactive surfaces | Use glass purely for decoration |

---

## Token Reference

All glass tokens live in `:root` and `.dark` in `app/globals.css`. Do not hardcode `rgba()` glass values in components — reference the utility classes or CSS variables only.

```css
/* Reference like this */
background: var(--glass-bg);

/* Not like this */
background: rgba(255, 255, 255, 0.65); /* ❌ hardcoded */
```
