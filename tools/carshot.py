# Rendert ein Auto aus 6 Blickwinkeln: python3 tools/carshot.py vipera [farbe] [tune-json] [out]
import asyncio, sys, subprocess, urllib.parse, os
from playwright.async_api import async_playwright
car = sys.argv[1] if len(sys.argv) > 1 else 'brutus'
color = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != '-' else ''
tune = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '-' else ''
out = sys.argv[4] if len(sys.argv) > 4 else f'/home/claude/racer/shots/car_{car}.png'
view = sys.argv[5] if len(sys.argv) > 5 else ''
yaw = sys.argv[6] if len(sys.argv) > 6 else ''
root = '/home/claude/racer'
subprocess.run(['node', '-e', """
const esbuild = require('esbuild'); const fs = require('fs');
esbuild.buildSync({ entryPoints: ['tools/carview.js'], bundle: true, format: 'iife', outfile: '/tmp/carview/bundle.js', target: 'es2020' });
fs.writeFileSync('/tmp/carview/index.html', '<!DOCTYPE html><html><body><script src="bundle.js"></script></body></html>');
"""], cwd=root, check=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--allow-file-access-from-files'])
        pg = await b.new_page(viewport={'width':1500,'height':900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        qs = {'car': car}
        if color: qs['color'] = color
        if tune: qs['tune'] = tune
        if view: qs['view'] = view
        if yaw: qs['yaw'] = yaw
        await pg.goto('file:///tmp/carview/index.html?' + urllib.parse.urlencode(qs))
        await pg.wait_for_function('window.__done === true', timeout=120000)
        await pg.screenshot(path=out)
        print('ok', out, errs[:5])
        await b.close()
os.makedirs('/tmp/carview', exist_ok=True)
asyncio.run(main())
