import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshot,changes,scoreboardSnapshot} from './events.mjs';
const start=Date.parse('2026-10-18T19:00Z'),fixture={competition:'LaLiga',date:'2026-10-18',time:'21:00',venue:'home',jornada:9};
function source(phase='pre',goals=[],reds=[]){
 const scores=[0,0];for(const e of goals)scores[e.side]++;
 const period=['second','final'].includes(phase)?2:1;
 return {header:{competitions:[{id:'123',date:new Date(start).toISOString(),status:{period,displayClock:phase==='first'?'20':phase==='second'?'60':'0',type:{state:phase==='pre'?'pre':phase==='final'?'post':'in',completed:phase==='final',name:phase==='half'?'STATUS_HALFTIME':'STATUS_IN_PROGRESS'}},competitors:[{id:'86',homeAway:'home',team:{displayName:'Real Madrid'},score:String(scores[0])},{id:'1',homeAway:'away',team:{displayName:'Sevilla'},score:String(scores[1])}]}]},keyEvents:[...goals.map(e=>({...e,scoringPlay:true,type:{type:'goal'}})),...reds.map(e=>({...e,type:{type:e.second?'yellow-red-card':'red-card'}}))].map(e=>({...e,team:{id:e.side===0?'86':'1'},period:{number:e.p||1},clock:{value:e.minute*60,displayValue:e.minute+"'"},participants:[{athlete:{displayName:e.player}}]}))};
}
const goal={id:'g1',side:0,player:'Mbappé',minute:25};
test('Secuencia completa, ambos equipos, marcador por gol, doble amarilla, fases sin duplicar',()=>{
 let previous,now=start-60000;
 const tick=(phase,goals=[],reds=[])=>{now+=60000;const result=changes(snapshot(source(phase,goals,reds),fixture),previous,fixture,now);previous=result.state;return result.notices;};
 assert.equal(tick('pre').length,0);assert.match(tick('first')[0].title,/Empieza el partido/);
 let notices=tick('first',[goal]);assert.equal(notices.length,1);assert.match(notices[0].body,/Real Madrid 1–0 Sevilla/);assert.match(notices[0].title,/Mbappé/);
 assert.equal(tick('first',[goal]).length,0);
 const away={id:'g2',side:1,player:'Rival',minute:30};notices=tick('first',[goal,away]);assert.match(notices[0].body,/1–1/);
 const red={id:'r1',side:1,player:'Defensa',minute:35,second:true};assert.match(tick('first',[goal,away],[red])[0].title,/Expulsado: Defensa/);
 assert.match(tick('half',[goal,away],[red])[0].title,/Descanso/);
 assert.equal(tick('half',[goal,away],[red]).length,0);
 assert.match(tick('second',[goal,away],[red])[0].title,/segunda parte/);
 assert.match(tick('final',[goal,away],[red])[0].title,/Final del partido/);
 assert.equal(tick('final',[goal,away],[red]).length,0);
});
test('No reproduce histórico al arrancar a mitad del encuentro ni tras una interrupción larga',()=>{
 const initial=changes(snapshot(source('second',[goal]),fixture),null,fixture,start+60*60000);
 assert.equal(initial.notices.length,0);
 const delayed={id:'old',side:1,player:'Antes',minute:40};
 const next=changes(snapshot(source('second',[goal,delayed]),fixture),initial.state,fixture,start+61*60000);assert.equal(next.notices.length,0);
 assert.equal(changes(snapshot(source('final',[goal]),fixture),initial.state,fixture,start+100*60000).notices.length,0);
});
test('Incoherencia/VAR y ficha ajena: no inventa goles, avisa corrección, no retrocede fase',()=>{
 let previous=changes(snapshot(source('pre'),fixture),null,fixture,start).state;
 previous=changes(snapshot(source('first',[goal]),fixture),previous,fixture,start+60000).state;
 const bad=source('first',[goal]);bad.header.competitions[0].competitors[0].score='2';
 assert.equal(changes(snapshot(bad,fixture),previous,fixture,start+120000).notices.length,0);
 assert.match(changes(snapshot(source('first'),fixture),previous,fixture,start+120000).notices[0].title,/corregido/);
 const half=changes(snapshot(source('half',[goal]),fixture),previous,fixture,start+120000).state;
 assert.equal(changes(snapshot(source('first',[goal]),fixture),half,fixture,start+180000).state.phase,'half');
 assert.equal(snapshot(source(),{...fixture,date:'2026-10-19'}),null);
 assert.equal(snapshot(source(),{...fixture,venue:'away'}),null);
 const champions={...fixture,competition:'Champions',jornada:3};
 assert.match(changes(snapshot(source('first'),champions),previous,champions,start+120000).state.phase,/first/);
});

test('El resumen real omite periodo: usa el marcador diario y rechaza fases contradictorias',()=>{
 const data=source('second');delete data.header.competitions[0].status.period;
 assert.equal(snapshot(data,fixture,{period:2,type:{state:'in'},displayClock:"60'"}).phase,'second');
 assert.equal(snapshot(data,fixture,{period:1,type:{state:'pre'}}),null);
});

test('Marcador diario: goleador, roja y fases sin resumen; identidad estable entre fuentes',()=>{
 const summary=source('second',[goal],[{id:'red',side:1,player:'Defensa',minute:61}]);
 summary.keyEvents.forEach((e,i)=>e.participants[0].athlete.id=String(i+10));
 const game=summary.header.competitions[0];
 const board={id:game.id,status:game.status,competitions:[{...game,details:summary.keyEvents.map(e=>({...e,id:undefined,period:undefined,redCard:e.type.type==='red-card',athletesInvolved:e.participants.map(p=>p.athlete)}))}]};
 const current=scoreboardSnapshot(board,fixture);
 assert.equal(current.phase,'second');assert.equal(current.goalsCoherent,true);assert.equal(current.events.length,2);
 assert.deepEqual(current.events.map(e=>e.key),snapshot(summary,fixture).events.map(e=>e.key));
 assert.equal(current.events[0].player,'Mbappé');assert.equal(current.events[1].kind,'red');
 board.status={period:1,type:{state:'in',name:'STATUS_HALFTIME'}};assert.equal(scoreboardSnapshot(board,fixture).phase,'half');
});
