// Scores real runs (out/runs/<name>/telemetry.json) with the simulator's yardstick:
// what was on screen (from offline profiles of the same chapter) vs how fast it went.
//
//   node report.js <run-name> [<run-name> ...]  [--profiles-dir out/analysis-w]
'use strict';
const fs = require('fs');
const path = require('path');
const { bandInfo, DEFAULT_CFG } = require('./sim');

const args = process.argv.slice(2);
const pi = args.indexOf('--profiles-dir');
const profDir = pi >= 0 ? args.splice(pi, 2)[1] : path.join(__dirname, 'out', 'analysis-w');

const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rows = [];
for (const name of args) {
    const T = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'runs', name, 'telemetry.json'), 'utf8'));
    const prof = JSON.parse(fs.readFileSync(path.join(profDir, T.opts.chapter.replace('/', '_'), 'profiles.json'), 'utf8'));
    const byN = new Map(prof.pages.map((p) => [p.n, p]));
    const layout = T.layout.map((L) => ({ ...L, rows: byN.get(L.n).rows, text: byN.get(L.n).text }));
    const tele = T.tele.filter((s) => s.t > 0.5);
    const M = tele.map((s) => bandInfo(layout, s.y, T.vh, DEFAULT_CFG));
    const n = tele.length;
    const paces = tele.map((s) => s.pace || 100);
    const steps = tele.slice(1).map((s, i) => Math.abs((s.pace || 100) - paces[i]));
    const tsum = M.reduce((a, m) => a + m.T, 0) || 1e-9;
    const last = tele[n - 1];
    rows.push({
        run: name, auto: T.opts.auto, speed: T.opts.speed, secs: Math.round(last.t), page: last.page,
        'px/s': Math.round(last.y / last.t),
        'empty%': +(100 * M.filter((m) => m.I < 0.12).length / n).toFixed(1),
        'dense%': +(100 * M.filter((m) => m.I > 0.55).length / n).toFixed(1),
        'text>150%': +(100 * M.reduce((a, m, i) => a + (paces[i] > 150 ? m.T : 0), 0) / tsum).toFixed(1),
        'pace p5/50/95': `${q(paces, 0.05)}/${q(paces, 0.5)}/${q(paces, 0.95)}`,
        'step p95/max': `${q(steps, 0.95)}/${Math.max(0, ...steps)}`,
        'unknown>0%': +(100 * tele.filter((s) => s.unknown > 0.001).length / n).toFixed(1),
        failed: last.failed, analyzed: last.analyzed,
        'ms/img': last.analyzed ? +(last.analysisMs / (last.analyzed + last.failed)).toFixed(0) : '-',
        'GM MB': +(T.net.gmBytes / 1e6).toFixed(1),
    });
}
console.table(rows);
