// ==UserScript==
// @name         Webtoon/Manga Auto Scroller
// @namespace    http://tampermonkey.net/
// @version      3.3
// @description  Auto-scroll that speeds through empty panels and slows down on busy art and dialogue
// @author       You
// @match        *://weebcentral.com/chapters/*
// @match        *://*.weebcentral.com/chapters/*
// @noframes
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    // ---------------- Tunables ----------------
    // Calibrated on Weeb Central: The Extra's Academy ep. 3 (800px wide) and Solo Leveling: Ragnarok ch. 1 and 10 (940px).
    const CFG = {
        BAND_TOP: 0.10,         // part of the screen that counts as "being read"
        BAND_BOTTOM: 0.95,      // (lower half weighted more, so slowdown starts as content arrives)
        STRIPS: 48,             // resolution of the on-screen measurement
        INFO_REF: 0.33,         // typical screen "information" -> base speed (chapter median)
        INFO_EPS: 0.08,         // softens the curve so empty screens don't go to infinity
        MIN_FACTOR: 0.3,        // slowest: 30% of base speed
        MAX_FACTOR: 3.5,        // fastest: 350% of base speed
        TEXT_WEIGHT: 2,         // speech-bubble text counts double vs. art
        TEXT_REF: 0.0125,       // lettering (share of band cells, ~one 4-line bubble) that caps speed at 1x;
                                // half as much allows 2x. Keeps a lone bubble on a blank frame from being rushed.
        TEXT_TOP: 0.35,         // lettering above this screen height has already been read; don't let it hold speed down
        CHARS_REF: 600,         // HTML characters in the band that count as information 1
        SMOOTH_UP_MS: 900,      // speeding up eases in gently...
        SMOOTH_DOWN_MS: 350,    // ...slowing down for arriving content is quicker
        SAMPLE_MS: 250,         // how often the screen is re-measured
        ANALYSIS_W: 200,        // images are downscaled to this width for analysis
        CELL: 5,                // analysis cell size (px at analysis scale)
        EDGE_DIFF: 40,          // luminance jump that counts as an edge
        FLAT_VAR: 30,           // cells with less variance than this are "empty"
        EDGE_SAT: 0.25,         // edge density at which a cell counts as fully busy
        CHUNK_H: 2048,          // process tall strips in slices (mobile memory)
        MIN_IMG_W_FRAC: 0.3,    // ignore images narrower than 30% of the screen
        MIN_IMG_H: 150,         // ...or shorter than this (icons, ads)
        ALLOW_REFETCH: true,    // re-download cross-origin images so pixels can be read
    };
    // Auto strength (curve exponent): off, gentle, normal, strong
    const LEVELS = [0, 0.6, 1, 1.4];

    let speed = parseFloat(GM_getValue('scroll_speed', 2));
    let autoLevel = parseInt(GM_getValue('auto_level', 2), 10) || 0;
    let isScrolling = false;
    let animId = null;
    let sampleTimer = null;
    let accumulatedDistance = 0;
    let lastTs = 0;
    let factor = 1;
    let targetFactor = 1;
    let wakeLock = null;

    // Read-only stats for test harnesses (harmless inside Tampermonkey's sandbox)
    const DBG = { info: 0, text: 0, unknown: 0, queue: 0, analyzed: 0, failed: 0, analysisMs: 0 };
    try { window.__tmScroll = DBG; } catch (e) { /* ignore */ }
    // Dev only: lets a test harness ask for the per-cell classification of an image.
    try { if (window.__tmScrollDev) DBG.profile = (src, w, h) => { const cells = []; return { ...profileFrom(src, w, h, cells), cells }; }; } catch (e) { /* ignore */ }

    // ---------------- Wake lock ----------------
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
            // Can fail if battery saver is active
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().catch(() => {});
            wakeLock = null;
        }
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && isScrolling) requestWakeLock();
    });

    // ---------------- UI ----------------
    const panel = document.createElement('div');
    panel.id = 'tm-scroll-widget';
    panel.innerHTML = `
        <button id="tm-scroll-dec" class="tm-btn">-</button>
        <span id="tm-scroll-label">
            <span id="tm-scroll-speed">${speed}x</span>
            <span id="tm-scroll-pace"></span>
        </span>
        <button id="tm-scroll-inc" class="tm-btn">+</button>
        <button id="tm-scroll-auto" class="tm-btn" title="Adaptive speed: off / gentle / normal / strong">A</button>
        <button id="tm-scroll-play" class="tm-btn">▶</button>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #tm-scroll-widget {
            position: fixed;
            bottom: 20px;
            right: 15px;
            z-index: 9999999;
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(18, 18, 18, 0.85);
            backdrop-filter: blur(4px);
            padding: 6px 10px;
            border-radius: 25px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            border: 1px solid rgba(255,255,255,0.15);
            user-select: none;
            touch-action: manipulation;
        }
        .tm-btn {
            background: rgba(255, 255, 255, 0.15);
            color: #fff;
            border: none;
            border-radius: 50%;
            width: 32px;
            height: 32px;
            font-size: 14px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            outline: none;
            padding: 0;
        }
        .tm-btn:active { background: rgba(255, 255, 255, 0.35); }
        #tm-scroll-auto.tm-off { opacity: 0.45; }
        #tm-scroll-label {
            display: flex;
            flex-direction: column;
            align-items: center;
            min-width: 38px;
            line-height: 1.1;
        }
        #tm-scroll-speed { color: #fff; font-size: 13px; font-family: monospace; }
        #tm-scroll-pace { color: #f5c451; font-size: 10px; font-family: monospace; }
        #tm-scroll-pace:empty { display: none; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    const $ = (id) => document.getElementById(id);

    function updateAutoBtn() {
        const btn = $('tm-scroll-auto');
        btn.textContent = autoLevel ? 'A' + autoLevel : 'A';
        btn.classList.toggle('tm-off', !autoLevel);
        $('tm-scroll-pace').textContent = autoLevel ? Math.round(factor * 100) + '%' : '';
    }

    // ---------------- Scrolling ----------------
    function scrollStep(ts) {
        if (!isScrolling) return;

        // Frame-rate independent: `speed` keeps its old meaning (px per frame at 60 Hz)
        const dt = lastTs ? Math.min(50, ts - lastTs) : 16.667;
        lastTs = ts;
        const tau = targetFactor > factor ? CFG.SMOOTH_UP_MS : CFG.SMOOTH_DOWN_MS;
        factor += (targetFactor - factor) * Math.min(1, dt / tau);

        accumulatedDistance += speed * factor * (dt / 16.667);
        if (accumulatedDistance >= 1) {
            const px = Math.floor(accumulatedDistance);
            window.scrollBy(0, px);
            accumulatedDistance -= px;
        }

        const atBottom = (window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 5);
        if (atBottom) {
            toggleScroll(false);
            return;
        }
        animId = requestAnimationFrame(scrollStep);
    }

    function toggleScroll(forceState) {
        isScrolling = forceState !== undefined ? forceState : !isScrolling;
        $('tm-scroll-play').textContent = isScrolling ? '⏸' : '▶';

        if (isScrolling) {
            accumulatedDistance = 0;
            lastTs = 0;
            sample();
            factor = targetFactor;
            sampleTimer = setInterval(sample, CFG.SAMPLE_MS);
            requestWakeLock();
            animId = requestAnimationFrame(scrollStep);
        } else {
            cancelAnimationFrame(animId);
            clearInterval(sampleTimer);
            releaseWakeLock();
        }
    }

    function changeSpeed(delta) {
        speed = Math.max(0.2, Math.min(25, parseFloat((speed + delta).toFixed(1))));
        GM_setValue('scroll_speed', speed);
        $('tm-scroll-speed').textContent = speed + 'x';
    }

    function cycleAuto() {
        autoLevel = (autoLevel + 1) % LEVELS.length;
        GM_setValue('auto_level', autoLevel);
        if (autoLevel) nearImgs.forEach((img) => { loadEarly(img); enqueue(img); });
        sample();
        updateAutoBtn();
    }

    // ---------------- Measuring what's on screen ----------------
    const visibleText = new Set();
    const nearImgs = new Set();
    const profiles = new WeakMap(); // img -> { src, prof: { info, text } (Float32Array per cell row) | null }

    function sample() {
        const gamma = LEVELS[autoLevel];
        if (gamma) {
            const { I, T } = measureInfo();
            const raw = Math.pow((CFG.INFO_REF + CFG.INFO_EPS) / (I + CFG.INFO_EPS), gamma);
            const textCap = T > 0 ? Math.max(1, CFG.TEXT_REF / T) : Infinity;
            targetFactor = Math.max(CFG.MIN_FACTOR, Math.min(CFG.MAX_FACTOR, textCap, raw));
        } else {
            targetFactor = 1;
        }
        if (!isScrolling) factor = targetFactor;
        $('tm-scroll-pace').textContent = gamma ? Math.round(factor * 100) + '%' : '';
    }

    function isLoaded(img) {
        return img.complete && img.naturalWidth > 0;
    }

    // Weeb Central gives not-yet-loaded pages no width/height, only a 50vh-tall,
    // zero-width placeholder. Those count as unknown content, not as an empty gap.
    function isCandidate(img, r) {
        if (!isLoaded(img)) return r.height >= CFG.MIN_IMG_H;
        return r.width >= window.innerWidth * CFG.MIN_IMG_W_FRAC && r.height >= CFG.MIN_IMG_H;
    }

    // Firefox only starts lazy images a few hundred px ahead, too late to analyse
    // them before they scroll in. Load the ones within the look-ahead now.
    function loadEarly(img) {
        if (LEVELS[autoLevel] && img.loading === 'lazy') img.loading = 'eager';
    }

    function avgRows(rows, f0, f1) {
        const n = rows.length;
        const rs = Math.max(0, f0 * n), re = Math.min(n, f1 * n);
        if (re <= rs) return 0;
        let sum = 0;
        for (let i = Math.floor(rs); i < Math.ceil(re); i++) {
            sum += rows[i] * (Math.min(i + 1, re) - Math.max(i, rs));
        }
        return sum / (re - rs);
    }

    function directTextLength(el) {
        let n = 0;
        for (const c of el.childNodes) {
            if (c.nodeType === 3) n += c.data.replace(/\s+/g, '').length;
        }
        return n;
    }

    // Weighted average "information" over the reading band. Empty gaps count as 0;
    // images not analysed yet count as typical (so it never rushes into unknown content).
    function measureInfo() {
        const vh = window.innerHeight;
        const N = CFG.STRIPS;
        const bt = vh * CFG.BAND_TOP, bb = vh * CFG.BAND_BOTTOM, sh = (bb - bt) / N;
        const acc = new Float32Array(N);
        const txt = new Float32Array(N);
        let unknown = 0;

        for (const img of nearImgs) {
            const r = img.getBoundingClientRect();
            if (r.bottom <= bt || r.top >= bb || r.height <= 0 || !isCandidate(img, r)) continue;
            const p = profiles.get(img);
            const fresh = p && p.src === img.currentSrc;
            if (!fresh) enqueue(img);
            const prof = fresh ? p.prof : null;
            for (let s = 0; s < N; s++) {
                const y0 = bt + s * sh, y1 = y0 + sh;
                const o0 = Math.max(y0, r.top), o1 = Math.min(y1, r.bottom);
                if (o1 <= o0) continue;
                const cover = (o1 - o0) / sh;
                if (!prof) { unknown += cover; acc[s] += CFG.INFO_REF * cover; continue; }
                const f0 = (o0 - r.top) / r.height, f1 = (o1 - r.top) / r.height;
                acc[s] += avgRows(prof.info, f0, f1) * cover;
                txt[s] += avgRows(prof.text, f0, f1) * cover;
            }
        }

        const perStripChars = CFG.CHARS_REF / N;
        for (const el of visibleText) {
            const r = el.getBoundingClientRect();
            if (r.height <= 0 || r.bottom <= bt || r.top >= bb) continue;
            const chars = directTextLength(el);
            if (!chars) continue;
            for (let s = 0; s < N; s++) {
                const y0 = bt + s * sh, y1 = y0 + sh;
                const ov = Math.min(y1, r.bottom) - Math.max(y0, r.top);
                if (ov <= 0) continue;
                const v = (chars * ov / r.height) / perStripChars;
                acc[s] += v;
                txt[s] += v; // page text is something to read too
            }
        }

        let sum = 0, tsum = 0, wsum = 0;
        for (let s = 0; s < N; s++) {
            const y = (bt + (s + 0.5) * sh) / vh;
            const w = y < 0.5 ? 1 : 1 + (y - 0.5); // look ahead: lower part weighs more
            sum += acc[s] * w;
            if (y >= CFG.TEXT_TOP) tsum += txt[s] * w;
            wsum += w;
        }
        const I = sum / wsum, T = tsum / wsum;
        DBG.info = I;
        DBG.text = T;
        DBG.unknown = unknown / N;
        DBG.queue = queue.length;
        return { I, T };
    }

    // ---------------- Image analysis ----------------
    const queue = [];
    const queued = new WeakSet();
    const directBlocked = new Set();
    let working = false;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    function enqueue(img) {
        if (!LEVELS[autoLevel] || queued.has(img)) return;
        const p = profiles.get(img);
        if (p && p.src === img.currentSrc) return;
        if (!isLoaded(img)) return; // 'load' listener retries
        if (!isCandidate(img, img.getBoundingClientRect())) return;
        queued.add(img);
        queue.push(img);
        pump();
    }

    function pump() {
        if (working || !queue.length) return;
        working = true;
        const img = queue.shift();
        const idle = window.requestIdleCallback || ((f) => setTimeout(f, 30));
        idle(async () => {
            const src = img.currentSrc;
            let prof = null;
            const t0 = performance.now();
            try { prof = await analyze(img); } catch (e) { /* unreadable: treated as typical */ }
            DBG.analysisMs += performance.now() - t0;
            if (prof) DBG.analyzed++; else DBG.failed++;
            profiles.set(img, { src, prof });
            queued.delete(img);
            working = false;
            pump();
        }, { timeout: 500 });
    }

    async function analyze(img) {
        const src = img.currentSrc;
        const origin = new URL(src, location.href).origin;
        if (!directBlocked.has(origin)) {
            try {
                return profileFrom(img, img.naturalWidth, img.naturalHeight);
            } catch (e) {
                if (e.name !== 'SecurityError') throw e;
                directBlocked.add(origin);
            }
        }
        if (!CFG.ALLOW_REFETCH || src.startsWith('blob:')) return null;
        const bmp = await fetchBitmap(src);
        try {
            return profileFrom(bmp, bmp.width, bmp.height);
        } finally {
            if (bmp.close) bmp.close();
        }
    }

    function fetchBitmap(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                responseType: 'blob',
                headers: { Referer: location.href },
                timeout: 20000,
                onload: (r) => (r.status >= 200 && r.status < 300 && r.response)
                    ? createImageBitmap(r.response).then(resolve, reject)
                    : reject(new Error('HTTP ' + r.status)),
                onerror: reject,
                ontimeout: reject,
            });
        });
    }

    // Per row of cells: share of busy (non-flat, edgy) cells + weighted share of text-like cells.
    function profileFrom(source, nw, nh, devCells) {
        const C = CFG.CELL;
        const aw = Math.min(CFG.ANALYSIS_W, nw);
        const scale = aw / nw;
        const ah = Math.max(1, Math.round(nh * scale));
        const cols = Math.floor(aw / C);
        const nRows = Math.ceil(ah / C);
        const info = new Float32Array(nRows);
        const textRows = new Float32Array(nRows);
        if (!cols) return { info, text: textRows };

        canvas.width = aw;
        const chunkCells = Math.floor(CFG.CHUNK_H / C);

        for (let r0 = 0; r0 < nRows; r0 += chunkCells) {
            const y0 = r0 * C;
            const hh = Math.min(chunkCells * C, ah - y0);
            canvas.height = hh;
            ctx.drawImage(source, 0, y0 / scale, nw, hh / scale, 0, 0, aw, hh);
            const d = ctx.getImageData(0, 0, aw, hh).data; // throws SecurityError if tainted

            const rc = Math.ceil(hh / C);
            const busy = new Float32Array(rc * cols);
            const texty = new Uint8Array(rc * cols);
            for (let cy = 0; cy < rc; cy++) {
                for (let cx = 0; cx < cols; cx++) {
                    cellStats(d, aw, hh, cx * C, cy * C, C, busy, texty, cy * cols + cx);
                }
            }
            for (let cy = 0; cy < rc; cy++) {
                let art = 0, text = 0;
                const devRow = devCells ? [] : null;
                for (let cx = 0; cx < cols; cx++) {
                    const i = cy * cols + cx;
                    art += busy[i];
                    // Lettering comes in horizontal runs. Requiring a left/right neighbour drops
                    // isolated hits and vertical lines (panel borders, bubble sides).
                    const t = texty[i] && ((cx > 0 && texty[i - 1]) || (cx < cols - 1 && texty[i + 1]));
                    if (t) text++;
                    if (devRow) devRow.push(t ? 2 : busy[i] > 0 ? 1 : 0);
                }
                info[r0 + cy] = (art + CFG.TEXT_WEIGHT * text) / cols;
                textRows[r0 + cy] = text / cols;
                if (devRow) devCells.push(devRow);
            }
        }
        return { info, text: textRows };
    }

    function cellStats(d, w, h, x0, y0, C, busy, texty, idx) {
        let light = 0, dark = 0, edges = 0, n = 0, pairs = 0, s = 0, s2 = 0;
        const x1 = Math.min(x0 + C, w), y1 = Math.min(y0 + C, h);
        for (let y = y0; y < y1; y++) {
            let prev = -1;
            for (let x = x0; x < x1; x++) {
                const i = (y * w + x) * 4;
                const L = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
                if (L > 190) light++;
                else if (L < 110) dark++;
                s += L;
                s2 += L * L;
                if (prev >= 0) {
                    pairs++;
                    if (Math.abs(L - prev) > CFG.EDGE_DIFF) edges++;
                }
                prev = L;
                n++;
            }
        }
        if (!n || !pairs) return;
        const mean = s / n;
        const ef = edges / pairs;
        if (s2 / n - mean * mean >= CFG.FLAT_VAR) busy[idx] = Math.min(1, ef / CFG.EDGE_SAT);

        const lf = light / n, df = dark / n;
        const major = Math.max(lf, df), minor = Math.min(lf, df);
        if (lf + df >= 0.6 && ef >= 0.12 && major >= 0.45 && minor >= 0.05 && minor <= 0.45) texty[idx] = 1;
    }

    // ---------------- Element discovery ----------------
    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TEMPLATE']);
    const seenText = new WeakSet();
    const seenImg = new WeakSet();

    const textIO = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) visibleText.add(e.target);
            else visibleText.delete(e.target);
        }
    });

    // Watch images a few screens ahead so they're analysed before they arrive
    const imgIO = new IntersectionObserver((entries) => {
        for (const e of entries) {
            if (e.isIntersecting) { nearImgs.add(e.target); loadEarly(e.target); enqueue(e.target); }
            else nearImgs.delete(e.target);
        }
    }, { rootMargin: '100% 0px 300% 0px' });

    function observeImg(img) {
        if (seenImg.has(img)) return;
        seenImg.add(img);
        imgIO.observe(img);
        img.addEventListener('load', () => { if (nearImgs.has(img)) enqueue(img); });
    }

    function scan(root) {
        if (!root || root.nodeType !== 1 || panel.contains(root)) return;
        if (root.tagName === 'IMG') observeImg(root);
        root.querySelectorAll('img').forEach(observeImg);

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const p = node.parentElement;
            if (!p || seenText.has(p) || SKIP_TAGS.has(p.tagName) || panel.contains(p)) continue;
            if (!/\S/.test(node.data)) continue;
            seenText.add(p);
            textIO.observe(p);
        }
    }

    let pending = new Set();
    let mutTimer = null;
    new MutationObserver((muts) => {
        for (const m of muts) {
            for (const n of m.addedNodes) pending.add(n.nodeType === 3 ? n.parentElement : n);
        }
        if (!mutTimer) {
            mutTimer = setTimeout(() => {
                mutTimer = null;
                const list = pending;
                pending = new Set();
                list.forEach((n) => n && n.isConnected && scan(n));
            }, 400);
        }
    }).observe(document.body, { childList: true, subtree: true });

    // ---------------- Wire up ----------------
    $('tm-scroll-play').addEventListener('click', () => toggleScroll());
    $('tm-scroll-inc').addEventListener('click', () => changeSpeed(0.5));
    $('tm-scroll-dec').addEventListener('click', () => changeSpeed(-0.5));
    $('tm-scroll-auto').addEventListener('click', cycleAuto);

    window.addEventListener('touchstart', (e) => {
        if (!panel.contains(e.target) && isScrolling) toggleScroll(false);
    }, { passive: true });

    updateAutoBtn();
    scan(document.body);
})();
