const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('El receptor descarta repetidos, avisos caducados y enlaces externos',async()=>{
 const handlers={},shown=[],seen=new Set();
 const scope='https://eduardomun68.github.io/madridista-app/';
 const context={URL,Date,Number,Promise,self:{registration:{scope,showNotification:async(title,options)=>shown.push({title,options})},addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(fs.readFileSync('push-receiver.js','utf8'),context);
 context.rememberPush=async (id,readOnly)=>{if(readOnly)return seen.has(id);if(seen.has(id))return false;seen.add(id);return true;};
 async function status(){let task,result;handlers.message({data:{type:'MADRIDISTA_PUSH_STATUS'},ports:[{postMessage:v=>result=v}],waitUntil:p=>task=p});await task;return result;}
 assert.equal((await status()).confirmationReceived,false);assert.equal((await status()).version,'3.28.0');
 async function push(notice){let task;handlers.push({data:{json:()=>notice},waitUntil:p=>task=p});await task;}
 const notice={kind:'madrid-lineup',matchId:'123',body:'Once disponible',url:scope+'?lineup=123&jornada=9',expiresAt:Date.now()+60000};
 await push(notice);await push(notice);assert.equal(shown.length,1);assert.equal(shown[0].options.tag,'madrid-lineup:123');
 await push({...notice,matchId:'124',expiresAt:Date.now()-1});
 await push({...notice,matchId:'125',url:'https://example.com/'});assert.equal(shown.length,1);
 await push({...notice,kind:'madrid-ready',matchId:'0',url:scope});await push({...notice,kind:'madrid-ready',matchId:'0',url:scope});assert.equal(shown.length,2);assert.equal(shown[1].title,'Avisos del Madrid activados');
 assert.equal((await status()).confirmationReceived,true);
 const first={...notice,kind:'madrid-event',eventKey:'goal:one',title:'Gol de Mbappé',body:'Real Madrid 1–0 Rival'};
 await push(first);await push(first);await push({...first,eventKey:'goal:two',body:'Real Madrid 2–0 Rival'});
 assert.equal(shown.length,4);assert.notEqual(shown[2].options.tag,shown[3].options.tag);assert.equal(shown[2].title,'Gol de Mbappé');
 await push({...first,eventKey:null});assert.equal(shown.length,4);

});
