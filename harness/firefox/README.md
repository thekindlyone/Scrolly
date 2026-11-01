# Real Firefox + real Tampermonkey on the live site

Selenium drives a real Firefox with the real Tampermonkey extension on `weebcentral.com`. This is the closest automated setup to the owner's phone (Firefox 159 for Android + Tampermonkey). It is what found the v3.3.5 bugs that the Chromium harness and the stand-in page could not show.

Keep traffic polite: one chapter at a time, no parallel runs. If the site serves a bot check, stop. Don't try to get around it.

## Setup (once, no root needed)

Everything goes in `~/.cache/scrolly-ff` (override with `SCROLLY_FF`):

```sh
T=~/.cache/scrolly-ff; mkdir -p $T && cd $T
curl -sSL -o ff.tar.xz 'https://download.mozilla.org/?product=firefox-latest-ssl&os=linux64&lang=en-US' && tar xf ff.tar.xz
curl -sSL https://github.com/mozilla/geckodriver/releases/download/v0.37.1/geckodriver-v0.37.1-linux64.tar.gz | tar xz
curl -sSL -o tm.xpi https://addons.mozilla.org/firefox/downloads/latest/tampermonkey/latest.xpi
python3 -m venv venv && ./venv/bin/pip install selenium
```

## Running

Serve the repo so Tampermonkey can install the local copy of the script. Then run:

```sh
python3 -m http.server 8765 --bind 127.0.0.1        # from the repo root
~/.cache/scrolly-ff/venv/bin/python harness/firefox/live.py --mobile --secs 90 --every 3
```

`live.py` does the following:

1. Installs Tampermonkey as a temporary add-on.
2. Opens the script URL and clicks **Install** on Tampermonkey's own install page.
3. Opens the chapter, then clicks ▶ with a mouse click.
4. Every `--every` seconds, taps the speed text and prints the diagnostics `alert()`.

Screenshots go to `harness/out/firefox/`.

Options:

- `--script <url>`: install a different copy of the script.
- `--chapter <url>`: a different chapter.
- `--mobile`: Android Firefox UA.
- `--headed`: show the browser window.
- `--pref name=json`: set any Firefox pref, for example `--pref 'privacy.resistFingerprinting=true'`.
- `--probe <url>`: install a probe userscript instead, and print the JSON it leaves in `#tm-probe`.

`probe.user.js` tries every way of decoding a `GM_xmlhttpRequest` image (ImageBitmap from the Blob, object URL, data URL, page-side Blob, OffscreenCanvas, ImageDecoder). For each one it reports whether canvas pixels can be read.

## Gotchas

- **Install page needs system access.** Tampermonkey's install page is a `moz-extension://` page, which Marionette calls "privileged scope". It can only be driven when geckodriver runs with `--allow-system-access`.
- **Don't wait for the `.user.js` load.** The navigation to the `.user.js` URL never finishes loading, because Tampermonkey takes it over. Hence `page_load_strategy = 'none'`.
- **`@connect *` alone isn't enough.** A host that `@connect` doesn't list by name makes Tampermonkey wait for a permission prompt. In the probe, the download failed until `official.lowee.us` was listed.
- **`window.__tmScroll` can't be read from here.** The script runs in Tampermonkey's sandbox, so the diagnostics popup is the readout.
