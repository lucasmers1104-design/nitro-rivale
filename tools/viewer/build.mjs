import * as esbuild from 'esbuild';
import fs from 'fs';
const r = await esbuild.build({ entryPoints: ['tools/viewer/entry.js'], bundle: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' });
fs.writeFileSync('tools/viewer/index.html', '<!doctype html><html><body style="margin:0;overflow:hidden"><script>' + r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
console.log('viewer ok');
