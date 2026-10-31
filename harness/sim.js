// Fast simulator: replays the userscript's speed logic (measureInfo -> factor ->
// smoothing -> frame-rate independent scroll) over offline profiles from analyze.js.
// Used for CFG sweeps and for scoring real runs (bandInfo is the same measurement).
//
//   node sim.js --profiles out/analysis/<chapter>/profiles.json --auto 2 --speed 2 [--cfg '{...}']
'use strict';
const fs = require('fs');
const { parseArgs } = require('./lib');

const LEVELS = [0, 0.6, 1, 1.4];
const DEFAULT_CFG = cfgFromScript();

// Pull the CFG defaults straight out of the userscript so the simulator can't drift.
function cfgFromScript() {
    const src = fs.readFileSync(process.env.SCRIPT || require('./lib').ROOT + '/auto-scroller.user.js', 'utf8');
    const body = src.match(/const CFG = \{([\s\S]*?)\n    \};/)[1];
    return Function(`return {${body}\n}`)();
}

// Page layout on a 412px-wide phone: images scaled to viewport width, stacked under a header.
function layoutFor(pages, vw = 412, header = 45) {
    let top = header;
    return pages.map((p) => {
        const h = p.h * Math.min(1, vw / p.w) * (p.w > vw ? 1 : 1);
        const L = { n: p.n, top, h: p.h * (vw / p.w), rows: p.rows, text: p.text };
        top += L.h;
        return L;
    });
}

function avgRows(rows, f0, f1) {
    const n = rows.length;
    const rs = Math.max(0, f0 * n), re = Math.min(n, f1 * n);
    if (re <= rs) return 0;
    let sum = 0;
    for (let i = Math.floor(rs); i < Math.ceil(re); i++) sum += rows[i] * (Math.min(i + 1, re) - Math.max(i, rs));
    return sum / (re - rs);
}

// Port of measureInfo() for a given scroll position (document coords).
function bandInfo(layout, scrollY, vh, cfg) {
    const N = cfg.STRIPS;
    const bt = vh * cfg.BAND_TOP, bb = vh * cfg.BAND_BOTTOM, sh = (bb - bt) / N;
    const acc = new Float64Array(N);
    const txt = new Float64Array(N);
    for (const L of layout) {
        const top = L.top - scrollY, bottom = top + L.h;
        if (bottom <= bt || top >= bb) continue;
        for (let s = 0; s < N; s++) {
            const y0 = bt + s * sh, y1 = y0 + sh;
            const o0 = Math.max(y0, top), o1 = Math.min(y1, bottom);
            if (o1 <= o0) continue;
            acc[s] += avgRows(L.rows, (o0 - top) / L.h, (o1 - top) / L.h) * ((o1 - o0) / sh);
            if (L.text) txt[s] += avgRows(L.text, (o0 - top) / L.h, (o1 - top) / L.h) * ((o1 - o0) / sh);
        }
    }
    if (cfg.TEXT_TOP) for (let s = 0; s < N; s++) if ((bt + (s + 0.5) * sh) / vh < cfg.TEXT_TOP) txt[s] = 0;
    return { I: weightStrips(acc, bt, sh, vh, cfg), T: weightStrips(txt, bt, sh, vh, cfg) };
}

function weightStrips(acc, bt, sh, vh, cfg) {
    let sum = 0, wsum = 0;
    for (let s = 0; s < acc.length; s++) {
        const y = (bt + (s + 0.5) * sh) / vh;
        const w = cfg.BAND_WEIGHT ? cfg.BAND_WEIGHT(y) : (y < 0.5 ? 1 : 1 + (y - 0.5));
        sum += acc[s] * w;
        wsum += w;
    }
    return wsum ? sum / wsum : cfg.INFO_REF;
}

function targetFor({ I, T }, gamma, cfg) {
    if (!gamma) return 1;
    const raw = Math.pow((cfg.INFO_REF + cfg.INFO_EPS) / (I + cfg.INFO_EPS), gamma);
    const textCap = cfg.TEXT_REF && T > 0 ? Math.max(1, cfg.TEXT_REF / T) : Infinity;
    return Math.max(cfg.MIN_FACTOR, Math.min(cfg.MAX_FACTOR, textCap, raw));
}

// Simulate a whole chapter. Returns per-sample trace and summary.
function simulate(profiles, { auto = 2, speed = 2, vh = 780, cfg: over = {}, fps = 60 } = {}) {
    const cfg = { ...DEFAULT_CFG, ...over };
    const layout = layoutFor(profiles.pages);
    const docH = layout[layout.length - 1].top + layout[layout.length - 1].h + 400;
    const gamma = LEVELS[auto];
    const dt = 1000 / fps;
    let y = 0, t = 0, nextSample = 0, factor, target;
    target = factor = targetFor(bandInfo(layout, 0, vh, cfg), gamma, cfg);
    const trace = [];
    while (y + vh < docH - 5 && t < 3600e3) {
        if (t >= nextSample) {
            const m = bandInfo(layout, y, vh, cfg);
            target = targetFor(m, gamma, cfg);
            trace.push({ t: t / 1000, y, I: m.I, T: m.T, pace: factor * 100 });
            nextSample += cfg.SAMPLE_MS;
        }
        const tau = cfg.SMOOTH_MS || (target > factor ? cfg.SMOOTH_UP_MS : cfg.SMOOTH_DOWN_MS);
        factor += (target - factor) * Math.min(1, dt / tau);
        y += speed * factor * (dt / 16.667);
        t += dt;
    }
    return { cfg, layout, trace, seconds: t / 1000 };
}

// Scores a trace with a fixed yardstick (the reference CFG's info, so different
// CFGs are judged by the same ruler): share of time on near-empty / dense screens,
// and how long dialogue-heavy screens stay up compared to a constant-speed read.
function score(trace, layout, vh) {
    const M = trace.map((s) => bandInfo(layout, s.y, vh, DEFAULT_CFG));
    const I = M.map((m) => m.I);
    const n = trace.length;
    const empty = I.filter((v) => v < 0.12).length / n;
    const dense = I.filter((v) => v > 0.55).length / n;
    // Lettering exposure: seconds x text share (constant-speed reading of the same chapter is the yardstick),
    // and the share of lettering that goes past at >150% pace.
    const dt = trace.length > 1 ? trace[1].t - trace[0].t : 0.25;
    const textSec = M.reduce((a, m) => a + m.T * dt, 0);
    const textFast = M.reduce((a, m, i) => a + (trace[i].pace > 150 ? m.T : 0), 0) / Math.max(1e-9, M.reduce((a, m) => a + m.T, 0));
    const paces = trace.map((s) => s.pace).sort((a, b) => a - b);
    const q = (p) => Math.round(paces[Math.min(n - 1, Math.floor(p * n))]);
    let maxStep = 0; const steps = [];
    for (let i = 1; i < n; i++) { const d = Math.abs(trace[i].pace - trace[i - 1].pace); steps.push(d); maxStep = Math.max(maxStep, d); }
    steps.sort((a, b) => a - b);
    return {
        minutes: +(trace[n - 1].t / 60).toFixed(2),
        timeOnEmpty: +empty.toFixed(3), timeOnDense: +dense.toFixed(3),
        textSec: +textSec.toFixed(1), textAt150: +textFast.toFixed(3),
        pace: { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) },
        paceStep: { p95: +steps[Math.floor(0.95 * steps.length)].toFixed(1), max: +maxStep.toFixed(1) },
    };
}

module.exports = { simulate, score, bandInfo, layoutFor, DEFAULT_CFG };

if (require.main === module) {
    const o = parseArgs(process.argv.slice(2), { profiles: '', auto: 2, speed: 2, cfg: '' });
    const prof = JSON.parse(fs.readFileSync(o.profiles, 'utf8'));
    const r = simulate(prof, { auto: o.auto, speed: o.speed, cfg: o.cfg });
    console.log(JSON.stringify({ auto: o.auto, speed: o.speed, cfg: o.cfg, ...score(r.trace, r.layout, 780) }));
}
