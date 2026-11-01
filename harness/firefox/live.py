"""Real Firefox + real Tampermonkey on the live Weeb Central site.

Installs Tampermonkey (temporary add-on), installs the userscript through
Tampermonkey's own install page, opens a chapter, presses play with a mouse
click and reads the diagnostics popup (tap on the speed text -> alert()).

Setup (once): see README.md in this folder.

    python live.py --script http://127.0.0.1:8765/auto-scroller.user.js --secs 60
"""
import argparse, json, os, sys, time
from selenium import webdriver
from selenium.common.exceptions import NoAlertPresentException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait

TOOLS = os.environ.get('SCROLLY_FF', os.path.expanduser('~/.cache/scrolly-ff'))
CHAPTER = 'https://weebcentral.com/chapters/01JNKHAKGPTVWQVB69ETXT01F2'
ANDROID_UA = 'Mozilla/5.0 (Android 14; Mobile; rv:159.0) Gecko/159.0 Firefox/159.0'

ap = argparse.ArgumentParser()
ap.add_argument('--script', default='http://127.0.0.1:8765/auto-scroller.user.js')
ap.add_argument('--chapter', default=CHAPTER)
ap.add_argument('--secs', type=float, default=60)
ap.add_argument('--every', type=float, default=5, help='seconds between diagnostics reads')
ap.add_argument('--mobile', action='store_true', help='Android Firefox UA')
ap.add_argument('--headed', action='store_true')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'out', 'firefox'))
ap.add_argument('--probe', help='install this probe userscript instead and print its #tm-probe result')
ap.add_argument('--pref', action='append', default=[], help='extra Firefox pref name=json-value')
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


opts = Options()
opts.binary_location = f'{TOOLS}/firefox/firefox'
if not args.headed:
    opts.add_argument('-headless')
opts.add_argument('--width=378')
opts.add_argument('--height=771')
opts.page_load_strategy = 'none'  # Tampermonkey takes over .user.js navigations; don't wait on them
if args.mobile:
    opts.set_preference('general.useragent.override', ANDROID_UA)
for p in args.pref:
    k, v = p.split('=', 1)
    opts.set_preference(k, json.loads(v))
# Extension pages are "privileged"; the install page can only be driven with system access.
d = webdriver.Firefox(options=opts, service=Service(f'{TOOLS}/geckodriver', service_args=['--allow-system-access']))
d.set_window_size(378, 771)


def wait(cond, secs=30, step=0.5):
    end = time.time() + secs
    while time.time() < end:
        try:
            v = cond()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    return None


def install_script():
    d.install_addon(f'{TOOLS}/tm.xpi', temporary=True)
    main = d.window_handles[0]
    time.sleep(2)
    before = set(d.window_handles)
    d.switch_to.window(main)
    d.get(args.script)

    def find_install():
        for h in d.window_handles:
            d.switch_to.window(h)
            if d.current_url.startswith('moz-extension://') and 'ask.html' in d.current_url:
                for el in d.find_elements(By.CSS_SELECTOR, 'input[type=button],button'):
                    if (el.get_attribute('value') or el.text).strip() == 'Install':
                        return el
        return None

    btn = wait(find_install, 30)
    if not btn:
        raise SystemExit('Tampermonkey install page not found')
    btn.click()
    time.sleep(2)
    # close every tab but one and go back to it
    for h in d.window_handles:
        if h != main:
            d.switch_to.window(h)
            d.close()
    d.switch_to.window(main)
    log('script installed from', args.script)


def page_state():
    return d.execute_script('''
        const imgs = [...document.querySelectorAll('img')].filter(i => /^Page /.test(i.alt || ''));
        return { title: document.title, url: location.href, pageImgs: imgs.length,
                 loaded: imgs.filter(i => i.complete && i.naturalWidth).length,
                 widget: !!document.getElementById('tm-scroll-widget'),
                 scrollY: Math.round(scrollY), scrollH: document.documentElement.scrollHeight,
                 pace: (document.getElementById('tm-scroll-pace') || {}).textContent,
                 auto: (document.getElementById('tm-scroll-auto') || {}).textContent,
                 bodyStart: document.body ? document.body.innerText.slice(0, 200) : '' };''')


def read_diag():
    d.find_element(By.ID, 'tm-scroll-label').click()
    a = wait(lambda: d.switch_to.alert, 5, 0.1)
    if not a:
        return None
    txt = a.text
    a.accept()
    return txt


if args.probe:
    args.script = args.probe
install_script()
d.get(args.chapter)
if args.probe:
    res = wait(lambda: d.find_element(By.ID, 'tm-probe').text, 90)
    for k, v in json.loads(res or '{}').items():
        print(f'{k:40} {v}')
    d.quit()
    sys.exit(0)
st = wait(lambda: (lambda s: s if s['widget'] and s['pageImgs'] else None)(page_state()), 45)
st = st or page_state()
log('page', json.dumps(st))
d.save_screenshot(os.path.join(args.out, 'start.png'))
if not st['widget'] or not st['pageImgs']:
    log('no widget or no page images; stopping (bot check? not Long Strip?)')
    d.quit()
    sys.exit(1)

log('initial diagnostics:\n' + (read_diag() or '(no alert)'))
d.find_element(By.ID, 'tm-scroll-play').click()  # a mouse click; a touch would pause it
t0 = time.time()
paces = []
while time.time() - t0 < args.secs:
    time.sleep(args.every)
    st = page_state()
    paces.append(st['pace'])
    diag = read_diag()
    log(f"t={time.time() - t0:.0f}s y={st['scrollY']}/{st['scrollH']} pace={st['pace']} auto={st['auto']}\n" + (diag or '(no alert)'))
d.save_screenshot(os.path.join(args.out, 'end.png'))
log('paces seen:', paces)
d.quit()
