const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Con permiso previo espera al receptor nuevo y registra el estado de confirmación',async()=>{
 const banners=[],calls=[];let old=true,registered=false,resolveDone;
 const done=new Promise(resolve=>resolveDone=resolve);
 const node=()=>({style:{},replaceChildren(text){banners.push(text);},append(){}});
 const registration={active:{postMessage(data,ports){assert.equal(data.type,'MADRIDISTA_PUSH_STATUS');if(!old)ports[0].other.onmessage({data:{ready:true,version:'3.25.1',confirmationReceived:false}});}},pushManager:{async getSubscription(){assert.equal(old,false);return {endpoint:'test'};}}};
 const context={URL,Uint8Array,atob,AbortSignal,Date,Promise,
  window:{MADRIDISTA_PUSH_API:'https://service.example',PushManager:{},Notification:{}},
  Notification:{permission:'granted',requestPermission(){assert.fail('No vuelve a pedir permiso');}},
  navigator:{serviceWorker:{ready:Promise.resolve(registration)}},
  document:{createElement:node,createTextNode:v=>v,querySelector:()=>({after(){}})},
  MessageChannel:class{constructor(){this.port1={close(){}};this.port2={other:this.port1};}},
  setTimeout(fn,ms){return setTimeout(()=>{if(ms===1000){assert.equal(registered,false);old=false;}fn();},ms===1000?5:0);},clearTimeout,
  async fetch(url,options){calls.push(url.pathname);if(url.pathname==='/config')return {ok:true,json:async()=>({ready:true,publicKey:'test'})};registered=true;assert.equal(JSON.parse(options.body).confirmationReceived,false);return {ok:true,json:async()=>({confirmationSent:true})};}
 };
 const original=node;
 context.document.createElement=()=>{const n=original();n.replaceChildren=text=>{banners.push(text);if(text.includes('preparados en este móvil'))resolveDone();};return n;};
 vm.runInNewContext(fs.readFileSync('push-client.js','utf8'),context);
 await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('No termina')),2000).unref())]);
 assert.deepEqual(calls,['/config','/subscription']);assert.ok(banners.some(v=>v.includes('Preparando')));
});
