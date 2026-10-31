// Behaviour checks for things the script must keep doing:
//  - a touch outside the widget pauses scrolling; touches on the widget don't
//  - the screen wake lock is held while scrolling and released on pause
//  - speed and auto level persist through GM_setValue
//  - stops at the bottom of the chapter
//
//   node checks.js
'use strict';
const { openReader, injectScript } = require('./lib');

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

(async () => {
    const { browser, context, page } = await openReader({
        chapter: 'the-extras-academy-survival-guide/0003', seed: { auto_level: 2, scroll_speed: 2 }, latencyMs: 0,
    });
    // Record wake lock use (headless Chromium has no real wake lock).
    await page.evaluate(() => {
        window.__wl = { requests: 0, releases: 0, held: false };
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
            request: async () => { __wl.requests++; __wl.held = true;
                return { release: async () => { __wl.releases++; __wl.held = false; } }; },
        } });
        // Expose the GM store for persistence checks.
        const set = window.GM_setValue; window.__gm = {};
        window.GM_setValue = (k, v) => { window.__gm[k] = v; set(k, v); };
    });
    await injectScript(page);
    const playing = () => page.evaluate(() => document.getElementById('tm-scroll-play').textContent === '⏸');
    const box = async (sel) => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

    await page.mouse.click(...(await box('#tm-scroll-play')));
    await page.waitForTimeout(1500);
    check('mouse click on play starts scrolling', await playing(), `scrollY=${await page.evaluate(() => scrollY)}`);
    check('wake lock held while scrolling', await page.evaluate(() => __wl.held && __wl.requests === 1));

    await page.touchscreen.tap(...(await box('#tm-scroll-inc')));
    await page.waitForTimeout(300);
    check('tap on widget (+) keeps scrolling', await playing());
    check('speed persisted via GM_setValue', await page.evaluate(() => window.__gm.scroll_speed === 2.5));

    await page.touchscreen.tap(...(await box('#tm-scroll-auto')));
    check('auto level cycles and persists (A2 -> A3)', await page.evaluate(() =>
        window.__gm.auto_level === 3 && document.getElementById('tm-scroll-auto').textContent === 'A3'));

    await page.touchscreen.tap(200, 300);
    await page.waitForTimeout(300);
    check('tap outside widget pauses', !(await playing()));
    check('wake lock released on pause', await page.evaluate(() => !__wl.held && __wl.releases === 1));
    const y0 = await page.evaluate(() => scrollY);
    await page.waitForTimeout(800);
    check('no movement while paused', (await page.evaluate(() => scrollY)) === y0);

    // Jump near the end and let it run off the bottom.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight - innerHeight - 300));
    await page.mouse.click(...(await box('#tm-scroll-play')));
    await page.waitForTimeout(6000);
    check('stops by itself at the bottom', !(await playing()));

    await browser.close();
    const failed = results.filter((r) => !r.ok).length;
    console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
    process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
