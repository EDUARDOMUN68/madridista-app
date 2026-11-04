const assert=require('node:assert/strict');
const {parse,timeline}=require('./match-detail.js');
const match={home:'Local',away:'Visitante'};
const same=(a,b)=>a===b;
const payload={header:{competitions:[{status:{type:{state:'in'}},competitors:[{id:'1',homeAway:'home',team:{displayName:'Local'},score:'1'},{id:'2',homeAway:'away',team:{displayName:'Visitante'},score:'0'}]}]},keyEvents:[
 {id:'2',type:{type:'substitution'},period:{number:2},clock:{value:3600,displayValue:"60'"},team:{id:'2'},participants:[{athlete:{displayName:'Entra'}},{athlete:{displayName:'Sale'}}]},
 {id:'1',type:{type:'goal'},scoringPlay:true,period:{number:1},clock:{value:1500,displayValue:"25'"},team:{id:'1'},participants:[{athlete:{displayName:'<Jugador>'}}]},
 {id:'3',type:{type:'yellow-red-card'},period:{number:2},clock:{value:4000},team:{id:'2'}},
 {id:'unknown',scoringPlay:true,team:{id:'3'}}
],boxscore:{teams:[{team:{id:'1'},statistics:[{name:'totalShots',displayValue:'0'}]}]}};
let result=parse(payload,match,same);
assert.deepEqual(result.events.map(e=>e.kind),['goal','sub','second']);
assert.equal(result.events[1].side,'away');
assert.equal(result.stats[0].home,'0');assert.equal(result.stats[0].away,'—');
assert.match(timeline(result),/Sale: Sale/);assert.match(timeline(result),/&lt;Jugador&gt;/);
assert.throws(()=>parse(payload,{home:'Otro',away:'Visitante'},same),/no corresponde/);
payload.keyEvents.push(payload.keyEvents[0]);assert.equal(parse(payload,match,same).events.length,3);
payload.keyEvents=[];assert.match(timeline(parse(payload,match,same)),/Todavía no/);
payload.header.competitions[0].status.type={completed:true,state:'post'};
assert.match(timeline(parse(payload,match,same)),/no ofrece incidencias/);
console.log('Detalle: identidad, cronología, cambios, expulsión, datos ausentes, deduplicación y escape comprobados.');
const {lineupHtml}=require('./match-detail.js');
payload.rosters=[{team:{id:'2'},formation:'4-3-3',roster:Array.from({length:12},(_,i)=>({athlete:{id:String(i),displayName:'Jugador '+i},starter:i<11,jersey:String(i+1),formationPlace:String(i+1),subbedIn:i===11,subbedOut:i===0}))}];
result=parse(payload,match,same);
assert.equal(result.lineups[0].confirmed,false);
assert.equal(result.lineups[1].confirmed,true);assert.equal(result.lineups[1].starters.length,11);assert.equal(result.lineups[1].bench.length,1);
assert.equal(result.lineups[1].starters[0].name,'Jugador 0');
assert.match(lineupHtml(result.lineups),/Suplentes/);assert.doesNotMatch(lineupHtml(result.lineups),/Sale:|Entra:/);
payload.rosters[0].roster.push(payload.rosters[0].roster[0]);assert.equal(parse(payload,match,same).lineups[1].starters.length,11);
payload.rosters[0].roster[0].starter=undefined;assert.equal(parse(payload,match,same).lineups[1].confirmed,false);
console.log('Alineaciones: identidad de equipo, once único, suplentes iniciales y ausencia de datos comprobados.');

assert.match(timeline(parse({...payload,keyEvents:[{type:{type:'substitution'},team:{id:'1'},participants:[{athlete:{displayName:'Entra'}}]}]},match,same)),/event-sub/);

const {pitchRows}=require('./match-detail.js');
const roles=['G','CD-L','CD-R','LB','RB','AM','LM','RM','F','AM-L','AM-R'];
const fieldPayload=structuredClone(payload);
fieldPayload.rosters=[{team:{id:'2'},formation:'4-2-3-1',roster:roles.map((role,i)=>({athlete:{id:String(i),displayName:'Nombre '+i,shortName:'Jugador '+i},starter:true,jersey:String(i+1),position:{abbreviation:role}}))}];
const fieldTeam=parse(fieldPayload,match,same).lineups[1];
const rows=pitchRows(fieldTeam);
assert.deepEqual(rows.map(r=>r.length),[1,3,2,4,1]);
assert.deepEqual(rows[3].map(p=>p.role),['LB','CD-L','CD-R','RB']);
assert.deepEqual(rows[1].map(p=>p.role),['AM-L','AM','AM-R']);
assert.equal(rows[0][0].role,'F');assert.equal(rows.at(-1)[0].role,'G');
assert.equal(rows.flat().length,11);
const html=lineupHtml([fieldTeam]);assert.match(html,/lineup-pitch/);assert.match(html,/Jugador 0/);assert.doesNotMatch(html,/<img/);
assert.equal(pitchRows({...fieldTeam,formation:'4-4-3'}),null);
assert.equal(pitchRows({...fieldTeam,confirmed:false}),null);
assert.equal(pitchRows({...fieldTeam,starters:fieldTeam.starters.map((p,i)=>i===2?{...p,role:''}:p)}),null);
assert.match(lineupHtml([{...fieldTeam,formation:''}]),/posiciones suficientes/);
assert.doesNotMatch(lineupHtml([{...fieldTeam,formation:''}]),/lineup-pitch/);
const midfieldAmbiguous=fieldTeam.starters.map(p=>p.role.startsWith('AM')||['LM','RM'].includes(p.role)?{...p,role:'CM'}:p);
assert.equal(pitchRows({...fieldTeam,starters:midfieldAmbiguous}),null,'No inventa que centrocampistas van en cada linea');
for(const [formation,codes,lengths] of [
 ['4-3-3',['G','LB','CD-L','CD-R','RB','CM-L','CM','CM-R','LW','F','RW'],[3,3,4,1]],
 ['3-5-2',['G','CD-L','CD','CD-R','LWB','CM-L','CM','CM-R','RWB','CF-L','CF-R'],[2,5,3,1]],
 ['4-4-2',['G','LB','CD-L','CD-R','RB','LM','CM-L','CM-R','RM','CF-L','CF-R'],[2,4,4,1]]
]){
 const team={...fieldTeam,formation,starters:codes.map((role,i)=>({role,name:'Jugador '+i,number:i+1}))};
 assert.deepEqual(pitchRows(team).map(r=>r.length),lengths);
}
assert.match(lineupHtml([{...fieldTeam,starters:fieldTeam.starters.map(p=>({...p,shortName:'<Nombre>',number:'<9>'}))}]),/&lt;Nombre&gt;/);
console.log('Campo: formaciones, laterales y centrales, once completo, ausencia de posiciones, ambiguedad y escape comprobados.');
