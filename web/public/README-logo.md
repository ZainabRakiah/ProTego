# Logo

ProTego ships with a built-in mark: a shield with a route cut out of it, ending
at a destination — a protected way home. It lives in two places that must stay
in sync:

- `src/components/ProTegoLogo.jsx` — what the app renders (React, theme-aware)
- `public/logo.svg` — the same artwork as a standalone file, for the
  apple-touch-icon, README, slides or anywhere outside the app

The browser-tab favicon is an inline copy in `web/index.html`.

## Replacing it with your own

Drop your logo here as **`logo.png`** (this exact filename, in this folder).

It is picked up automatically — no code change, no rebuild config. Until the
file exists, the app falls back to the built-in shield mark, so nothing ever
renders as a broken image.

- **Format**: PNG with a transparent background. If yours is an SVG, save it
  under a different name — `logo.svg` is taken by the built-in mark — and point
  at it with `VITE_LOGO_SRC` (below).
- **Size**: square, at least 128×128. It renders at 36px in the sidebar, so a
  square that reads well when small works best.
- **Both themes**: it sits on a dark background by default and a light one when
  dark mode is off, so avoid a hard white or hard black fill.

To use a different filename or path, create `web/.env`:

```
VITE_LOGO_SRC=/my-logo.svg
```

Replacing the mark everywhere (favicon and apple-touch-icon included) means
also updating `web/index.html` and `public/logo.svg`.

The browser tab icon is separate — it's the inline SVG in `web/index.html`.
