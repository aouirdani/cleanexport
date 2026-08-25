import { writeFileSync } from 'node:fs';

const first = ['Maya','Jonas','Priya','Diego','Ana','Lukas','Lena','Omar','Sofia','Tomas'];
const last = ['Chen','Müller','Sharma','Garcia','Kowalski','Novak','Vogt','Haddad','Rossi','Silva'];
const cities = ['Paris','Berlin','Madrid','Milan','Lisbon','Vienna','Dublin','Oslo'];

const rows = [['First Name','Last Name','Email','Phone Number','City','Message']];

for (let i = 0; i < 500; i++) {
  const f = first[i % first.length];
  const l = last[Math.floor(i / first.length) % last.length];
  // un contact sur cinq porte une note multiligne — le cas qui casse le CSV de HubSpot
  const msg = i % 5 === 0
    ? `Call ${i}: interested in the annual plan\nFollow up after Q3 close\nWants pricing for 50 seats`
    : i % 7 === 0 ? '' : `Single line note ${i}`;
  rows.push([f, l, `${f.toLowerCase()}.${l.toLowerCase()}${i}@example.com`,
             `+3312345${String(i).padStart(4,'0')}`, cities[i % cities.length], msg]);
}

const csv = rows.map(r =>
  r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')
).join('\n');

writeFileSync('/tmp/cleanexport-fixtures.csv', csv);
console.log('500 contacts → /tmp/cleanexport-fixtures.csv');
console.log('100 avec note multiligne, ~71 avec note vide');
