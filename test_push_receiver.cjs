const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('El receptor descarta repetidos, avisos caducados y enlaces externos',async()=>{
 const handlers={},shown=[],seen=new Set();
 const scope='https://eduardomun68.github.io/madridista-app/';
 const context={URL,Date,Number,Promise,self:{registration:{scope,showNotification:async(title,options)=>shown.push({title,options})},addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(fs.readFileSync('push-receiver.js','utf8'),context);
 context.rememberPush=async id=>{if(seen.has(id))return false;seen.add(id);return true;};
 async function push(notice){let task;handlers.push({data:{json:()=>notice},waitUntil:p=>task=p});await task;}
 const notice={kind:'madrid-lineup',matchId:'123',body:'Once disponible',url:scope+'?lineup=123&jornada=9',expiresAt:Date.now()+60000};
 await push(notice);await push(notice);assert.equal(shown.length,1);assert.equal(shown[0].options.tag,'madrid-lineup-123');
 await push({...notice,matchId:'124',expiresAt:Date.now()-1});
 await push({...notice,matchId:'125',url:'https://example.com/'});assert.equal(shown.length,1);
 await push({...notice,kind:'madrid-ready',matchId:'0',url:scope});await push({...notice,kind:'madrid-ready',matchId:'0',url:scope});assert.equal(shown.length,2);assert.equal(shown[1].title,'Avisos del Madrid activados');
});
