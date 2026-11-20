import asyncio, sys
from playwright.async_api import async_playwright
# usage: shot.py out.png "car=brutus&..." [w h]
async def main():
    out, qs = sys.argv[1], sys.argv[2]
    w = int(sys.argv[3]) if len(sys.argv) > 3 else 1800
    h = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
    html = open('/home/claude/racer/tools/viewer/index.html', 'rb').read()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        async def handle(route): await route.fulfill(status=200, content_type='text/html', body=html)
        await pg.route('http://game.test/**', handle)
        await pg.goto('http://game.test/?' + qs)
        try:
            await pg.wait_for_function('window.__done === true', timeout=90000)
            print(await pg.evaluate('JSON.stringify(window.__info)'))
        except Exception as e:
            print('timeout', e)
        await pg.screenshot(path=out)
        if errs: print('errors:', errs[:6])
        await b.close()
asyncio.run(main())
