# Mehrspieler-Test: Server starten, zwei getrennte Browser-Spieler, ein Rennen
import asyncio, subprocess, time, urllib.request, os, sys, json
from playwright.async_api import async_playwright
PORT = 8097
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
            await A.evaluate(f"{G}.sp.laps = 1; {G}.lobby.fill = false; {G}.mp.net.send('settings', {{ laps: 1, level: 'tal', fill: false }})")
            await A.wait_for_timeout(400)
            await A.click('.slot.empty')
            await B.wait_for_function(f'{G}.mp.room.bots.length === 1 && {G}.mp.room.settings.laps === 1', timeout=10000)
            await A.screenshot(path='shots/mp1-lobbyA.png'); await B.screenshot(path='shots/mp2-lobbyB.png')
            print('B ist Gastgeber?', await B.evaluate(f'{G}.mp.room.host === {G}.mp.me'), '| Start-Knopf B deaktiviert:', await B.evaluate('document.getElementById("lbStart").disabled'), flush=True)
            await A.click('#lbStart')
            for pg in pages: await pg.wait_for_function(f'{G}.race && {G}.race.net && {G}.race.phase === "running"', timeout=300000)
            print('Ampel auf Grün bei beiden', flush=True)
            for pg in pages: await pg.evaluate(f'{G}.autopilot("profi"); {G}.simMul = 2')
            await A.wait_for_function(f'{G}.race.time > 8', timeout=300000)
            await B.close()
            print('Ben hat den Tab geschlossen', flush=True)
            await A.wait_for_function(f'!{G}.race.entries.some(e => e.name === "Ben")', timeout=30000)
            print('Bens Auto bei Anna entfernt; Fahrer:', await A.evaluate(f'{G}.race.entries.map(e => e.name).join(", ")'), flush=True)
            await A.wait_for_function('document.getElementById("results").classList.contains("on")', timeout=600000)
            await A.wait_for_function(f'{G}.mp.ended', timeout=120000)
            print('Anna Ergebnis:', await A.evaluate("[...document.querySelectorAll('#resTable div:not(.h)')].map(d => d.innerText.replace(/\\s+/g,' ')).join(' | ')"), flush=True)
            await A.click('#rAgain')
            await A.wait_for_function('document.getElementById("lobby").classList.contains("on")', timeout=30000)
            print('Anna wieder in der Lobby, Spieler:', await A.evaluate(f'{G}.mp.room.players.length'), flush=True)
            print('Fehler A:', errs['Anna'][:6]); print('Fehler B:', errs['Ben'][:6])
            await b.close()
    finally:
        srv.terminate()
        out = srv.communicate(timeout=5)[0]
        print('--- Server ---'); print(out[-1500:])
asyncio.run(main())
