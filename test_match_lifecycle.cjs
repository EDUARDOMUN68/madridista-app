const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const elements=new Map(),intervals=new Map(),events={};let counter=0,fail=false,finish=false,calls=0,defer=null;
function node(){return {innerHTML:'',textContent:'',hidden:false,setAttribute(){},focus(){},getBoundingClientRect(){return {}},addEventListener(name,fn){events[name]=fn}}}
const dialog=node();dialog.querySelector=key=>{if(!elements.has(key))elements.set(key,node());return elements.get(key)};
dialog.showModal=()=>dialog.open=true;dialog.close=()=>{dialog.open=false;events.close()};
const document={hidden:false,createElement:()=>dialog,body:{append(){},classList:{add(){},remove(){}}},addEventListener(){}};
const game={competitors:[{id:'1',homeAway:'home',team:{displayName:'Local'},score:'1'},{id:'2',homeAway:'away',team:{displayName:'Visitante'},score:'0'}]};
const context={document,console,AbortController,Intl,Date,setTimeout,clearTimeout,setInterval:fn=>{const id=++counter;intervals.set(id,fn);return id},clearInterval:id=>intervals.delete(id),directSame:(a,b)=>a===b,fetch:async()=>{calls++;if(defer)return defer;if(fail)throw Error('offline');return {ok:true,json:async()=>({header:{competitions:[{...game,status:{type:{state:finish?'post':'in',completed:finish,shortDetail:"62'"}}}]}})}}};context.window=context;
vm.runInNewContext(fs.readFileSync('match-detail.js','utf8'),context);
const match={competition:'LaLiga',home:'Local',away:'Visitante',status:'live',eventId:'123',date:'2026-10-17'};
const settle=()=>new Promise(r=>setImmediate(r));
(async()=>{
 context.openLigaMatchDetail(match);await settle();assert.equal(intervals.size,1);assert.match(elements.get('#detailHeading').innerHTML,/62/);
 document.hidden=true;await [...intervals.values()][0]();assert.equal(calls,1);document.hidden=false;
 fail=true;await [...intervals.values()][0]();assert.match(elements.get('#detailStatus').textContent,/conserva/);assert.equal(elements.get('#detailRetry').hidden,false);
 fail=false;finish=true;await elements.get('#detailRetry').onclick();assert.equal(intervals.size,0);assert.match(elements.get('#detailHeading').innerHTML,/Finalizado/);
 finish=false;let resolve;defer=new Promise(r=>resolve=r);context.openLigaMatchDetail(match);const previous=elements.get('#detailHeading').innerHTML;dialog.close();resolve({ok:true,json:async()=>({header:{competitions:[{...game,status:{type:{completed:true}}}]}})});await settle();assert.equal(intervals.size,0);assert.equal(elements.get('#detailHeading').innerHTML,previous);
 const before=calls;context.openLigaMatchDetail({...match,competition:'Champions'});assert.equal(calls,before);
 console.log('Ciclo: refresco, pausa oculta, error/reintento, parada al finalizar/cerrar y respuesta tardía comprobados.');
})().catch(e=>{console.error(e);process.exitCode=1});
