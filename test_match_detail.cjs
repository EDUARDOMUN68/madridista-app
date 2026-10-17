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
