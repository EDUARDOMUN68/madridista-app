const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function app({preference=null,permission='granted',offline=false,unsubscribeFails=false,oldReceiver=false}={}){
 const calls=[],toasts=[],attrs={},storage=new Map(preference===null?[]:[['madridista-push-enabled',preference]]);
 let subscription={endpoint:'https://push.example/device',async unsubscribe(){calls.push('unsubscribe');if(unsubscribeFails)return false;subscription=null;return true;}},requested=0;
 const button={setAttribute(k,v){attrs[k]=v;}},notification={permission,async requestPermission(){requested++;this.permission='granted';return 'granted';}};
 const registration={active:{postMessage(data,ports){if(oldReceiver)return;ports[0].other.onmessage({data:{ready:true,version:'3.25.1',confirmationReceived:true}});}},pushManager:{async getSubscription(){return subscription;},async subscribe(){calls.push('subscribe');subscription={endpoint:'new',unsubscribe:async()=>true};return subscription;}}};
 const context={URL,Uint8Array,atob,AbortSignal,Date,Promise,setTimeout(fn,ms){return setTimeout(()=>{if(ms===1000)oldReceiver=false;fn();},ms===1000?5:ms);},clearTimeout,
 window:{MADRIDISTA_PUSH_API:'https://service.example',PushManager:{},Notification:{},showRefreshMessage:t=>toasts.push(t)},Notification:notification,
 localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},navigator:{serviceWorker:{ready:Promise.resolve(registration)}},
 document:{getElementById:id=>{assert.equal(id,'pushToggle');return button;}},
 MessageChannel:class{constructor(){this.port1={close(){}};this.port2={other:this.port1};}},
 async fetch(url,options){calls.push((options.method||'GET')+' '+url.pathname);if(offline)throw Error('offline');return {ok:true,json:async()=>url.pathname==='/config'?{ready:true,publicKey:'test'}:{confirmationSent:true}};}};
 vm.runInNewContext(fs.readFileSync('push-client.js','utf8'),context);
 const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
 return {button,calls,toasts,attrs,storage,settle,requested:()=>requested};
}
test('Conserva permiso previo; apagar corta la suscripción antes de borrar el registro y encender registra de nuevo',async()=>{
 const a=app();await a.settle();assert.equal(a.attrs['aria-pressed'],'true');assert.equal(a.requested(),0);assert.deepEqual(a.calls,['GET /config','POST /subscription']);
 a.button.onclick();await a.settle();assert.equal(a.attrs['aria-pressed'],'false');assert.equal(a.storage.get('madridista-push-enabled'),'off');assert.deepEqual(a.calls.slice(-2),['unsubscribe','DELETE /subscription']);
 a.button.onclick();await a.settle();assert.equal(a.attrs['aria-pressed'],'true');assert.ok(a.calls.includes('subscribe'));
});
test('Recuerda apagado al reabrir, incluso sin red; no registra ni pide permiso',async()=>{
 const a=app({preference:'off',offline:true});await a.settle();assert.equal(a.attrs['aria-pressed'],'false');assert.equal(a.requested(),0);assert.ok(!a.calls.includes('POST /subscription'));assert.equal(a.button.textContent,'🔕');
});
test('Nuevo dispositivo solo pide permiso al tocar; una baja fallida permite reintentar',async()=>{
 const a=app({permission:'default'});await a.settle();assert.equal(a.requested(),0);assert.equal(a.calls.length,0);a.button.onclick();await a.settle();assert.equal(a.requested(),1);assert.equal(a.attrs['aria-pressed'],'true');
 const b=app({unsubscribeFails:true});await b.settle();b.button.onclick();await b.settle();assert.match(b.button.title,/reintentar/);assert.equal(b.button.textContent,'⚠');
});

test('Espera al receptor actualizado antes de registrar una actualización',async()=>{
 const a=app({oldReceiver:true});await a.settle();assert.ok(!a.calls.includes('POST /subscription'));
 await new Promise(r=>setTimeout(r,300));await a.settle();assert.ok(a.calls.includes('POST /subscription'));assert.equal(a.button.textContent,'🔔');
});
