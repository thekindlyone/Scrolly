// ==UserScript==
// @name         Scrolly decode probe
// @namespace    scrolly-dev
// @version      0.1
// @description  Dev only: which ways of decoding a GM_xmlhttpRequest image give readable canvas pixels
// @match        *://weebcentral.com/chapters/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      official.lowee.us
// @connect      *
// ==/UserScript==

(function () {
    'use strict';
    const out = {};
    const done = () => {
        const el = document.createElement('pre');
        el.id = 'tm-probe';
        el.textContent = JSON.stringify(out);
        document.body.appendChild(el);
    };

    function gm(url, responseType) {
        return new Promise((res, rej) => GM_xmlhttpRequest({
            method: 'GET', url, responseType, headers: { Referer: location.href },
            onload: (r) => (r.status === 200 ? res(r.response) : rej(new Error('HTTP ' + r.status))),
            onerror: () => rej(new Error('download failed')),
        }));
    }

    function loadImg(src, Img) {
        return new Promise((res, rej) => {
            const im = new Img();
            im.onload = () => res(im);
            im.onerror = () => rej(new Error('img load failed'));
            im.src = src;
        });
    }

    // Read a few pixels; return a checksum so blank/randomised data shows up too
    function read(source, canvasKind) {
        let c;
        if (canvasKind === 'offscreen') c = new OffscreenCanvas(50, 50);
        else if (canvasKind === 'page-offscreen') c = new unsafeWindow.OffscreenCanvas(50, 50);
        else { c = document.createElement('canvas'); c.width = 50; c.height = 50; }
        const x = c.getContext('2d');
        x.drawImage(source, 0, 0, 50, 50);
        const d = x.getImageData(0, 0, 50, 50).data;
        let s = 0;
        for (let i = 0; i < d.length; i++) s = (s * 31 + d[i]) >>> 0;
        return 'ok ' + s;
    }

    async function attempt(name, fn) {
        try { out[name] = await fn(); } catch (e) { out[name] = 'ERR ' + (e && e.name) + ': ' + ((e && e.message) || e); }
    }

    async function run(img) {
        const url = img.currentSrc;
        out.url = url;
        const blob = await gm(url, 'blob');
        const ab = await gm(url, 'arraybuffer');
        out.blobType = Object.prototype.toString.call(blob) + ' ' + blob.type + ' ' + blob.size;
        out.abType = Object.prototype.toString.call(ab) + ' ' + (ab && ab.byteLength);

        await attempt('direct img', () => read(img));
        await attempt('bitmap(gm blob)', async () => read(await createImageBitmap(blob)));
        await attempt('bitmap(gm blob) offscreen', async () => read(await createImageBitmap(blob), 'offscreen'));
        await attempt('bitmap(new Blob(ab))', async () => read(await createImageBitmap(new Blob([ab], { type: 'image/png' }))));
        await attempt('bitmap(new Blob(blob.arrayBuffer()))', async () => read(await createImageBitmap(new Blob([await blob.arrayBuffer()], { type: blob.type }))));
        await attempt('page bitmap(page Blob(ab))', async () => {
            const pb = new unsafeWindow.Blob([new unsafeWindow.Uint8Array(new Uint8Array(ab))], { type: 'image/png' });
            return read(await unsafeWindow.createImageBitmap(pb));
        });
        await attempt('objectURL(gm blob) img', async () => read(await loadImg(URL.createObjectURL(blob), Image)));
        await attempt('objectURL(new Blob(ab)) img', async () => read(await loadImg(URL.createObjectURL(new Blob([ab], { type: 'image/png' })), Image)));
        await attempt('page objectURL(page Blob) page img', async () => {
            const pb = new unsafeWindow.Blob([new unsafeWindow.Uint8Array(new Uint8Array(ab))], { type: 'image/png' });
            return read(await loadImg(unsafeWindow.URL.createObjectURL(pb), unsafeWindow.Image));
        });
        await attempt('dataURL img', async () => {
            const u8 = new Uint8Array(ab);
            let bin = '';
            for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return read(await loadImg('data:image/png;base64,' + btoa(bin), Image));
        });
        await attempt('ImageDecoder', async () => {
            if (typeof ImageDecoder === 'undefined') return 'n/a';
            const dec = new ImageDecoder({ data: ab, type: 'image/png' });
            const { image } = await dec.decode();
            try { return read(image); } finally { image.close(); }
        });
    }

    // wait for a loaded page image
    const t0 = Date.now();
    const iv = setInterval(() => {
        const img = [...document.querySelectorAll('img')].find((i) => /^Page /.test(i.alt || '') && i.complete && i.naturalWidth);
        if (img || Date.now() - t0 > 30000) {
            clearInterval(iv);
            if (!img) { out.error = 'no loaded page image'; done(); return; }
            run(img).catch((e) => { out.error = String(e); }).then(done);
        }
    }, 500);
})();
