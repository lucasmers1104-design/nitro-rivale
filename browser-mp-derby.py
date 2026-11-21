# Mehrspieler-Test: Server starten, zwei getrennte Browser-Spieler, ein Rennen
import asyncio, subprocess, time, urllib.request, os, sys, json
from playwright.async_api import async_playwright
PORT = 8098
BASE = f'http://localhost:{PORT}'
async def main():
    srv = subprocess.Popen(['node', 'server/server.mjs'], env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(BASE + '/health', timeout=1); break
            except Exception: time.sleep(0.2)
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
            pages, errs = [], {}
            for name in ['Anna', 'Ben']:
                ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
                await ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body='', content_type='text/css'))
                pg = await ctx.new_page()
                errs[name] = []
                pg.on('pageerror', lambda e, n=name: errs[n].append('PAGE ' + str(e)))
                pg.on('console', lambda m, n=name: errs[n].append(m.text) if m.type == 'error' else None)
                await pg.add_init_script(f"localStorage.setItem('nitrorivale', JSON.stringify({{name: '{name}', gfx: 'niedrig'}}))")
                pages.append(pg)
            A, B = pages
            G = 'window.__game'
            await A.goto(BASE + '/')
            await A.wait_for_function(f'{G} && document.getElementById("menu").classList.contains("on")', timeout=180000)
            await A.evaluate(f'{G}.openMp()'); await A.click('#mpCreate')
            await A.wait_for_function('document.getElementById("lobby").classList.contains("on")', timeout=20000)
            code = await A.inner_text('#roomCode')
            print('Raum', code, flush=True)
            await B.goto(f'{BASE}/?raum={code}')
            await B.wait_for_function(f'{G} && document.getElementById("lobby").classList.contains("on") && {G}.mp.room && {G}.mp.room.players.length === 2', timeout=180000)
            await A.wait_for_function(f'{G}.mp.room.players.length === 2', timeout=10000)
            # Derby: Ben hat ein getuntes Auto, Anna stellt Derby + Klasse B ein und nimmt einen Bot mit
            await B.evaluate(f"{G}.mp.net.send('profile', {{ name: 'Ben', car: 'vipera', color: '#c8102e', sound: '', tune: {{ aero: 3, engine: 3, armor: 1, tires: 'grip' }} }})")
            await A.evaluate(f"{G}.lobby.fill = false; {G}.mp.net.send('settings', {{ mode: 'derby', cls: 'B', fill: false }})")
            await A.wait_for_timeout(400)
            await A.click('.slot.empty')
            await B.wait_for_function(f'{G}.mp.room.bots.length === 1 && {G}.mp.room.settings.mode === "derby"', timeout=10000)
            await A.wait_for_timeout(600)
            await A.screenshot(path='shots/mpd1-lobbyA.png')
            print('Lobby-Text:', await A.inner_text('#lbModeTxt'), '|', await A.evaluate("[...document.querySelectorAll('.slot .cr')].map(e => e.innerText).join(' / ')"), flush=True)
            await A.click('#lbStart')
            for pg in pages: await pg.wait_for_function(f'{G}.race && {G}.race.net && {G}.race.phase === "running"', timeout=300000)
            print('Derby läuft bei beiden, Variante:', await A.evaluate(f'{G}.race.variant'), '| Ben gedrosselt:', await B.evaluate(f'{G}.player.restrict.toFixed(2)'), '| Ben-Flügel bei Anna:', await A.evaluate(f"!!{G}.race.entries.find(e => e.name === 'Ben').car.parts.find(p => p.id === 'spoiler')"), flush=True)
            for pg in pages: await pg.evaluate(f'{G}.autopilot("profi"); {G}.simMul = 2')
            await A.wait_for_timeout(8000)
            await A.screenshot(path='shots/mpd2-derbyA.png')
            for pg in pages: await pg.wait_for_function('document.getElementById("results").classList.contains("on")', timeout=600000)
            for pg in pages: await pg.wait_for_function(f'{G}.mp.ended', timeout=180000)
            await A.wait_for_timeout(800)
            await A.screenshot(path='shots/mpd3-resultsA.png')
            for pg, n in zip(pages, 'AB'):
                print(n, 'Derby-Ergebnis:', await pg.evaluate("[...document.querySelectorAll('#resTable div:not(.h)')].map(d => d.innerText.replace(/\\s+/g,' ')).join(' | ')"), flush=True)
            print('Fehler A:', errs['Anna'][:6]); print('Fehler B:', errs['Ben'][:6])
            await b.close()
    finally:
        srv.terminate()
        out = srv.communicate(timeout=5)[0]
        print('--- Server ---'); print(out[-1500:])
asyncio.run(main())
