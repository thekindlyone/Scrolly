// Real-time run: loads the reader page on an emulated phone, injects the userscript,
// presses play with a mouse click, records telemetry every 250 ms and screenshots
// the fastest/slowest moments.
//
//   node run.js --chapter the-extras-academy-survival-guide/0003 --auto 2 --speed 2 --secs 240 \
//               [--cpu 4] [--latency 120] [--cfg '{"INFO_REF":0.3}'] [--name adaptive]
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs, openReader, injectScript } = require('./lib');

(async () => {
    const o = parseArgs(process.argv.slice(2), {
        chapter: 'the-extras-academy-survival-guide/0003', auto: 2, speed: 2, secs: 240,
        cpu: 1, latency: 120, fxlazy: 600, cfg: '', name: '', shots: 4, fast: 250, slow: 55,
    });
    const name = o.name || `${o.chapter.split('/')[0].slice(0, 12)}-a${o.auto}-s${o.speed}`;
    const out = path.join(__dirname, 'out', 'runs', name);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'shots'), { recursive: true });

    const { browser, page, net } = await openReader({
        chapter: o.chapter, seed: { auto_level: o.auto, scroll_speed: o.speed }, latencyMs: o.latency, cpu: o.cpu, fxLazy: o.fxlazy,
    });
    await injectScript(page, o.cfg);

    // In-page sampler: timing is exact even if the node side lags behind.
    await page.evaluate(() => {
        const tele = (window.__tele = []);
        const t0 = performance.now();
        let lastY = window.scrollY, lastT = t0;
        setInterval(() => {
            const t = performance.now();
            const y = window.scrollY;
            const cy = window.innerHeight / 2;
            let pg = null, blank = 0;
            const bt = innerHeight * 0.1, bb = innerHeight * 0.95;
            for (const img of document.querySelectorAll('img[alt^="Page"]')) {
                const r = img.getBoundingClientRect();
                if (r.top <= cy && r.bottom > cy) pg = +img.alt.slice(5);
                // Unloaded placeholder in the reading band (ground truth, not the script's view).
                if (!(img.complete && img.naturalWidth)) blank += Math.max(0, Math.min(bb, r.bottom) - Math.max(bt, r.top)) / (bb - bt);
            }
            const s = window.__tmScroll;
            tele.push({
                t: +((t - t0) / 1000).toFixed(3), y, pxs: +((y - lastY) / ((t - lastT) / 1000)).toFixed(1),
                pace: parseInt(document.getElementById('tm-scroll-pace').textContent, 10) || null,
                info: +s.info.toFixed(4), unknown: +s.unknown.toFixed(3), queue: s.queue,
                analyzed: s.analyzed, failed: s.failed, analysisMs: +s.analysisMs.toFixed(1), page: pg, blank: +blank.toFixed(3),
            });
            lastY = y; lastT = t;
        }, 250);
    });

    await page.mouse.click(...(await centre(page, '#tm-scroll-play')));
    const started = Date.now();
    const taken = { fast: 0, slow: 0 };
    let lastShot = { fast: -1e9, slow: -1e9 };
    while (Date.now() - started < o.secs * 1000) {
        await page.waitForTimeout(500);
        const st = await page.evaluate(() => ({
            last: window.__tele[window.__tele.length - 1],
            playing: document.getElementById('tm-scroll-play').textContent === '⏸',
        }));
        if (!st.playing) { console.log('stopped (end of chapter?) at', st.last && st.last.t); break; }
        const p = st.last && st.last.pace;
        const now = Date.now();
        for (const [kind, ok] of [['fast', p >= o.fast], ['slow', p && p <= o.slow]]) {
            if (ok && taken[kind] < o.shots && now - lastShot[kind] > 15000) {
                taken[kind]++; lastShot[kind] = now;
                await page.screenshot({ path: path.join(out, 'shots', `${kind}-${taken[kind]}-p${st.last.page}-${p}pct.png`) });
            }
        }
    }
    const tele = await page.evaluate(() => window.__tele);
    const layout = await page.evaluate(() => Array.from(document.querySelectorAll('img[alt^="Page"]'), (img) => {
        const r = img.getBoundingClientRect();
        return { n: +img.alt.slice(5), top: r.top + window.scrollY, h: r.height, w: r.width };
    }));
    const vh = await page.evaluate(() => window.innerHeight);
    await browser.close();

    fs.writeFileSync(path.join(out, 'telemetry.json'), JSON.stringify({ opts: o, vh, layout, net, tele }));
    console.log(JSON.stringify(summarize(tele, net, o), null, 1));
})().catch((e) => { console.error(e); process.exit(1); });

async function centre(page, sel) {
    const b = await page.locator(sel).boundingBox();
    return [b.x + b.width / 2, b.y + b.height / 2];
}

function pct(a, q) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

function summarize(tele, net, o) {
    const run = tele.filter((s) => s.t > 0.5);
    const last = run[run.length - 1];
    const paces = run.map((s) => s.pace || 100);
    const dp = run.slice(1).map((s, i) => Math.abs((s.pace || 100) - (paces[i])));
    const pxs = run.map((s) => s.pxs);
    return {
        name: o.name, chapter: o.chapter, auto: o.auto, speed: o.speed, cpu: o.cpu,
        seconds: last.t, distancePx: last.y, meanPxPerSec: +(last.y / last.t).toFixed(1),
        pageReached: last.page,
        pace: { p5: pct(paces, 0.05), p50: pct(paces, 0.5), p95: pct(paces, 0.95), min: Math.min(...paces), max: Math.max(...paces) },
        timeShare: { fastGe200: +(paces.filter((p) => p >= 200).length / paces.length).toFixed(3), slowLe60: +(paces.filter((p) => p <= 60).length / paces.length).toFixed(3) },
        paceStepPer250ms: { p50: pct(dp, 0.5), p95: pct(dp, 0.95), max: Math.max(...dp) },
        pxsP5P95: [pct(pxs, 0.05), pct(pxs, 0.95)],
        unknownGt0Share: +(run.filter((s) => s.unknown > 0.001).length / run.length).toFixed(3),
        unknownMean: +(run.reduce((a, s) => a + s.unknown, 0) / run.length).toFixed(4),
        maxQueue: Math.max(...run.map((s) => s.queue)),
        analyzed: last.analyzed, failed: last.failed,
        msPerImage: last.analyzed ? +(last.analysisMs / (last.analyzed + last.failed)).toFixed(1) : null,
        gmRequests: net.gmRequests, gmMB: +(net.gmBytes / 1e6).toFixed(1),
    };
}
