# Gemeinsamer Start: Ben hängt beim Laden 8 s fest – Anna muss warten, Grün muss bei beiden gleichzeitig kommen
import asyncio, subprocess, time, urllib.request, os
from playwright.async_api import async_playwright
PORT = 8092; BASE = f'http://localhost:{PORT}'
async def main():
    srv = subprocess.Popen(['node', 'server/server.mjs'], env={**os.environ, 'PORT': str(PORT)}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(50):
            try: urllib.request.urlopen(BASE + '/health', timeout=1); break
            except Exception: time.sleep(0.2)
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
            pages, errs = [], []
            for name in ['Anna', 'Ben']:
                ctx = await b.new_context(viewport={'width': 1280, 'height': 720})
                await ctx.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body='', content_type='text/css'))
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, n=name: errs.append(n + ': ' + str(e)))
                await pg.add_init_script(f"localStorage.setItem('nitrorivale', JSON.stringify({{name: '{name}', gfx: 'niedrig'}}))")
                pages.append(pg)
            A, B = pages; G = 'window.__game'
            await A.goto(BASE + '/')
            await A.wait_for_function(f'{G} && document.getElementById("menu").classList.contains("on")', timeout=180000)
            await A.evaluate(f'{G}.openMp()'); await A.click('#mpCreate')
            await A.wait_for_function('document.getElementById("lobby").classList.contains("on")', timeout=30000)
            code = await A.inner_text('#roomCode')
            await B.goto(f'{BASE}/?raum={code}')
            await B.wait_for_function(f'{G} && {G}.mp.room && {G}.mp.room.players.length === 2', timeout=180000)
            await A.wait_for_function(f'{G}.mp.room.players.length === 2', timeout=10000)
            print('Lobby-Hinweis (Gastgeber):', await A.inner_text('#lbHint'))
            print('Bots im Raum:', await A.evaluate(f'{G}.mp.room.bots.length'), '| auffüllen:', await A.evaluate(f'{G}.mp.room.settings.fill'))
            await A.evaluate(f'{G}.sp.laps = 1')
            await A.click('#lbStart')
            # Ben bekommt das Laden mit und friert dann 8 s ein (langsamer PC)
            await B.wait_for_function(f'{G}.mp.raceInfo', timeout=60000, polling=10)
            t0 = time.time()
            blk = asyncio.create_task(B.evaluate('(() => { const e = performance.now() + 8000; while (performance.now() < e) {} })()'))
            await A.wait_for_function(f'{G}.mp.waiting && /Ben/.test(document.getElementById("bigMsg").innerText)', timeout=60000)
            print('Anna sieht:', (await A.inner_text('#bigMsg')).strip(), f'(nach {time.time()-t0:.1f} s)')
            print('Anna Ampel läuft schon?', await A.evaluate(f'{G}.mp.goAt != null'))
            await blk
            for pg in pages: await pg.wait_for_function(f'{G}.race && {G}.race.phase === "running"', timeout=120000)
            goA = await A.evaluate(f'performance.timeOrigin + {G}.mp.goAt'); goB = await B.evaluate(f'performance.timeOrigin + {G}.mp.goAt')
            print(f'Grün bei Anna und Ben: Abstand {abs(goA - goB):.0f} ms | Countdown begann {time.time()-t0:.1f} s nach Start')
            ents = [await pg.evaluate(f'{G}.race.entries.length') for pg in pages]
            print('Autos im Rennen (A/B):', ents)
            await A.screenshot(path='shots/sync_hud.png')
            print('Fehler:', errs[:4]); await b.close()
    finally:
        srv.terminate(); print('--- Server ---'); print(srv.communicate(timeout=5)[0][-500:])
asyncio.run(main())
