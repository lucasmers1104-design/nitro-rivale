import * as esbuild from 'esbuild';
import fs from 'fs';
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: true, target: 'es2020', write: false, legalComments: 'none' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
// Baustand ins Menü schreiben (deutsche Zeit), damit man sieht, welche Version live ist
const stamp = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
const tpl = fs.readFileSync('template.html', 'utf8').replace('__BUILD__', stamp);
fs.mkdirSync('dist', { recursive: true });
const parts = tpl.split('/*BUNDLE*/');
fs.writeFileSync('dist/index.html', parts[0] + js + parts[1]);
console.log('bundle', (js.length / 1024 / 1024).toFixed(2), 'MB');
