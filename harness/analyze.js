// Offline pass: runs the userscript's own image analysis (via the dev-only
// __tmScroll.profile hook) on every page of a chapter, saves the per-row
// information profiles, and renders debug overlays of the cell classification.
//
//   node analyze.js --chapter the-extras-academy-survival-guide/0003 [--overlays 1,5,40] [--cfg '{...}']
//
// Overlay colours: blue tint = flat (scores 0), orange = busy art (opacity = score),
// magenta = text-like (counts TEXT_WEIGHT x).
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, openReader, injectScript } = require('./lib');

(async () => {
    const o = parseArgs(process.argv.slice(2), {
        chapter: 'the-extras-academy-survival-guide/0003', overlays: '', cfg: '', out: '', cpu: 1,
    });
    const out = o.out || path.join(__dirname, 'out', 'analysis', o.chapter.replace('/', '_'));
    fs.mkdirSync(path.join(out, 'overlays'), { recursive: true });
    const { browser, page, pages } = await openReader({ chapter: o.chapter, seed: { auto_level: 0 }, latencyMs: 0, cpu: o.cpu });
    await injectScript(page, o.cfg);
    const want = new Set(String(o.overlays).split(',').filter(Boolean).map(Number));

    const results = [];
    for (const p of pages) {
        const r = await page.evaluate(async ({ url, overlay }) => {
            const blob = await new Promise((res, rej) => GM_xmlhttpRequest({
                url, responseType: 'blob', onload: (x) => res(x.response), onerror: rej,
            }));
            const bmp = await createImageBitmap(blob);
            const t0 = performance.now();
            const { info: rows, text, cells } = window.__tmScroll.profile(bmp, bmp.width, bmp.height);
            const ms = performance.now() - t0;
            const n = cells.length * (cells[0] ? cells[0].length : 0);
            let flat = 0, busy = 0, nText = 0;
            cells.forEach((row) => row.forEach((c) => { if (c === 0) flat++; else if (c === 1) busy++; else nText++; }));
            let png = null;
            if (overlay) {
                const W = 400, sc = W / bmp.width, H = Math.round(bmp.height * sc);
                const cv = document.createElement('canvas');
                cv.width = W * 2 + 8; cv.height = H;
                const g = cv.getContext('2d');
                g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, H);
                g.drawImage(bmp, 0, 0, W, H);
                g.drawImage(bmp, W + 8, 0, W, H);
                const cw = W / cells[0].length, ch = cw; // cells are square at analysis scale
                cells.forEach((row, cy) => row.forEach((c, cx) => {
                    const x = W + 8 + cx * cw, y = cy * ch;
                    if (c === 0) { g.fillStyle = 'rgba(40,90,255,0.35)'; }
                    else if (c === 2) { g.fillStyle = 'rgba(255,0,200,0.6)'; }
                    else { g.fillStyle = 'rgba(255,140,0,0.5)'; }
                    g.fillRect(x, y, cw, ch);
                }));
                // per-row info profile as a bar on the right edge
                g.fillStyle = 'rgba(0,255,120,0.9)';
                rows.forEach((v, i) => g.fillRect(cv.width - 2 - Math.min(1.5, v) * 40, i * ch, Math.min(1.5, v) * 40, Math.max(1, ch - 0.5)));
                png = cv.toDataURL('image/png').split(',')[1];
            }
            const mean = rows.reduce((a, b) => a + b, 0) / rows.length;
            return { rows: Array.from(rows, (v) => +v.toFixed(4)), w: bmp.width, h: bmp.height, ms, cells: n, flat, busy, text: Array.from(text, (v) => +v.toFixed(4)), nText, mean, png };
        }, { url: p.url, overlay: want.has(p.n) });
        if (r.png) fs.writeFileSync(path.join(out, 'overlays', `page-${String(p.n).padStart(3, '0')}.png`), Buffer.from(r.png, 'base64'));
        delete r.png;
        results.push({ n: p.n, ...r });
    }
    await browser.close();

    fs.writeFileSync(path.join(out, 'profiles.json'), JSON.stringify({ chapter: o.chapter, cfg: o.cfg, pages: results }));
    const ms = results.map((r) => r.ms).sort((a, b) => a - b);
    const sum = (k) => results.reduce((a, r) => a + r[k], 0);
    console.log(JSON.stringify({
        chapter: o.chapter, pages: results.length,
        cellShare: { flat: +(sum('flat') / sum('cells')).toFixed(3), busy: +(sum('busy') / sum('cells')).toFixed(3), text: +(sum('nText') / sum('cells')).toFixed(3) },
        analysisMs: { mean: +(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1), p95: +ms[Math.floor(ms.length * 0.95)].toFixed(1), max: +ms[ms.length - 1].toFixed(1) },
        pageMeanInfo: results.map((r) => +r.mean.toFixed(2)).join(' '),
    }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
