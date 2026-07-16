# 桦 · UI Design System

This file is the implementation contract for every current and future interface in the project.

## Brand character

Restrained, natural, literary, and quiet. The visual reference is Japanese mingei combined with Chinese literati seal carving. Product hierarchy comes from spacing, type, material tone, and ink density—not from colorful accents.

## Fixed palette

| Token | Value | Use |
| --- | --- | --- |
| `--color-ink` | `#1E1A14` | Primary text, filled icons, primary actions |
| `--color-parchment` | `#E8E1D0` | Page background |
| `--color-card` | `#F5EFE0` | Panels and cards |
| `--color-card-hover` | `#FDFAF3` | Hovered surfaces and inputs |
| `--color-lenticel` | `#EBE2CC` | Inset details and secondary surfaces |
| `--color-gold-mute` | `#B8A98A` | Fine ornaments and quiet status cues |
| `--color-text-sub` | `#9A8468` | Secondary text |
| `--color-text-muted` | `#7A6A50` | Muted text |

No other color may be added. Status is communicated with label, position, ink density, and texture rather than hue.

## Type

- Chinese: Noto Serif SC, weights 300–500.
- English display and labels: Cormorant Garamond, weights 300–400.
- Chinese headings use `0.1em–0.15em` letter spacing.
- English labels are uppercase with `0.2em–0.5em` letter spacing.
- Body line height is 1.8 in Chinese and 1.6 in English.
- Monospace is reserved for source previews and uses muted text.

## Geometry and material

- Cards and panels: 16px radius.
- Buttons, tags, inputs, icon wells: 6px radius.
- Borders: `1px solid rgba(30,26,20,0.12)`.
- Static shadow: `0 2px 10px rgba(30,26,20,0.07)`.
- Hover shadow: `0 16px 48px rgba(30,26,20,0.16), 0 4px 16px rgba(30,26,20,0.08)`.
- Content width: 640px compact or 960px wide.
- Spacing between major modules is at least 24px.

## Icons

Only the filled birch SVG set under `frontend/public/icons/birch` is permitted. Shapes use ink fill and optional lenticel cutouts. SVG strokes, icon gradients, icon shadows, generic outline libraries, and unrelated illustrations are not permitted.

### Navigation semantics · Version 3

| Navigation | Birch form | Rationale |
| --- | --- | --- |
| Home | Tree · 树 | The whole tree is the origin and global point of view. |
| Career | Branch · 枝 | A career is a path branching from the main trunk. |
| Career Overview | Grove · 林 | A forest view communicates the whole career landscape. |
| Jobs | Leaf · 叶 | Every opportunity is an individual leaf. |
| Applications | Bud · 芽 | An application is new growth beginning to emerge. |
| Resume Studio | Bark · 皮 | A resume is the outer surface presented to the world. |
| Interview Prep | Bud · 芽 | Preparation holds the potential for the next stage of growth. |
| Career Profile | Growth Ring · 纹 | Rings record accumulated depth and history. |
| Projects | Grove · 林 | Multiple projects coexist like trees in a birch grove. |
| Tasks | Catkin · 絮 | Repeated catkin scales represent ordered, repeatable work. |
| Knowledge | Growth Ring · 纹 | Knowledge accumulates in layers over time. |
| Documents | Bark · 皮 | Birch bark is a natural writing material. |
| Automations | Catkin · 絮 | Repetition reflects scheduled and automated workflows. |
| Integrations | Root · 根 | Underground roots connect otherwise separate systems. |
| AI Copilot | Bud · 芽 | Intelligence is an emerging source of new growth. |
| Settings | Winter · 雪 | The reduced winter structure represents calibration and reset. |

## Motion

Interactive surfaces move upward 4–6px with a 280–340ms transition using `cubic-bezier(0.34, 1.56, 0.64, 1)`. Rotation, scaling, blur, and linear/ease-in-out primary motion are not permitted. Reduced-motion preferences remain supported.

## Automated guardrail

Run `npm run lint:ui` in `frontend/`. The check rejects unapproved colors, gradients, pure black/white utilities, outline icon libraries, disallowed radii, bold/sans typography, aggressive effects, and stroked birch SVGs.
