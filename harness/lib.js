// Shared harness plumbing: phone emulation, a local stand-in for the Weeb Central
// reader page, Tampermonkey API stubs, and userscript loading with CFG overrides.
//
// Why a stand-in page: weebcentral.com answers this environment with a Cloudflare
// block page (403). The page images come from the real CDN (official.lowee.us),
// cached on disk by fetch-chapter.sh and served cross-origin WITHOUT CORS headers,
// exactly like the live CDN, so canvas tainting and the GM_xmlhttpRequest path
// are exercised for real.
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, 'cache');
const SCRIPT = process.env.SCRIPT || path.join(ROOT, 'auto-scroller.user.js');
const CDN = 'https://official.lowee.us/manga/';
const READER = 'http://reader.test/chapters/';

const PHONE = {
    viewport: { width: 412, height: 780 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
};

function parseArgs(argv, defaults) {
    const o = { ...defaults };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const k = a.slice(2);
        const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
        o[k] = typeof defaults[k] === 'number' ? Number(v) : v;
    }
    if (typeof o.cfg === 'string') o.cfg = o.cfg ? JSON.parse(o.cfg) : {};
    return o;
}

// chapter = "<slug>/<NNNN>"
function chapterPages(chapter) {
    const dir = path.join(CACHE, chapter);
    if (!fs.existsSync(dir)) throw new Error(`No cache for ${chapter}; run fetch-chapter.sh first`);
    const [slug, ch] = chapter.split('/');
    return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f, i) => ({
        n: i + 1,
        url: `${CDN}${slug}/${ch}-${f}`,
        file: path.join(dir, f),
        ...jpegSize(path.join(dir, f)),
    }));
}

// The CDN serves JPEG data under .png names; read the SOF header for intrinsic size.
function jpegSize(file) {
    const b = fs.readFileSync(file);
    let i = 2;
    while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
        }
        i += 2 + b.readUInt16BE(i + 2);
    }
    throw new Error('Not a JPEG: ' + file);
}

function urlToFile(url) {
    if (!url.startsWith(CDN)) return null;
    const rest = url.slice(CDN.length); // slug/NNNN-PPP.png
    const m = rest.match(/^(.+)\/(\d{4})-(\d{3})\.png$/);
    if (!m) return null;
    const f = path.join(CACHE, m[1], m[2], m[3] + '.png');
    return fs.existsSync(f) ? f : null;
}

// Approximation of Weeb Central's long-strip reader markup: a top bar, the page
// images (lazy-loaded, same alt/class as the live site), then chapter navigation
// and a comment section whose text is hidden behind "Click to reveal".
function readerHtml(chapter, pages) {
    const imgs = pages.map((p) =>
        `<img src="${p.url}" alt="Page ${p.n}" class="max-w-full h-auto mx-auto" loading="lazy" width="${p.w}" height="${p.h}">`
    ).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${chapter} | Weeb Central (local stand-in)</title>
<style>
 body{margin:0;background:#1f1f1f;color:#ddd;font:14px system-ui,sans-serif}
 header{position:sticky;top:0;z-index:5;background:#111;padding:12px 16px;display:flex;justify-content:space-between}
 .max-w-full{max-width:100%}.h-auto{height:auto}.mx-auto{margin-left:auto;margin-right:auto}
 img{display:block}
 section.strip{display:flex;flex-direction:column}
 nav,footer{padding:16px}
 .reveal{background:#333;padding:12px;border-radius:6px;margin:8px 0}
 .hidden{display:none}
</style></head><body>
<header><span>☰ Weeb Central</span><span>Episode · Preferences</span></header>
<main><section class="strip">
${imgs}
</section>
<nav><button>Previous</button> <button>Next</button></nav>
<footer><h3>Comments</h3>
<div class="reveal">Click to reveal<div class="hidden">${'Lorem ipsum dolor sit amet. '.repeat(60)}</div></div>
<p>© Weeb Central</p></footer></main>
</body></html>`;
}

// Tampermonkey API stubs. GM_xmlhttpRequest is a CORS-free fetch backed by the
// node side (window.__gmFetch), returning a Blob like Tampermonkey does.
function gmStubSource(seed) {
    return `(() => {
  const store = new Map(Object.entries(${JSON.stringify(seed)}));
  window.__tmScrollDev = true;
  window.GM_getValue = (k, d) => store.has(k) ? store.get(k) : d;
  window.GM_setValue = (k, v) => { store.set(k, v); };
  window.GM_xmlhttpRequest = (o) => {
    window.__gmFetch(o.url).then((r) => {
      if (!r) { o.onerror && o.onerror(new Error('network')); return; }
      const bin = atob(r.body);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      o.onload && o.onload({ status: r.status, response: r.status === 200 ? new Blob([u8], { type: r.type }) : null });
    }, (e) => o.onerror && o.onerror(e));
  };
})();`;
}

// Userscript source with optional CFG overrides spliced in.
function scriptSource(cfg) {
    let src = fs.readFileSync(SCRIPT, 'utf8');
    if (cfg && Object.keys(cfg).length) {
        const marker = /    const CFG = \{([\s\S]*?)\n    \};/;
        if (!marker.test(src)) throw new Error('CFG block not found');
        src = src.replace(marker, (m, body) => `    const CFG = Object.assign({${body}\n    }, ${JSON.stringify(cfg)});`);
    }
    return src;
}

async function openReader({ chapter, seed = {}, latencyMs = 120, cpu = 1, headless = true }) {
    const pages = chapterPages(chapter);
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext(PHONE);
    const net = { imgRequests: 0, gmRequests: 0, gmBytes: 0 };

    await context.route(READER + '**', (route) =>
        route.fulfill({ status: 200, contentType: 'text/html', body: readerHtml(chapter, pages) }));
    await context.route(CDN + '**', async (route) => {
        net.imgRequests++;
        const f = urlToFile(route.request().url());
        if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
        // Same as the live CDN: image/png content type, no Access-Control-Allow-Origin.
        if (!f) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(f),
            headers: { 'cache-control': 'max-age=315360000' } });
    });
    await context.exposeFunction('__gmFetch', async (url) => {
        net.gmRequests++;
        const f = urlToFile(url);
        if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
        if (!f) return { status: 404, body: '', type: 'text/plain' };
        const buf = fs.readFileSync(f);
        net.gmBytes += buf.length;
        return { status: 200, body: buf.toString('base64'), type: 'image/png' };
    });
    await context.addInitScript(gmStubSource(seed));

    const page = await context.newPage();
    if (cpu > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    }
    await page.goto(READER + chapter, { waitUntil: 'load' });
    await page.waitForSelector('img[alt^="Page"]');
    return { browser, context, page, pages, net };
}

// Same timing as Tampermonkey's default @run-at document-idle: after load.
async function injectScript(page, cfg) {
    await page.addScriptTag({ content: scriptSource(cfg) });
    await page.waitForSelector('#tm-scroll-widget');
}

module.exports = { PHONE, ROOT, CACHE, parseArgs, chapterPages, openReader, injectScript, scriptSource };
