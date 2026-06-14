# Image-based colour palette extraction — pipeline plan

## Problem

Today's brand palette (`captured_emails.metadata.palette_colors`, aggregated in
`computeDesign()` in `lib/brand-db.ts`) is extracted **only from HTML/CSS colour
tokens** by `extractColorPalette()` in `lib/extract-metadata.ts`:

> "Image pixel data is intentionally not inspected — we only look at colour
> tokens declared in the markup itself."

Each colour is weighted by how many times it's **declared** in the markup, so the
result is dominated by text/background neutrals (`#383838`, `#fffefa`, `#333333`,
`#9b9b99`, `#000000`). The brand's real colours live in the **photography**
(sage, clay, forest), which the extractor never sees. The nice palettes we show
for hero examples are hand-tuned in `lib/marketing/hero-data.ts` — explicitly a
placeholder "until the vision-extracted pipeline lands."

## Do we need an LLM? No.

Dominant-colour extraction is deterministic pixel math — quantisation / clustering
over a downsampled image. It is:

- **Fast** — single-digit milliseconds per image with `sharp`.
- **Free** — no API calls, no per-image cost.
- **Reproducible** — same input → same output, easy to test and tune.

An LLM (vision) would be slower, costly, non-deterministic, and worse at precise
colour values. We already depend on `sharp` (`^0.34.5`) and use it in
`lib/image-analysis.ts`. The only optional add is a palette library
(`node-vibrant`) — and even that is just pixel maths under the hood.

## "Actual pixels" — two readings, and which to use

1. **Per content image (recommended).** Run colour extraction on the email's
   mirrored content images (the photography). Surfaces the brand's colours; needs
   saturation-aware weighting so white product backgrounds don't dominate.
2. **Full rendered screenshot.** We already render emails to `.webp` for hero
   examples (`scripts/screenshot-hero-emails.ts`). The composite is the most
   literal "what you see," but emails are mostly whitespace + text, so a raw
   screenshot palette skews neutral too — same failure mode as the HTML approach.

**Decision:** use approach (1) on the mirrored images, with saturation/area
weighting to lift chromatic brand colours above neutral fills. Optionally keep a
single dominant neutral from the layout for completeness.

## Where it plugs in

```
lib/ingest-processor.ts
  └─ runStage("mirror_assets")        → mirroredAssets (already downloaded)
  └─ runStage("extract_metadata")     → palette_colors (HTML, keep as-is)
  └─ runStage("extract_image_palette")  ← NEW: image_palette from mirroredAssets
        → store on metadata.image_palette
```

- New module `lib/extract-image-palette.ts`.
- Reuse `lib/image-analysis.ts` (`sharp`) to skip blank/logo/spacer images (it
  already detects these via channel statistics).
- Store results in a **new** `metadata.image_palette` field — don't overwrite
  `palette_colors`. Keep both; the HTML one is still useful as "interface colours".

## Algorithm (`extract-image-palette.ts`)

1. **Select candidate images** from `mirroredAssets`:
   - Skip images flagged blank/logo by `image-analysis.ts`.
   - Skip tiny images (spacers/icons, e.g. min(w,h) < 64px).
   - For GIFs, decode the first frame.
   - Rank remaining by rendered area; take the top ~5 (hero + key shots).
2. **Decode + downsample** each with `sharp`: `resize(64, 64, { fit: "inside" })`
   → `.raw().toBuffer()`. Skip fully-transparent pixels (use the alpha channel).
3. **Quantise** to buckets (e.g. 4–5 bits/channel) and count pixels per bucket —
   *or* use `node-vibrant` to get Vibrant/Muted/Dark swatches with population
   (it's purpose-built for "pull the brand-y colours out of an image").
4. **Filter + weight** (reuse thresholds from `lib/brand-accent.ts`):
   - Drop near-white (L > 0.92) and near-black (L < 0.06) — backgrounds/ink.
   - Weight each colour by `population × (0.3 + saturation)` so chromatic accents
     outrank large neutral fills without disappearing entirely.
   - Merge near-identical colours (ΔE in Lab, or simple RGB distance) so
     `#383838`/`#333333` collapse to one swatch.
5. **Per-image prominence weight:** hero/largest image counts more than thumbnails.
6. **Output** top ~6–8 `{ hex, weight }`, normalised.

## Brand-level aggregation

In `computeDesign()` (`lib/brand-db.ts`):

- If `metadata.image_palette` is present for a brand's emails, **prefer it**
  (sum weighted across the sample, merge near-identical, top 8).
- Fall back to the existing HTML `palette_colors` when no image palette exists.
- Optionally expose both: `design.palette` (brand colours, image-based) and
  `design.interfaceColours` (HTML-based) if we ever want to show "their UI greys".

No change needed to the public `/brand-insight` endpoint or the homepage figure —
they read `design.palette`, which simply gets better data.

## Backfill

The archive is small (~900 captured emails), so a one-off reprocess is cheap:

```
scripts/backfill-image-palette.ts
  for each captured_email (batched):
    load mirrored image refs (image_urls / storage paths)
    extractImagePalette(images)
    update metadata.image_palette  (idempotent; skip if already set unless --force)
```

Estimated runtime: a few minutes for ~900 emails (ms per image). New emails get
it automatically via the ingest stage.

## Edge cases

- **No content images** → fall back to HTML palette (current behaviour).
- **Genuinely neutral photography** (e.g. B&W editorial) → neutral palette, which
  is correct for that brand.
- **White-background product shots** → saturation weighting prevents white from
  winning; the product's accent colour surfaces.
- **Transparent PNG logos** → excluded by the blank/logo detector.
- **Animated GIFs** → first frame only.
- **Odd colour spaces (CMYK), broken images** → `sharp` normalises; wrap in
  try/catch and skip on error so one bad asset never fails ingestion.
- **Perf** → downsample before analysis; cap images per email; all in-process.

## Validation

- Backfill a handful of known brands (Ferm Living, HAY, ARKET) and compare to the
  hand-tuned `hero-data.ts` palettes; tune the saturation/lightness thresholds and
  the merge distance until they line up.
- Spot-check the homepage palette figure across several live brands.

## Library choice

- **`node-vibrant`** — built on quantisation; returns Vibrant/LightVibrant/
  DarkVibrant/Muted swatches with population. Purpose-built for surfacing brand
  colours and tends to "just work". New dependency, but small and deterministic.
- **`sharp` + median-cut/k-means (no new dep)** — more control, slightly more code.

Recommend starting with `node-vibrant` for speed of implementation; fall back to a
hand-rolled `sharp` quantiser if we want tighter control over weighting/merging.

## Effort estimate

| Task | Est. |
|---|---|
| `lib/extract-image-palette.ts` (extract + filter + merge) | ~0.5 day |
| Wire into `ingest-processor.ts` + `metadata.image_palette` | ~1 hr |
| `computeDesign()` prefer image palette | ~0.5 hr |
| `scripts/backfill-image-palette.ts` + run | ~1 hr |
| Tuning + validation against known brands | ~0.5 day |

**Total: ~1.5–2 days.** No schema migration (it's a JSONB field), no public API
change, no LLM, no new heavy infra.

## Out of scope / follow-ups

- Per-colour semantic labels ("terracotta", "sage") — would need a name-mapping
  table or an LLM; not required for the swatch figure.
- Colour trends over time (palette drift per brand) — possible later from the
  per-email `image_palette`.
