// ==UserScript==
// @name         Weeb Central page dump (one-off, for testing the auto scroller)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a "Dump" button. Saves the rendered chapter page plus lazy-load facts as a JSON download.
// @match        *://weebcentral.com/chapters/*
// @match        *://*.weebcentral.com/chapters/*
// @noframes
// @grant        none
// ==/UserScript==

// Use: open a chapter in Long Strip mode, wait for the first pages to show,
// tap "Dump" (bottom-left), and send the downloaded weebcentral-dump-*.json file.
// It only reads this page; nothing is sent anywhere. Disable it afterwards.
(function () {
    'use strict';

    // Snapshot of every page image right now: is it loaded, and does it
    // already take up space on the page before loading (decides "unknown" gaps)?
    function imgFacts() {
        return Array.from(document.querySelectorAll('img'), (img) => {
            const r = img.getBoundingClientRect();
            const attrs = {};
            for (const a of img.attributes) attrs[a.name] = a.value.length > 300 ? a.value.slice(0, 300) + '…' : a.value;
            return {
                attrs,
                currentSrc: img.currentSrc,
                complete: img.complete,
                natural: [img.naturalWidth, img.naturalHeight],
                rect: { top: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
            };
        });
    }

    function dump() {
        const data = {
            url: location.href,
            when: new Date().toISOString(),
            userAgent: navigator.userAgent,
            viewport: [innerWidth, innerHeight, devicePixelRatio],
            scrollY,
            scrollHeight: document.documentElement.scrollHeight,
            images: imgFacts(),
            html: document.documentElement.outerHTML,
        };
        const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'weebcentral-dump-' + Date.now() + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        btn.textContent = 'Saved ✓';
        setTimeout(() => { btn.textContent = 'Dump'; }, 2000);
    }

    const btn = document.createElement('button');
    btn.textContent = 'Dump';
    btn.style.cssText = 'position:fixed;left:12px;bottom:20px;z-index:9999999;padding:10px 14px;' +
        'border-radius:20px;border:none;background:#2a6;color:#fff;font:bold 14px sans-serif;';
    btn.addEventListener('click', dump);
    document.body.appendChild(btn);
})();
