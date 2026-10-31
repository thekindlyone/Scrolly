# Handoff: adaptive-speed webtoon auto-scroller

Read this first. It explains the project, what has been done, and what to do next.

## Goal

`auto-scroller.user.js` is a Tampermonkey userscript that auto-scrolls long-strip webtoon/manga chapters. The owner wants the scroll speed to adapt to what's on screen:

- **near-empty frames** (white or flat backgrounds, which are common in webtoons) → scroll **faster**
- **busy frames** (dense art, lots of detail, speech bubbles) → scroll **slower**

The job in this environment is to **run the real script on the real site in Playwright, check that it behaves as intended, and tune it**.

## Hard constraints

- **Target browser: Firefox for Android** with Tampermonkey. Every change must work there: no Chrome-only APIs, mobile-friendly performance, and touch UI (32px buttons).
- **Allowed APIs:** userscript APIs `GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest` (with `@connect *`). Screen Wake Lock, `requestIdleCallback`, `IntersectionObserver` and `createImageBitmap` are all fine on Firefox for Android.
- **Existing behaviour to keep:** a touch anywhere outside the widget pauses scrolling; the wake lock stays on while scrolling; the speed setting persists.

## Target site: Weeb Central

- Test chapter: https://weebcentral.com/chapters/01JNKHAKGPTVWQVB69ETXT01F2 (The Extra's Academy Survival Guide, Episode 3, 148 pages)
- Page images are `<img alt="Page N" class="max-w-full h-auto mx-auto">`. They are lazy-loaded, 800×1280 PNGs of about 100 KB each, served from **`official.lowee.us`** (e.g. `https://official.lowee.us/manga/the-extras-academy-survival-guide/0003-001.png`).
- **No CORS headers.** Drawing these images to a canvas taints it, so `getImageData` throws `SecurityError` and `fetch(..., {mode:'cors'})` fails. The script therefore re-downloads each image with `GM_xmlhttpRequest`, which costs about 15 MB extra per chapter.
- The site's reader must be set to **Long Strip** (Preferences menu). Single and double page modes don't scroll.
- Comments are hidden behind "Click to reveal", so their text doesn't affect the speed.

## How the script works (v3.1)

1. An `IntersectionObserver` with a 3-screen look-ahead finds page images as they approach. Each image is analysed once, in idle time: it is downscaled to 200 px wide and split into 5×5 cells.
   - A **flat** cell (luminance variance < 30) scores 0.
   - Any other cell scores `min(1, edgeDensity / 0.25)`, where an edge is a neighbouring-pixel luminance jump > 40.
   - **Text-like** cells (mostly one extreme with 5–45% of the other, low midtones, many edges, and a neighbouring text cell) count double.
   - The result is a per-row "information" profile for the image.
2. Every 250 ms, the script averages that information over the screen band from 10% to 95% of the height. The lower half is weighted more, as look-ahead. Gaps count as 0. **Images that haven't been analysed yet count as typical (`INFO_REF`), so the script never rushes into unknown content.**
3. Speed factor = `clamp(((INFO_REF + EPS) / (I + EPS)) ^ gamma, 0.3, 3.5)`. `gamma` comes from the **A** button: off / 0.6 / 1 / 1.4. The factor eases toward its target with a 450 ms time constant. Scrolling is frame-rate independent.
4. Read-only stats are exposed on `window.__tmScroll` (`info`, `unknown`, `queue`, `analyzed`, `failed`, `analysisMs`) for the harness.

All tunables live in `CFG` at the top of the script.

## Findings so far (offline analysis, not yet the real script)

These numbers come from analysing all 148 page images in a desktop browser with the same algorithm, plus a JavaScript simulation of a 412×780 phone viewport:

- About 30% of image rows are completely flat. Per page, 20–98% of cells are flat.
- Information averaged over the screen ranges from about 0.055 (2nd percentile) to 0.78 (98th percentile), with a median of 0.33. That median is where `INFO_REF` comes from.
- At the same base speed, the adaptive mode takes about the same total time (14.2 min vs 13.4 min). Time spent on near-empty screens drops from 11.7% to 5.5%, and time on dense screens rises from 21% to 34%.
- In the simulation the factor typically ranged from about 0.5× to 3× and changed smoothly.

**Not verified yet:**
- whether the text detector really fires on speech bubbles rather than line art (no visual check was done)
- whether image analysis keeps ahead of scrolling at high speed
- whether lazy loading leaves "unknown" gaps
- how it feels on a real device

## What's in this folder

- `auto-scroller.user.js`: the userscript (v3.1). This is the deliverable to improve.

## Setup

1. **Network:** this environment must be able to reach `weebcentral.com` and `official.lowee.us`. Test with `curl -sSI https://official.lowee.us/manga/the-extras-academy-survival-guide/0003-001.png`. A 403 from a proxy means those domains need adding to the environment's network allowlist, or network access needs setting to full.
2. **Proxy:** if outbound HTTPS goes through a proxy (`HTTPS_PROXY` is set), Playwright's Firefox needs it passed as `launch({ proxy })` and may need `ignoreHTTPSErrors`. Check any proxy README in the environment (e.g. `/root/.ccr/README.md`).
3. **Bot checks:** if the site serves a bot check or Cloudflare page, record what you see. Don't try to bypass it.

## Tasks

1. **Build a Playwright harness** (Node, `playwright` with Firefox) that runs the real script on the real page:
   - **Phone emulation:** Firefox, viewport 412×780, `deviceScaleFactor` about 2.6, and an Android Firefox user agent.
   - **GM stubs:** in an init script, stub `GM_getValue` and `GM_setValue` with a map pre-seeded with `auto_level` and `scroll_speed`.
   - **`GM_xmlhttpRequest`:** emulate it as a CORS-free fetch. For example, `context.exposeFunction` calls `context.request.get(url, {headers:{Referer}})` and returns base64; the page side turns it into a `Blob` and calls `onload({status, response: blob})`.
   - **Injection:** after `load`, once `img[alt^="Page"]` exists, inject the script with `addScriptTag`. That mirrors Tampermonkey's document-idle timing.
   - **Starting playback:** press play with a mouse click, not a tap. A `touchstart` outside the widget pauses scrolling.
   - **Telemetry, every 250 ms:** time, `scrollY`, px/s, pace % (from `#tm-scroll-pace`), the `window.__tmScroll` stats, and the page at screen centre.
   - **Screenshots:** take a few at the fastest moments (pace ≥ 250%) and the slowest (≤ 55%).
   - **Two runs:** a baseline with `auto_level = 0` and an adaptive run with `auto_level = 2`, about 4 minutes each.
2. **Visual check:** fast screenshots should be mostly empty or flat frames; slow ones should be busy art or dialogue. If they're wrong, inspect the per-cell classification. A dev-only debug overlay that draws flat, busy and text cells over an image would help; don't ship it.
3. **Health checks from telemetry:**
   - `unknown` should be ~0 most of the time. If not, analysis isn't keeping ahead: widen the observer's look-ahead, or prioritise images nearest the viewport.
   - `failed` should be 0.
   - Check average analysis ms per image. Phones are maybe 3–5× slower than this machine, so it must stay small.
   - Speed shouldn't jerk. Check how fast pace changes from sample to sample.
4. **Tuning:** adjust `CFG` until fast means empty and slow means busy, without reading feeling rushed. The levers are `INFO_REF`, `INFO_EPS`, `MIN_FACTOR`, `MAX_FACTOR`, `TEXT_WEIGHT`, the band weights, `SMOOTH_MS` and the cell thresholds. Also try a higher base speed and A3.
5. **Second title:** test at least one other chapter from a different series on Weeb Central, so the tuning isn't overfitted to one artist.
6. **Mobile performance:** keep it in mind. Analysis runs once per image at 200 px wide in idle time; don't make it heavier without a reason.

## Deliverables

- An updated `auto-scroller.user.js`: bump `@version`, keep the `@match` lines for Weeb Central chapters, and keep the `window.__tmScroll` stats or strip them cleanly.
- The harness code.
- A short report:
  - before/after numbers from the baseline and adaptive runs
  - what the fast and slow screenshots showed
  - what you changed in `CFG` or the algorithm, and why
  - anything that still needs checking on a real Firefox Android phone
