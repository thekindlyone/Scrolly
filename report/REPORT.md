# Adaptive auto-scroller: test and tuning report (v3.1 → v3.2)

## Test conditions

**What's real:**
- The userscript, injected after `load` the way Tampermonkey's document-idle does it.
- The page images from the real Weeb Central CDN (`official.lowee.us`), served cross-origin with no CORS headers. That forces the `GM_xmlhttpRequest` re-download path.
- Phone emulation: 412×780 viewport, DPR 2.625, touch, and an Android Firefox UA string.
- 4× CPU throttling and 120 ms per-request latency.

**What isn't:**
- **weebcentral.com itself.** Cloudflare blocks this environment: a 403 "Sorry, you have been blocked" page for both curl and a headless browser. I didn't try to get around it. The harness serves a stand-in long-strip page with the same `<img alt="Page N" class="max-w-full h-auto mx-auto">` markup (see `harness/README.md`).
- **Firefox.** Only Playwright's Chromium is installed in this environment.

**Chapters tested:**
- The Extra's Academy Survival Guide ep. 3: 148 pages, 800 px wide.
- Solo Leveling: Ragnarok ch. 1 (163 pages) and ch. 10 (114 pages): a different studio, 940 px wide, taller pages.

## Before/after: real-time runs (4 min each, 4× CPU throttle)

Column meanings:
- *empty* / *dense*: share of time on screens with information < 0.12 / > 0.55.
- *text>150%*: share of on-screen lettering that passed faster than 1.5× base speed.

All runs are scored with the same yardstick.

| run | A | speed | px/s | empty | dense | text>150% | pace p5/50/95 | step p95/max per 250 ms | unknown>0 | failed |
|---|---|---|---|---|---|---|---|---|---|---|
| Extra's, baseline | off | 2 | 120 | 9.0% | 12.5% | 0 | 100 | 0 | 0 | 0 |
| Extra's, **v3.1** | A2 | 2 | 105 | 3.9% | 24.5% | **2.8%** | 45/73/172 | 16/104 | 0.1% | 0 |
| Extra's, **v3.2** | A2 | 2 | 103 | 5.9% | 22.1% | **0.5%** | 49/82/135 | 13/76 | 0.1% | 0 |
| Extra's, v3.2 | A3 | 2 | 97 | 5.7% | 22.5% | 0.9% | 38/76/146 | 17/74 | 0.1% | 0 |
| Extra's, v3.2 | A2 | 4 | 209 | 4.8% | 17.8% | 0.8% | 49/89/133 | 17/56 | 0.1% | 0 |
| Solo Lv R., baseline | off | 2 | 120 | 7.7% | 5.9% | 0 | 100 | 0 | 0 | 0 |
| Solo Lv R., v3.2 | A2 | 2 | 115 | 3.6% | 10.5% | 1.3% | 56/98/146 | 15/95 | 0 | 0 |
| Solo Lv R., v3.2 | A3 | 3 | 180 | 5.9% | 8.9% | 3.3% | 48/99/188 | 26/124 | 0 | 0 |

The full table is in `report-table.txt`.

### Whole-chapter simulation (same logic, offline profiles, A2 at speed 2)

| chapter | baseline min | v3.1 min | v3.2 min | text>150% v3.1 → v3.2 |
|---|---|---|---|---|
| Extra's ep. 3 | 13.5 | 12.9 | 14.8 | 5.2% → 0.6% |
| Solo Lv R. ch. 1 | 17.7 | 15.0 | 17.4 | 7.4% → 1.1% |
| Solo Lv R. ch. 10 | 12.3 | 9.8 | 11.7 | 9.6% → 1.2% |

## Screenshots

- **v3.1 fast (258%)** – `v31-fast-rushed-text.jpg`: a "Dean's Office" sign and a "…I…" caption being rushed past. This is the main defect.
- **v3.2 fast (200–260%)** – `v32-fast-gutter.jpg`: blank gutters between panels, sky, flat gradients and title cards. Content is usually just entering at the bottom, with braking already started. A one-word "RIGHT." bubble passed at about 184%, which the design allows for very short lines.
- **Slow (≤ 55%), both versions** – `v32-slow-dialogue.jpg`: large speech bubbles over detailed art. Correct.

## Text detector (visual check with the debug overlay)

The detector does fire on speech-bubble lettering, captions and boxed narration in both art styles (`overlay-v31-page030.jpg`).

In v3.1 it also fired along vertical lines:
- panel borders
- the vertical sides of bubbles
- hair outlines

Text-like cells count 3× (art plus `TEXT_WEIGHT`), so two panel borders added about 0.15 per row to an otherwise empty panel. That's half the reference value.

## Changes in v3.2

1. **Text needs a horizontal neighbour** (left or right) instead of any neighbour. Lettering runs horizontally; borders and outlines run vertically. Borders now score as ordinary busy cells (`overlay-v32-slr-page060.jpg`). Text cells dropped from 8.0% to 6.1% (Extra's) and from 6.1% to 4.3% (Solo Lv R.), and the speech bubbles stayed detected.
2. **Separate text track with a speed cap.** The real problem with v3.1 is that the band average is calibrated on art. A lone 4-line bubble on a white frame averages to I ≈ 0.04, which maps to 3.5×. v3.2 keeps a per-row text profile and caps speed at `max(1, TEXT_REF / T)`, where T is the share of lettering in the band:
   - a full bubble (`TEXT_REF` = 0.0125) holds 1×
   - a one-liner still allows about 3×
   - so the time each piece of lettering spends on screen stays roughly constant
3. **Already-read lettering is ignored** for the cap (`TEXT_TOP` = 0.35). Without this, text somewhere in the tall band held ~95% of screens at 1× and the script almost never sped up.
4. **Asymmetric smoothing:** `SMOOTH_UP_MS` 900 and `SMOOTH_DOWN_MS` 350 replace `SMOOTH_MS` 450. Speed-ups ease in, and braking for arriving content stays prompt. p95 step fell from 16 to 13 pace-points per 250 ms. The largest steps (about 75–100) are braking, which is the safe direction.
5. **`INFO_REF` stays at 0.33.** The new pooled median is about 0.27, but lowering it made everything slower: the cap already removes most speed-ups. At 0.33, whole-chapter time stays within about ±10% of constant speed, so the speed setting keeps its meaning.
6. **Housekeeping:** `@version` 3.2, `DBG.text` added to the stats. A dev-only `__tmScroll.profile` hook exists only when the page sets `window.__tmScrollDev`. It can't fire in Tampermonkey's sandbox.

Kept unchanged: touch-outside pauses, the widget doesn't, wake lock while scrolling, settings persisted, stops at the bottom. All verified by `harness/checks.js`.

## Health

- **`unknown`:** non-zero in ≤ 0.1% of samples, even at speed 4. The 3-screen look-ahead keeps ahead of scrolling, so no change was needed.
- **`failed`:** 0 in every run.
- **Analysis cost:** about 7 ms of compute per image under 4× throttle (p95 11 ms, max 20 ms), once per image, in idle time. The 170–190 ms per image in the run table is mostly the emulated network latency of the re-download.
- **Re-download:** about 4–8 MB per 4 minutes, roughly 15–20 MB per chapter, as expected.

## Still to check on a real Firefox Android phone

- **Live site:** that the real Weeb Central DOM and lazy loading match the stand-in. Whether `<img>` has dimensions before loading decides whether `unknown` gaps appear. Check `__tmScroll.unknown` in a remote-debug console.
- **Re-download path:** that `GM_xmlhttpRequest` with `responseType: 'blob'`, then `createImageBitmap`, works in Firefox Tampermonkey. The harness only emulated it.
- **Feel:**
  - is 1× on a full bubble right for your reading speed?
  - do one-word bubbles at about 2–3× feel rushed? If they do, lower `TEXT_REF` to about 0.008.
  - is the braking (up to about 1 pace-point per ms) acceptable?
- **Real-device performance:** analysis time and battery or heat over a long session, and wake lock behaviour with battery saver on.

## v3.3: findings from the live page dump (owner's phone, Firefox 159 on Android)

`tools/page-dump.user.js` captured the real long-strip page on the owner's phone. What it showed:

- **Screen:** 378×771 at DPR 2.86. Page 1 starts 364 px down the page.
- **Image markup:** `<img class="max-w-full h-auto mx-auto" loading="lazy" decoding="async">` with **no width/height** attributes.
- **Not-yet-loaded pages** are a zero-width, `min-height: 50vh` (385 px) placeholder. `onload` clears the min-height, and a page is 605 px tall once loaded.
- **Firefox starts lazy images late:** only pages within about 300–900 px below the screen had loaded.

**Bug found:** `isCandidate` required a width of at least 30% of the screen. Unloaded pages were therefore treated as empty gaps (information 0) instead of unknown content. The script would have sped up into pages that hadn't loaded yet.

Fixes in v3.3:

1. Unloaded images with a placeholder at least `MIN_IMG_H` tall count as unknown, so they run at base speed.
2. With adaptive mode on, images inside the 3-screen look-ahead are switched from `loading="lazy"` to `"eager"`. They then load, and get analysed, before they scroll in.

**Harness changes:**
- The stand-in page now uses the real markup, the phone's viewport and UA, and a small loader that starts images 600 px ahead like Firefox (Chromium starts them much earlier).
- Telemetry records `blank`: the share of the reading band covered by an unloaded placeholder.

**v3.2 vs v3.3 on the realistic page** (A2, 4× CPU throttle):

| conditions | version | unknown>0 | blank on screen | text>150% |
|---|---|---|---|---|
| speed 3, 300 ms per image | v3.2 | 0.3% | 0 | 0.5% |
| | v3.3 | 0.1% | 0 | 0.6% |
| speed 4, 1.5 s per image (weak mobile data) | v3.2 | **11.2%** | 0 | 0.4% |
| | v3.3 | **3.5%** | 0 | 0.4% |

Placeholders never reached the reading band in these runs. A 600 px head start covered even 1.5 s loads at these speeds, so fix 1 is a safety net for very slow connections or manual jumps.

Fix 2 is the one that matters in practice. On a slow connection the page loads, then the script re-downloads it for analysis, so the latency is paid twice. Starting earlier removes most of the screens that ran at plain base speed for lack of analysis.

## v3.3.5: why adaptation did nothing on Firefox, found on the live site

On the owner's phone the pace never changed. To reproduce it, I drove real Firefox 159 with real Tampermonkey 5.5 on the live `weebcentral.com` chapter (`harness/firefox/`). Every analysis failed with `The operation is insecure.`, and pace sat at about 35%. Two bugs caused this. Neither one could show up in Chromium on the stand-in page.

1. **The shared analysis canvas got tainted for good.** For each image host, `analyze()` first tries reading the page `<img>` directly. The image is cross-origin, so drawing it taints the canvas. The script then re-downloads the image with `GM_xmlhttpRequest`, but drew the new bitmap onto that same canvas. Firefox keeps a canvas tainted even after it's resized, so every later read threw `SecurityError` (Chromium appears to reset it on resize). A probe userscript confirmed that each decode route (ImageBitmap from the GM Blob, object URL, data URL, page-side Blob, OffscreenCanvas) reads fine on a fresh canvas. **Fix:** after a failed direct read, replace the canvas with a fresh one.
2. **Hidden modals counted as text to read.** Weeb Central keeps its preferences, report and "Verification Required" dialogs fixed over the page with `visibility: hidden`. `IntersectionObserver` still reports them as on screen, so about 300 characters of menu text were added to every measurement: lettering read about 0.59 (50× `TEXT_REF`), and screen info about 1.1. That held pace at about 35% even with every image unanalysed. **Fix:** page text is only counted when `checkVisibility({visibilityProperty, opacityProperty})` says it's shown.

**After the fixes** (same live chapter, A2, speed 2, 90 s, Android UA): analysed 16 and failed 0, last error none, unknown 0.00. Pace ranged from 52% to 259% (most samples 60–100%, peaks on empty frames), and lettering read 0–0.13 from the images alone. Analysis took about 215–360 ms per image wall time, mostly the re-download.

**Still for the phone:** install v3.3.5 and read the diagnostics popup. Tampermonkey shows a one-time permission prompt if a title's images come from a host that `@connect` doesn't name (only `official.lowee.us` and `weebcentral.com` are named).
