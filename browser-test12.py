import asyncio, os, mimetypes, sys, time
from playwright.async_api import async_playwright
ROOT = '/home/claude/racer/dist'
async def serve(route):
    path = route.request.url.split('game.test/', 1)[1].split('?')[0] or 'index.html'
    fp = os.path.join(ROOT, path)
    await (route.fulfill(path=fp, content_type=mimetypes.guess_type(fp)[0] or 'application/octet-stream') if os.path.isfile(fp) else route.fulfill(status=404, body='x'))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1280,'height':720})
        errs = []
        pg.on('pageerror', lambda e: errs.append('PAGE ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.route('http://game.test/**', serve)
        await pg.route('https://fonts.googleapis.com/**', lambda r: r.fulfill(status=200, body='', content_type='text/css'))
        await pg.goto('http://game.test/index.html')
        await pg.wait_for_function('window.__game && document.getElementById("menu").classList.contains("on")', timeout=180000)
        G = 'window.__game'
        await pg.evaluate(f'{G}.startArena()'); await pg.wait_for_timeout(4000)
        await pg.screenshot(path='shots/w2-arena.png')
        for lvl in (sys.argv[1:] or ['kueste', 'pass']):
            await pg.evaluate(f'{G}.startRace({{mode:"race", level:"{lvl}", laps:2, skill:"normal", items:true, opponents:5}})')
            await pg.wait_for_function(f'{G}.race && {G}.race.phase === "countdown" && {G}.race.cd > -1.4', timeout=120000)
            await pg.screenshot(path=f'shots/w3-{lvl}-intro.png')
            await pg.wait_for_function(f'{G}.race.phase === "running"', timeout=400000)
            await pg.evaluate(f'{G}.autopilot("profi"); {G}.simMul = 3')
            await pg.wait_for_function(f'{G}.race.time > 22', timeout=400000)
            await pg.evaluate(f'{G}.simMul = 1')
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=f'shots/w4-{lvl}-race.png')
        await pg.evaluate(f'{G}.setPause(true)'); await pg.wait_for_timeout(600)
        await pg.screenshot(path='shots/w5-pause.png')
        print('errors:', errs[:10])
        await b.close()
asyncio.run(main())
