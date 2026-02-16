const fs = require('fs');
const path = 'apps/local/src/app/projects/[id]/settings/page.tsx';
const text = fs.readFileSync(path, 'utf8');
const marker = text.indexOf('Local Engine Status');
if (marker === -1) {
  throw new Error('marker not found');
}
const start = text.lastIndexOf('<section', marker);
const end = text.indexOf('</section>', marker);
if (start === -1 || end === -1) {
  throw new Error('bounds not found');
}
const newText = text.slice(0, start) + '      <LocalAvatarEngineStatusPanel />\n' + text.slice(end + '</section>'.length);
fs.writeFileSync(path, newText, 'utf8');
