// Cambia la versión de la web en un solo paso:
//   node scripts/version.mjs 1.7.3 1730
// Actualiza version.js y las marcas ?v= de index.html (para que el móvil no use
// scripts antiguos guardados en caché).
import fs from 'node:fs';
const [version, build] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !/^\d+$/.test(build || '')) {
  console.error('Uso: node scripts/version.mjs <versión x.y.z> <compilación>');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
let v = fs.readFileSync('version.js', 'utf8');
v = v.replace(/window\.RV_VERSION = Object\.freeze\(\{[^}]*\}\);/, `window.RV_VERSION = Object.freeze({ version: '${version}', build: '${build}', releasedAt: '${today}' });`);
fs.writeFileSync('version.js', v);
let h = fs.readFileSync('index.html', 'utf8');
h = h.replace(/(href|src)="(styles\.css|stations-data\.js|app\.js|podcasts\.js|diagnostics\.js|version\.js)(\?v=\d+)?"/g, `$1="$2?v=${build}"`);
fs.writeFileSync('index.html', h);
console.log(`Versión ${version} (${build}) aplicada.`);
