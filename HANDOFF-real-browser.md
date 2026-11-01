# Handoff: test the auto-scroller userscript in real browsers on the live site

Read this first. Then read `report/REPORT.md` (what's been measured and changed so far) and `harness/README.md` (the existing Playwright harness).

## Where things stand

- **Branch:** `claude/new-session-rsc332` on `thekindlyone/Scrolly`.
- **Deliverable:** `auto-scroller.user.js`, now at **v3.3.4**. It has `@updateURL`/`@downloadURL` pointing at the raw GitHub URL on that branch. Bump `@version` on every push so Tampermonkey updates.
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

This exercises the real `GM_xmlhttpRequest`, the real sandbox and the real Firefox decoder: exactly the parts the stubbed harness can't check.

### 3. The existing Playwright harness with Playwright's Firefox, against the live page

1. Run `npx playwright install firefox`.
2. Switch `harness/lib.js` `openReader` from `chromium` to `firefox`. Remove the CDP-only bits: CPU throttling uses `newCDPSession`, and `isMobile` isn't supported on Firefox.
3. Add a `--live` option:
   - `page.goto` the real chapter URL with no `context.route` stubs.
   - Make sure Long Strip is selected.
   - Keep the GM stubs from `gmStubSource`. `GM_xmlhttpRequest` there is a CORS-free fetch done from Node; send `Referer: https://weebcentral.com/`.
4. Then `run.js`, `report.js` and `checks.js` work as before. `analyze.js` and `sim.js` can keep using the cached images.
5. Note: the stubs bypass Tampermonkey, so this checks the algorithm on the real page and real Firefox lazy loading, but **not** Tampermonkey itself.

### 4. The owner's actual phone (final check)

Use remote debugging.
- **Phone:** Settings → About → tap the build number 7 times to enable Developer options, turn on USB debugging, and in Firefox enable Settings → "Remote debugging via USB".
- **Desktop:** open `about:debugging` in Firefox, connect the phone, inspect the chapter tab. Pick the Tampermonkey content-script context to see the script's errors and run code in its sandbox.

This is the only way to see real-phone errors, timings, data use and feel.

## What to check once it runs

- **Diagnostics:** analysed rises and failed stays 0. Last error is "none". The pace swings with what's on screen: about 50–130% at A2 on Extra's ep. 3, and faster through blank gutters.
- **Visual:** at ≥200% pace, the screen should show blank gutters or flat backgrounds. At ≤55%, dense art and speech bubbles. Short bubbles shouldn't fly past.
- **Lazy loading:** the live page uses zero-width `min-height: 50vh` placeholders until an image loads, and Firefox loads images only ~600 px ahead. v3.3 treats placeholders as unknown and switches look-ahead images to `loading="eager"`. Confirm both on the live page.
- **Behaviour to keep:**
  - a touch outside the widget pauses
  - the wake lock is held while scrolling
  - speed and A-level persist
  - scrolling stops at the end
  - `harness/checks.js` covers these against the stand-in page

## Rules

- Keep `@match` limited to `weebcentral.com/chapters/*` (and subdomains), and keep `@noframes`.
- Only re-download images the site itself put on the page and the browser loaded (`analyze()` enforces this).
- Commit to `claude/new-session-rsc332`. Don't commit `harness/cache/` or `harness/out/`; they're gitignored.
- Report findings back in `report/REPORT.md`: what failed on Firefox, the fix, and before/after diagnostics.
