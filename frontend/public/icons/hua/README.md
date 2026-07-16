# 桦 / Hua icon system

An original 24px monoline icon family for Personal OS.

## Visual grammar

- The brand mark compresses `桦` into two readable parts: the `木` trunk on the left and an upward, crossing `华` structure on the right.
- Module icons do not repeat the full character. They inherit its vertical trunk, horizontal crossbar, 45-degree branches, and upward-right movement.
- Every icon uses a 24x24 viewBox, round line caps, round joins, and a default 1.8px stroke.
- Icons use `currentColor`, so they inherit text color in React and CSS.
- Avoid fills, mixed stroke widths, decorative leaves, and literal tree illustrations. The system should feel like software, not forestry.

## Recommended sizes

- Navigation: 20px
- Buttons: 16px
- Cards: 24px
- Brand mark: 32-48px

## Included icons

- `hua-mark.svg`
- `home.svg`
- `copilot.svg`
- `career.svg`
- `knowledge.svg`
- `automation.svg`
- `integrations.svg`
- `documents.svg`

## Usage

```tsx
<img src="/icons/hua/knowledge.svg" alt="" className="size-5" />
```

For themeable stroke color, inline the SVG or wrap it as a React component so `currentColor` can inherit from the parent.
