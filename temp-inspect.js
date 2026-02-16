const fs = require('fs');
const text = fs.readFileSync('apps/local/src/app/projects/[id]/settings/page.tsx', 'utf8');
const target = '<section className= card space-y-4>';
const first = text.indexOf(target);
console.log('first index', first);
console.log(JSON.stringify(text.slice(first, first + 200)));
