# Test harness for `auto-scroller.user.js`

Playwright harness that runs the real userscript on an emulated phone and measures how it behaves.

## Why a stand-in reader page

`weebcentral.com` answers this test environment with a Cloudflare block page (HTTP 403, "Sorry, you have been blocked"), both to curl and to headless Chromium. The harness does not try to get around it.

What the harness does instead:

- The page images come from the real CDN (`official.lowee.us`). `fetch-chapter.sh` caches them on disk.
- They are served at their real URLs, cross-origin, with **no CORS headers**, exactly like the live CDN. Canvas tainting and the `GM_xmlhttpRequest` re-download path are therefore exercised for real.
- The chapter page (`http://reader.test/chapters/<slug>/<NNNN>`) copies the live long-strip markup, captured on a phone with `tools/page-dump.user.js`: images have no width/height, use `style="min-height: 50vh"` until loaded, and have an `onload` that clears it.
- By default (`--fxlazy 600`) a small loader starts images 600 px ahead, like Firefox for Android does; Chromium's own lazy loading starts much earlier. The loader also loads an image at once if the script sets `loading="eager"`.

Other substitutions:

- **Browser:** only Playwright's Chromium is installed here, so runs use Chromium with phone emulation instead of Firefox: the owner's phone viewport (378×771, DPR 2.857), touch, and its Firefox 159 Android UA string.
- **Phone CPU:** 4× CPU throttling via CDP (`--cpu 4`) stands in for a phone's slower CPU.
- **Network:** each image and GM request gets 120 ms of added latency (`--latency`).

## Setup

```sh
export NODE_PATH=$(npm root -g)          # uses the preinstalled playwright
./fetch-chapter.sh the-extras-academy-survival-guide 0003   # 148 pages
./fetch-chapter.sh Solo-Leveling-Ragnarok 0001              # 163 pages (second title)
./fetch-chapter.sh Solo-Leveling-Ragnarok 0010              # 114 pages
```

## Tools

| Script | What it does |
|---|---|
| `run.js` | Real-time run. Injects the script after `load` (like `@run-at document-idle`) and presses play with a mouse click, because a touch would pause it. Logs telemetry every 250 ms and screenshots fast (≥ `--fast`%) and slow (≤ `--slow`%) moments. Output goes to `out/runs/<name>/`. |
| `run-suite.sh` | The 4-minute runs used in the report, two at a time. |
| `report.js` | Table of run results, scored against offline profiles: time on near-empty and dense screens, lettering passing at >150%, pace spread and steps, `unknown`, `failed`, ms/image, MB re-downloaded. |
| `analyze.js` | Runs the script's own image analysis on every page through a dev-only hook (`window.__tmScrollDev` → `__tmScroll.profile`). Saves `profiles.json` and draws debug overlays: blue = flat, orange = busy art, magenta = text, green bars = per-row information. |
| `sim.js` | Replays the speed logic (`measureInfo` → factor → smoothing) over profiles, for whole-chapter CFG sweeps in about a second. |
| `checks.js` | Behaviour checks: touch outside pauses, the widget doesn't pause, wake lock held/released, settings persist, stops at the bottom. |

All tools accept `--cfg '{"KEY":value}'` to override `CFG` without editing the script. `SCRIPT=/path/to/other.user.js` tests a different copy of the script.

```sh
node run.js --chapter the-extras-academy-survival-guide/0003 --auto 2 --speed 2 --secs 240 --cpu 4 --name mine
node report.js mine
node analyze.js --chapter Solo-Leveling-Ragnarok/0001 --overlays 20,40,60
node sim.js --profiles out/analysis/Solo-Leveling-Ragnarok_0001/profiles.json --auto 2 --cfg '{"TEXT_REF":0.02}'
node checks.js
```
