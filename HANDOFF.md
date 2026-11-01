# Handoff: test the auto-scroller userscript in real browsers on the live site

Read this first. Then read `report/REPORT.md` (what's been measured and changed so far) and `harness/README.md` (the existing Playwright harness).

## Where things stand

- **Branch:** `claude/new-session-rsc332` on `thekindlyone/Scrolly`.
- **Deliverable:** `auto-scroller.user.js`, now at **v3.3.5**. It has `@updateURL`/`@downloadURL` pointing at the raw GitHub URL on that branch. Bump `@version` on every push so Tampermonkey updates.
- **Target:** Firefox for Android (the owner has Firefox 159 with Tampermonkey; screen 378×771 at DPR 2.86), on `https://weebcentral.com/chapters/*` in **Long Strip** mode.
- **Test chapters:**
  - https://weebcentral.com/chapters/01JNKHAKGPTVWQVB69ETXT01F2 — The Extra's Academy Survival Guide ep. 3, 148 pages, images on `official.lowee.us`.
  - Solo Leveling: Ragnarok (CDN slug `Solo-Leveling-Ragnarok`), used as the second title.
- **How the script works:** see `report/REPORT.md`.
  - It re-downloads each page image with `GM_xmlhttpRequest`, because the CDN sends no CORS headers.
  - It analyses each image at 200 px wide into per-row "information" and "lettering" profiles.
  - It scales speed from what's on screen, with a lettering cap so speech bubbles aren't rushed.
- **Testing so far** used only Chromium in a cloud container, on a stand-in page copied from the live markup. The live site blocked that environment with a Cloudflare 403.

## Open bug: this is the first thing to solve

> **Update (v3.3.5): found and fixed. Confirmed in real Firefox 159 + Tampermonkey 5.5 on the live site.** Two causes: the shared analysis canvas stayed tainted after the first direct read, and the site's hidden modals were counted as text. See the v3.3.5 section of `report/REPORT.md` and `harness/firefox/README.md`. What's left: read the diagnostics popup on the phone after updating. The notes below are kept as they were.

On the owner's phone, **the pace doesn't change at any A-level**, while the stand-in page works.

Constant 100% pace is what happens when every image analysis fails: unanalysed images count as "typical".

v3.3.4 added a diagnostics popup (tap the speed text in the widget, or Tampermonkey menu → "Auto scroller diagnostics"). It shows:
- the version
- the A-level
- the current pace and target pace
- the number of pages analysed, failed and queued
- the last error

It hasn't been read on the phone yet. Ask the owner for it if it's still missing.

Hypotheses, most likely first:

1. **The download fails or is blocked.** `@connect` lists `official.lowee.us`, `weebcentral.com` and `*`. Tampermonkey may be waiting for a permission prompt, or "download failed" / HTTP errors appear in the popup.
2. **Decoding fails.** `createImageBitmap(blob)` may fail on a Blob coming from Tampermonkey's sandbox on Firefox (cross-compartment / Xray wrappers). That would show as a "decode:" error. A possible fix is to decode through `URL.createObjectURL` and an `Image`, or `new Blob([await r.response.arrayBuffer()])`.
3. **Pixels come back blank or randomised.** Firefox fingerprinting protection (strict tracking protection, `privacy.resistFingerprinting`, private tabs) can blank or randomise `getImageData`. Every cell would then be flat (speed always fast) or noisy (always slow), rather than staying at 100%, but check it.
4. **Images never get queued.** That would show as analysed 0 and failed 0.
   - The page's `<img>` elements are swapped in by htmx: `#chapter-images` uses `hx-get …/images` and `hx-swap="outerHTML"`.
   - The script's MutationObserver should pick them up. Confirm that it does, and that `nearImgs` is filled.
5. **An old copy is still installed** next to the new one. Check the version line in the popup.

## Goal for this session

Run the **real userscript in a real browser on the live site**, find out why adaptation doesn't happen on Firefox, fix it, and confirm the fix the same way.

From your own machine the site should load normally.

**Don't try to get around Cloudflare or any other bot protection.** If you get a challenge or a block, stop and report it. Keep traffic polite: one chapter at a time, no parallel scraping.

## Ways to test, closest to the real target first

### 1. Desktop Firefox + real Tampermonkey, by hand (fastest way to reproduce)

1. Install Tampermonkey in desktop Firefox.
2. Install the script from https://raw.githubusercontent.com/thekindlyone/Scrolly/claude/new-session-rsc332/auto-scroller.user.js
3. Open the test chapter and set the reader to Long Strip.
4. Press ▶ at A2 and open the diagnostics popup.

For logs:
- Use the Browser Console (Ctrl+Shift+J), not the page console.
- Tampermonkey runs `@grant` scripts in a sandbox, so `window.__tmScroll` is **not** visible from the page's console.
- If you need live stats, add a dev-only exposure through `unsafeWindow` behind a flag.

### 2. Automated real Firefox with real Tampermonkey (Selenium + geckodriver)

This is the most faithful automated setup.

1. Use Selenium's Firefox driver with `driver.install_addon('<tampermonkey>.xpi', temporary=True)`. Get the Tampermonkey `.xpi` from addons.mozilla.org.
2. Open the raw `.user.js` URL and click Install on Tampermonkey's install page. That's a separate extension tab, so find its button.
3. Open the chapter and click the widget's ▶ with a mouse click. A touch event outside the widget pauses scrolling.
4. Read results by tapping the speed label and capturing the `alert()` text (`driver.switch_to.alert.text`), every few seconds.
5. Use a 378×771 window, and optionally a mobile UA.

---

## Original brief (v3.1)

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
