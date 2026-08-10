import { readFileSync } from 'node:fs';
const t = readFileSync('.env','utf8').match(/TOKEN=(.+)/)[1].trim();
const B = 'https://api.hubapi.com', H = { authorization: 'Bearer ' + t };

const props = (await (await fetch(`${B}/crm/properties/2026-03/contacts`, {headers:H})).json()).results;
const targets = props.filter(p => p.fieldType === 'textarea' || p.fieldType === 'html').map(p => p.name);
console.log('textarea/html properties:', targets.join(', '), '\n');

const url = `${B}/crm/objects/2026-03/contacts?limit=100&properties=${targets.join(',')}`;
const recs = (await (await fetch(url, {headers:H})).json()).results;

let found = 0;
for (const r of recs) {
  for (const [k, v] of Object.entries(r.properties)) {
    if (typeof v !== 'string' || v === '') continue;
    const multi = /[\r\n]/.test(v);
    console.log(`record ${r.id} · ${k} ${multi ? '← MULTI-LINE' : ''}`);
    console.log('  escaped:', JSON.stringify(v));
    if (multi) {
      found++;
      const crlf = (v.match(/\r\n/g)||[]).length;
      const lf   = (v.match(/(?<!\r)\n/g)||[]).length;
      const cr   = (v.match(/\r(?!\n)/g)||[]).length;
      console.log(`  census: CRLF=${crlf}  bare LF=${lf}  bare CR=${cr}`);
    }
    console.log();
  }
}
console.log(found ? `${found} multi-line value(s) found.` : 'No multi-line value. Is the text in the "Message" property?');
