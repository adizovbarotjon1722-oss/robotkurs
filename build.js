// Builds the three versions of the page from one source.
const fs = require('fs'), p = require('path');
const r = (f) => fs.readFileSync(p.join(__dirname, f), 'utf8');
const page = r('web/template.html')
  .replace('%%CHARCSS%%', () => r('web/char.css'))
  .replace('%%SVG%%', () => r('web/char.svg'))
  .replace('%%JS%%', () => r('shared/prompts.js') + '\n' + r('web/characters.js') + '\n' + r('web/packs.js') + '\n' + r('web/app.js'));
const wrap = (head) => `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${head}<style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n${page}\n</body></html>\n`;
fs.mkdirSync(p.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(p.join(__dirname, 'dist/qumri-artifact.html'), page);
fs.writeFileSync(p.join(__dirname, 'dist/qumri-standalone.html'), wrap(''));
fs.writeFileSync(p.join(__dirname, 'server/public/index.html'), wrap('<script src="https://telegram.org/js/telegram-web-app.js"></script>'));
console.log('built', page.length, 'bytes');
