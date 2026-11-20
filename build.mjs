import * as esbuild from 'esbuild';
import fs from 'fs';
const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: true, target: 'es2020', write: false, legalComments: 'none' });
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('template.html', 'utf8');
fs.mkdirSync('dist', { recursive: true });
const parts = tpl.split('/*BUNDLE*/');
fs.writeFileSync('dist/index.html', parts[0] + js + parts[1]);
console.log('bundle', (js.length / 1024 / 1024).toFixed(2), 'MB');
