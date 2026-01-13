const fs = require('fs');
const path = 'apps/local/src/app/projects/[id]/settings/page.tsx';
const text = fs.readFileSync(path, 'utf8');
const target = '      <section className= card space-y-4>\r\n        <div className=flex flex-wrap items-start justify-between gap-3>';
const start = text.indexOf(target);
const next = '      <section className=card space-y-4>\r\n        <div>\r\n          <h2>Advanced (Local MuseTalk)</h2>';
const nextStart = text.indexOf(next, start);
if (start === -1 || nextStart === -1) {
  throw new Error('sections not found');
}
const newText = text.slice(0, start) + '      <LocalAvatarEngineStatusPanel />\n' + text.slice(nextStart);
fs.writeFileSync(path, newText, 'utf8');
