const test=require('node:test'),assert=require('node:assert/strict');
const {parse,pitchRows,lineupHtml}=require('./match-detail.js');
const actual=require('./test-fixtures/real-madrid-celta-442.json');
const reference=require('./test-fixtures/aek-madrid-reference.json');
function read(payload){
 const teams=payload.header.competitions[0].competitors;
 return parse(payload,{home:teams.find(t=>t.homeAway==='home').team.displayName,away:teams.find(t=>t.homeAway==='away').team.displayName},(a,b)=>a===b).lineups;
}
const ids=rows=>rows.map(row=>row.map(p=>p.id));
test('La referencia ESPN verifica casillas no consecutivas y roles detallados del 4-4-2',()=>{
 const team=read(reference)[0],rows=pitchRows(team);
 assert.equal(team.formation,'4-4-2');
 assert.deepEqual(rows.map(row=>row.map(p=>[p.order,p.role])),[
  [[9,'CF-L'],[10,'CF-R']],[[11,'LM'],[8,'CM-L'],[4,'CM-R'],[7,'RM']],[[3,'LB'],[6,'CD-L'],[5,'CD-R'],[2,'RB']],[[1,'G']]
 ]);
});
test('Posiciones detalladas dibujan 4-4-2 sin depender de formationPlace',()=>{
 const data=structuredClone(reference);data.rosters[0].roster.forEach(p=>delete p.formationPlace);
 assert.deepEqual(ids(pitchRows(read(data)[0])),ids(pitchRows(read(reference)[0])));
});
test('La correspondencia 4-2-3-1 contrastada conserva las mismas filas con roles generales',()=>{
 const data=structuredClone(reference),r=data.rosters.find(r=>r.team.id==='86');
 for(const p of r.roster){const role=p.position?.abbreviation;if(!role)continue;p.position.abbreviation=role==='G'?'G':/^(CD|LB|RB)/.test(role)?'D':/^(AM|LM|RM)/.test(role)?'M':role;}
 assert.deepEqual(ids(pitchRows(read(data)[1])),ids(pitchRows(read(reference)[1])));
});
test('Madrid-Celta real: once, equipo y dorsales originales; campo 4-4-2 con G/D/M/F',()=>{
 const [madrid,celta]=read(actual),rows=pitchRows(madrid);
 assert.equal(madrid.team,'Real Madrid');assert.equal(celta.team,'Celta Vigo');
 assert.equal(madrid.confirmed,true);assert.equal(celta.confirmed,true);
 assert.deepEqual(rows.map(row=>row.length),[2,4,4,1]);
 assert.deepEqual(ids(rows),[['402479','231388'],['291281','199833','285150','310452'],['310637','251634','356000','223532'],['134283']]);
 assert.deepEqual(rows[2].map(p=>p.number),['18','16','4','12']);
 assert.equal(rows[3][0].name,'Thibaut Courtois');
 const original=actual.rosters.find(r=>r.team.id==='86').roster.filter(p=>p.starter);
 assert.deepEqual(rows.flat().map(p=>[p.id,p.name,p.number]).sort(),original.map(p=>[p.athlete.id,p.athlete.displayName,p.jersey]).sort());
 assert.ok(!madrid.starters.some(p=>celta.starters.some(q=>p.id===q.id)));
 const swapped=structuredClone(actual);swapped.rosters.reverse();assert.deepEqual(ids(pitchRows(read(swapped)[0])),ids(rows));
 const shuffled=structuredClone(actual);shuffled.rosters[0].roster.reverse();assert.deepEqual(ids(pitchRows(read(shuffled)[0])),ids(rows),'No depende del orden de roster');
});
test('Formación genérica no contrastada: lista por posición general y dorsal, sin campo ni culpa a la fuente',()=>{
 const celta=read(actual)[1];assert.equal(pitchRows(celta),null);
 const html=lineupHtml([celta]);assert.doesNotMatch(html,/lineup-pitch|La fuente no ofrece posiciones/);
 assert.match(html,/Distribución en el campo no verificada/);assert.match(html,/Portería/);assert.match(html,/Defensa/);assert.match(html,/Centrocampo/);assert.match(html,/Delantera/);
 assert.ok(html.indexOf('Marcos Alonso')<html.indexOf('Yoel Lago'));
 assert.ok(html.indexOf('Sergio Carreira')<html.indexOf('Ilaix Moriba'));
});
test('Faltan casillas, se repiten, son inválidas o contradicen roles: nunca inventa la distribución',()=>{
 for(const change of [p=>delete p.formationPlace,p=>p.formationPlace='1',p=>p.formationPlace='12',p=>p.formationPlace='2.5',p=>p.position.abbreviation='F']){
  const data=structuredClone(actual);change(data.rosters[0].roster.find(p=>p.starter&&p.formationPlace==='2'));
  const team=read(data)[0];assert.equal(team.confirmed,true);assert.equal(pitchRows(team),null);assert.match(lineupHtml([team]),/Distribución en el campo no verificada/);
 }
});
test('Once incompleto, duplicado o sin identidad: no confirma titulares',()=>{
 for(const change of [r=>r.roster.splice(r.roster.findIndex(p=>p.starter),1),r=>r.roster.push(structuredClone(r.roster.find(p=>p.starter))),r=>delete r.roster.find(p=>p.starter).athlete.id,r=>delete r.roster.find(p=>p.starter).athlete.displayName]){
  const data=structuredClone(actual);change(data.rosters[0]);
  const team=read(data)[0];assert.equal(team.confirmed,false);assert.equal(pitchRows(team),null);
 }
});
test('Equipo ajeno, roster ambiguo o atleta compartido entre equipos: no mezcla alineaciones',()=>{
 const missing=structuredClone(actual);missing.rosters[0].team.id='999';assert.equal(read(missing)[0].confirmed,false);
 const ambiguous=structuredClone(actual);ambiguous.rosters.push(structuredClone(ambiguous.rosters[0]));assert.equal(read(ambiguous)[0].confirmed,false);
 const wrongHeader=structuredClone(actual);wrongHeader.header.competitions[0].competitors[0].team.id='999';assert.equal(read(wrongHeader)[0].confirmed,false);
 const shared=structuredClone(actual);shared.rosters[1].roster.find(p=>p.starter).athlete.id=shared.rosters[0].roster.find(p=>p.starter).athlete.id;
 assert.ok(read(shared).every(t=>!t.confirmed));
});
test('Titular inicial que fue sustituido sigue siendo titular; suplente nunca ocupa el campo',()=>{
 const data=structuredClone(actual),r=data.rosters[0];r.roster.find(p=>p.starter).subbedOut=true;
 const substitute=r.roster.find(p=>p.starter===false);substitute.subbedIn=true;
 const team=read(data)[0];assert.equal(pitchRows(team).flat().length,11);assert.ok(!pitchRows(team).flat().some(p=>p.id===substitute.athlete.id));assert.ok(team.bench.some(p=>p.id===substitute.athlete.id));
});
