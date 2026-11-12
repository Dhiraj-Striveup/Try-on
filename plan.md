# VELL — implementation plan

## Product scope

Recreate the supplied “VELL — Create a Character” interactive styling hero as specified, using its exact asset URLs, title, fonts, 1600×900 stage, smoked-glass panels, outfit catalog, tuning views, history, controls, and transitions. Add a real-photo virtual try-on: the visitor can upload or capture their own image, choose any VELL look in the try-on flow, and request a generated edit that places the selected clothing on the person in that photograph. This must edit the photograph itself, not render a mask or CSS overlay. Show the source and result with progress, error, retry and comparison-slider states.

## Implementation approach

- Keep the primary client in self-contained `index.html` with inline CSS and JavaScript to preserve the brief's no-framework/no-build-step requirement.
- Use a small built-in-Node HTTP server on the initialized port (`3000`) to serve the app, `/manus-routes.json`, an unauthenticated health route, and same-origin `/api/try-on` endpoint.
- Forward accepted JPEG/PNG/WebP photo bytes plus a selected outfit reference and specific image-edit prompt to the platform Images API at runtime. Use the project-provided `MANUS_API_URL` / `MANUS_API_KEY` server-side only; discover the supported model enum through `ListModels`, validate uploads, do not persist a visitor's photo or generated result, and return retryable service errors to the UI.
- Reuse only the provided CloudFront/Higgs outfit and loft assets and the specified Google Fonts. Preserve the exact fixed stage coordinate system on desktop while fitting it to other viewport sizes.
- Use a root `manus-routes.json` because the built-in Node server serves it directly at the required site route. Use a root Dockerfile for the server-backed production container; do not add a bundler or frontend build step.

## Project structure

- `index.html` — studio visual system and all client interactions, catalog data, upload/camera capture, outfit selection, before/after comparison, status and retry UI.
- `server.js` — static file delivery, health and route-manifest response, safe upload validation, runtime model discovery and Images API request.
- `manus-routes.json` — the single page route `/` (API routes remain excluded from page manifest).
- `package.json` — built-in Node start script, no runtime packages.
- `Dockerfile` — production Node 22 container, copies committed app files, exposes 3000, honors `PORT` through server code, and starts `server.js`.
- `app.config.ts` — quoted platform `logoUrl` literal using the supplied VELL artwork.
- `plan.md` / `TODO.md` — approved design/serving approach and tracked outcomes.

## Design direction

Use the direction supplied by the user without reinterpretation: a photoreal Korean character in a cool-neutral, nearly empty city loft; dark smoked-glass panels; white fine-line controls; and luminous active states. Core principles are faithful recreation, restrained cinematic atmosphere, clear outfit selection, and image-edit feedback that makes the user's real photograph—not a cutout or mask—the subject. Use Figtree and Syne as specified. The glowing scan line and top-to-bottom wipe are the studio's signature transitions. Keep the photo try-on workflow visually consistent with the same frosted-glass language.

## Serving and integration constraints

The project server feature is enabled and the initialized preview port is 3000. Keep the API credential on the server; forward the browser photo as base64 in the documented `originalImages` field and use a public supplied outfit reference URL as the second image. Enforce practical file type/size bounds, do not store photos, and never present a CSS overlay as a generated result. Configure a container deployment declaration with an unauthenticated health path while leaving automatic publication disabled; saving a checkpoint and publishing remain distinct.
