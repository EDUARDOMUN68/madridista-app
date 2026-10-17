import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kickoff,candidates,confirmedNotice,resolveEventId,validSubscription} from './core.mjs';
const fixture={competition:'LaLiga',venue:'home',opponent:'Sevilla FC',date:'2026-10-18',time:'21:00',status:'scheduled',jornada:9};
const start=Date.parse('2026-10-18T19:00:00Z'),now=start-3600000;
const summary=()=>({header:{id:'123',competitions:[{id:'123',date:'2026-10-18T19:00Z',status:{type:{state:'pre',completed:false}},competitors:[{id:'86',homeAway:'home',team:{displayName:'Real Madrid'}},{id:'1',homeAway:'away',team:{displayName:'Sevilla'}}]}]},rosters:[{team:{id:'86'},roster:Array.from({length:11},(_,i)=>({starter:true,athlete:{id:String(i+1),displayName:'Jugador '+i}}))}]});
test('Ventana previa y zona Madrid con cambio de hora',()=>{
 assert.equal(kickoff(fixture),start);
 assert.equal(kickoff({...fixture,date:'2026-11-07'}),Date.parse('2026-11-07T20:00Z'));
 assert.equal(candidates({fixtures:[fixture]},now).length,1);
 assert.equal(candidates({fixtures:[fixture]},start+1).length,0);
 assert.equal(candidates({fixtures:[{...fixture,competition:'Champions'}]},now).length,0);
});
test('Once explícito, solo Madrid y sin notificación histórica',()=>{
 assert.equal(confirmedNotice(summary(),fixture,now).players.length,11);
 assert.equal(confirmedNotice(summary(),fixture,start),null);
 const d=summary();d.rosters[0].roster.pop();assert.equal(confirmedNotice(d,fixture,now),null);
 d.rosters[0].roster.push(d.rosters[0].roster[0]);assert.equal(confirmedNotice(d,fixture,now),null);
 assert.equal(confirmedNotice(summary(),{...fixture,date:'2026-10-19'},now),null);
 const live=summary();live.header.competitions[0].status.type.state='in';assert.equal(confirmedNotice(live,fixture,now),null);
 const rival=summary();rival.rosters[0].team.id='1';assert.equal(confirmedNotice(rival,fixture,now),null);
});
test('Resolver rechaza ambigüedad y ficha de otra fecha',()=>{
 const e={id:'123',competitions:summary().header.competitions};
 assert.equal(resolveEventId({events:[e]},fixture),'123');
 assert.equal(resolveEventId({events:[e,e]},fixture),null);
 assert.equal(resolveEventId({events:[e]},{...fixture,date:'2026-10-19'}),null);
});
test('La suscripción solo permite servidores push conocidos',()=>{
 const sub={endpoint:'https://fcm.googleapis.com/fcm/send/abc:long-token',keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}};
 assert.equal(validSubscription(sub),true);
 assert.equal(validSubscription({...sub,endpoint:'http://127.0.0.1/internal'}),false);
 assert.equal(validSubscription({...sub,endpoint:'https://fcm.googleapis.com.evil.test/fcm/send/abc'}),false);
 assert.equal(validSubscription({...sub,keys:{p256dh:'secret',auth:'secret'}}),false);
});
