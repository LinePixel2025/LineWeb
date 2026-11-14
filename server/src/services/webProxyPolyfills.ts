/**
 * 网页反代 — 老旧设备 polyfill bundle（ES5）
 *
 * legacy 模式下作为第一个 <script> 注入（先于引导脚本与站点脚本），补齐老引擎缺失的
 * API：regeneratorRuntime（Babel async/await 降级所需）、Promise、fetch、URL/URLSearchParams、
 * Object.assign、Array/String 常用扩展、CustomEvent、requestAnimationFrame、performance.now。
 *
 * bundle 自身必须是 ES5（老引擎要能解析）。regenerator-runtime 直接内联包内源码，
 * 避免额外网络请求；其余为手写紧凑实现。经 /proxy/<id>/__lw_polyfill__.js 下发并长缓存。
 */

import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'

/** 定位并内联 regenerator-runtime 源码（兼容 tsx CJS / 编译后 ESM 两种运行环境） */
function loadRegeneratorSource(): string {
  const candidates: string[] = []
  try {
    const anchor = typeof __dirname === 'string'
      ? join(__dirname, 'anchor.js')
      : (import.meta as unknown as { url?: string }).url
    if (anchor) candidates.push(createRequire(anchor).resolve('regenerator-runtime/runtime.js'))
  } catch {
    /* ignore */
  }
  if (typeof __dirname === 'string') {
    candidates.push(join(__dirname, '../../node_modules/regenerator-runtime/runtime.js'))
  }
  for (const file of candidates) {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      /* try next */
    }
  }
  return ''
}

const regeneratorSource = loadRegeneratorSource()

const POLYFILL_CODE = `
(function(){
  var global=typeof window!=='undefined'?window:this;
  // ---- Object.assign ----
  if(typeof Object.assign!=='function'){Object.assign=function(target){for(var i=1;i<arguments.length;i++){var src=arguments[i];if(src==null)continue;for(var k in src)if(Object.prototype.hasOwnProperty.call(src,k))target[k]=src[k]}return target}}
  // ---- Object.setPrototypeOf ----
  if(typeof Object.setPrototypeOf!=='function'){Object.setPrototypeOf=function(o,p){try{o.__proto__=p}catch(e){}return o}}
  // ---- Number ----
  if(typeof Number.isFinite!=='function'){Number.isFinite=function(v){return typeof v==='number'&&isFinite(v)}}
  if(typeof Number.isNaN!=='function'){Number.isNaN=function(v){return typeof v==='number'&&isNaN(v)}}
  // ---- String ----
  var sp=String.prototype;
  if(!sp.includes){sp.includes=function(s,pos){return this.indexOf(s,pos||0)!==-1}}
  if(!sp.startsWith){sp.startsWith=function(s,pos){pos=pos||0;return this.substr(pos,s.length)===s}}
  if(!sp.endsWith){sp.endsWith=function(s,pos){var len=(pos===undefined?this.length:pos);return this.substr(len-s.length,s.length)===s}}
  if(!sp.repeat){sp.repeat=function(n){var s=String(this),out='';n=Math.floor(n);if(n<0)throw new RangeError('repeat count must be non-negative');for(var i=0;i<n;i++)out+=s;return out}}
  if(!sp.trim){sp.trim=function(){return this.replace(/^\\s+|\\s+$/g,'')}}
  // ---- Array ----
  var ap=Array.prototype;
  if(!Array.from){Array.from=function(arr){var out=[];for(var i=0;i<arr.length;i++)out.push(arr[i]);return out}}
  if(!Array.of){Array.of=function(){return Array.prototype.slice.call(arguments)}}
  if(!ap.find){ap.find=function(fn,ctx){for(var i=0;i<this.length;i++)if(fn.call(ctx,this[i],i,this))return this[i];return undefined}}
  if(!ap.findIndex){ap.findIndex=function(fn,ctx){for(var i=0;i<this.length;i++)if(fn.call(ctx,this[i],i,this))return i;return -1}}
  if(!ap.includes){ap.includes=function(v){return this.indexOf(v)!==-1}}
  if(!ap.fill){ap.fill=function(v,start,end){var len=this.length;start=start||0;end=end===undefined?len:end;for(var i=start;i<end;i++)this[i]=v;return this}}
  if(!ap.forEach){ap.forEach=function(fn,ctx){for(var i=0;i<this.length;i++)fn.call(ctx,this[i],i,this)}}
  if(!ap.map){ap.map=function(fn,ctx){var out=[];for(var i=0;i<this.length;i++)out.push(fn.call(ctx,this[i],i,this));return out}}
  if(!ap.filter){ap.filter=function(fn,ctx){var out=[];for(var i=0;i<this.length;i++)if(fn.call(ctx,this[i],i,this))out.push(this[i]);return out}}
  // ---- performance / rAF ----
  if(!global.performance){global.performance={}}
  if(typeof global.performance.now!=='function'){global.performance.now=function(){return new Date().getTime()}}
  if(typeof global.requestAnimationFrame!=='function'){global.requestAnimationFrame=function(fn){return setTimeout(function(){fn(Date.now())},16)}}
  if(typeof global.cancelAnimationFrame!=='function'){global.cancelAnimationFrame=function(id){clearTimeout(id)}}
  // ---- CustomEvent ----
  if(typeof global.CustomEvent!=='function'){
    function CustomEvent(type,params){params=params||{bubbles:false,cancelable:false,detail:undefined};var ev=document.createEvent('CustomEvent');ev.initCustomEvent(type,params.bubbles,params.cancelable,params.detail);return ev}
    CustomEvent.prototype=global.Event?global.Event.prototype:{};
    global.CustomEvent=CustomEvent;
  }
  // ---- Promise（紧凑 A+ 实现）----
  if(typeof global.Promise!=='function'){
    var asap=typeof setImmediate==='function'?setImmediate:function(fn){setTimeout(fn,0)};
    function bind(fn,ctx){return function(){fn.apply(ctx,arguments)}}
    function P(fn){if(typeof this!=='object')throw new TypeError('Promises must be constructed via new');if(typeof fn!=='function')throw new TypeError('not a function');this._state=0;this._handled=false;this._value=undefined;this._deferreds=[];doResolve(fn,this)}
    function handle(self,deferred){while(self._state===3)self=self._value;if(self._state===0){self._deferreds.push(deferred);return}self._handled=true;asap(function(){var cb=self._state===1?deferred.onFulfilled:deferred.onRejected;if(cb===null){(self._state===1?resolve:reject)(deferred.promise,self._value);return}var ret;try{ret=cb(self._value)}catch(e){reject(deferred.promise,e);return}resolve(deferred.promise,ret)})}
    function resolve(self,newValue){try{if(newValue===self)throw new TypeError('A promise cannot be resolved with itself');if(newValue&&(typeof newValue==='object'||typeof newValue==='function')){var then=newValue.then;if(newValue instanceof P){self._state=3;self._value=newValue;finale(self);return}if(typeof then==='function'){doResolve(bind(then,newValue),self);return}}self._state=1;self._value=newValue;finale(self)}catch(e){reject(self,e)}}
    function reject(self,newValue){self._state=2;self._value=newValue;finale(self)}
    function finale(self){for(var i=0;i<self._deferreds.length;i++)handle(self,self._deferreds[i]);self._deferreds=null}
    function Handler(onF,onR,promise){this.onFulfilled=typeof onF==='function'?onF:null;this.onRejected=typeof onR==='function'?onR:null;this.promise=promise}
    function doResolve(fn,self){var done=false;try{fn(function(v){if(done)return;done=true;resolve(self,v)},function(r){if(done)return;done=true;reject(self,r)})}catch(e){if(done)return;done=true;reject(self,e)}}
    P.prototype.then=function(onF,onR){var prom=new P(function(){});handle(this,new Handler(onF,onR,prom));return prom};
    P.prototype['catch']=function(onR){return this.then(null,onR)};
    P.resolve=function(v){if(v instanceof P)return v;return new P(function(res){res(v)})};
    P.reject=function(v){return new P(function(_,rej){rej(v)})};
    P.all=function(arr){return new P(function(res,rej){if(arr.length===0)return res([]);var n=0,out=[];for(var i=0;i<arr.length;i++)(function(i){P.resolve(arr[i]).then(function(v){out[i]=v;if(++n===arr.length)res(out)},rej)})(i)})};
    P.race=function(arr){return new P(function(res,rej){for(var i=0;i<arr.length;i++)P.resolve(arr[i]).then(res,rej)})};
    global.Promise=P;
  }
  // ---- URL / URLSearchParams（anchor 解析）----
  if(typeof global.URL!=='function'){
    function URL(url,base){
      url=String(url==null?'':url);var resolved;
      if(/^[a-z][a-z0-9+.-]*:/i.test(url)){resolved=url}
      else if(url.indexOf('//')===0){var bp=base?new URL(base):null;resolved=(bp?bp.protocol:'https:')+url}
      else if(base){var b=(base instanceof URL)?base:new URL(base);
        if(url.charAt(0)==='/'){resolved=b.origin+url}
        else if(url.charAt(0)==='#'){resolved=b.href.split('#')[0]+url}
        else if(url.charAt(0)==='?'){resolved=b.origin+b.pathname+url}
        else{var dir=b.pathname.replace(/\\/[^\\/]*$/,'/');resolved=b.origin+dir+url}
      }else{resolved=url}
      var a=document.createElement('a');a.href=resolved;
      this.protocol=a.protocol||'https:';this.hostname=a.hostname||'';this.port=a.port||'';
      this.host=a.host||(this.hostname+(this.port?':'+this.port:''));
      this.pathname=(a.pathname&&a.pathname.charAt(0)==='/')?a.pathname:'/'+(a.pathname||'');
      this.search=a.search||'';this.hash=a.hash||'';this.origin=this.protocol+'//'+this.host;
      this.href=a.href;this.username='';this.password='';
    }
    URL.prototype.toString=function(){return this.href};
    try{Object.defineProperty(URL.prototype,'searchParams',{configurable:true,get:function(){return new global.URLSearchParams(this.search)}})}catch(e){}
    global.URL=URL;
  }
  if(typeof global.URLSearchParams!=='function'){
    function dec(s){try{return decodeURIComponent(String(s).replace(/\\+/g,' '))}catch(e){return s}}
    function enc(s){return encodeURIComponent(s).replace(/%20/g,'+')}
    function USP(init){this._list=[];if(typeof init==='string'){var q=init.charAt(0)==='?'?init.slice(1):init;if(q){var parts=q.split('&');for(var i=0;i<parts.length;i++){var p=parts[i];if(!p)continue;var eq=p.indexOf('=');this._list.push([dec(eq<0?p:p.slice(0,eq)),dec(eq<0?'':p.slice(eq+1))])}}}}
    USP.prototype.append=function(k,v){this._list.push([String(k),String(v)])};
    USP.prototype.set=function(k,v){var found=false,out=[];for(var i=0;i<this._list.length;i++){if(this._list[i][0]===String(k)){if(!found){out.push([String(k),String(v)]);found=true}}else out.push(this._list[i])}if(!found)out.push([String(k),String(v)]);this._list=out};
    USP.prototype.get=function(k){for(var i=0;i<this._list.length;i++)if(this._list[i][0]===String(k))return this._list[i][1];return null};
    USP.prototype.getAll=function(k){var out=[];for(var i=0;i<this._list.length;i++)if(this._list[i][0]===String(k))out.push(this._list[i][1]);return out};
    USP.prototype.has=function(k){return this.get(k)!==null};
    USP.prototype['delete']=function(k){var out=[];for(var i=0;i<this._list.length;i++)if(this._list[i][0]!==String(k))out.push(this._list[i]);this._list=out};
    USP.prototype.forEach=function(fn,ctx){for(var i=0;i<this._list.length;i++)fn.call(ctx,this._list[i][1],this._list[i][0],this)};
    USP.prototype.toString=function(){var out=[];for(var i=0;i<this._list.length;i++)out.push(enc(this._list[i][0])+'='+enc(this._list[i][1]));return out.join('&')};
    global.URLSearchParams=USP;
  }
  // ---- fetch（XHR 版最小实现）----
  if(typeof global.fetch!=='function'){
    function Headers(init){this._h={};if(init){if(init instanceof Headers){var self=this;init.forEach(function(v,k){self.append(k,v)})}else if(typeof init==='object'){for(var k in init)if(Object.prototype.hasOwnProperty.call(init,k))this.append(k,init[k])}}}
    Headers.prototype.append=function(k,v){k=String(k).toLowerCase();this._h[k]=this._h[k]?this._h[k]+', '+v:String(v)};
    Headers.prototype.set=function(k,v){this._h[String(k).toLowerCase()]=String(v)};
    Headers.prototype.get=function(k){var v=this._h[String(k).toLowerCase()];return v===undefined?null:v};
    Headers.prototype.has=function(k){return Object.prototype.hasOwnProperty.call(this._h,String(k).toLowerCase())};
    Headers.prototype.forEach=function(fn,ctx){for(var k in this._h)if(Object.prototype.hasOwnProperty.call(this._h,k))fn.call(ctx,this._h[k],k,this)};
    function Response(body,init){init=init||{};this._body=body;this.bodyUsed=false;this.status=init.status||200;this.statusText=init.statusText||'';this.ok=this.status>=200&&this.status<300;this.headers=new Headers(init.headers);this.url=init.url||''}
    Response.prototype.text=function(){this.bodyUsed=true;return Promise.resolve(typeof this._body==='string'?this._body:'')};
    Response.prototype.json=function(){return this.text().then(function(t){return JSON.parse(t)})};
    function fetch(input,init){init=init||{};return new Promise(function(resolve,reject){var xhr=new XMLHttpRequest();var url=typeof input==='string'?input:(input&&input.url)||'';xhr.open(init.method||'GET',url,true);var headers=new Headers(init.headers||(input&&input.headers));headers.forEach(function(v,k){try{xhr.setRequestHeader(k,v)}catch(e){}});xhr.onload=function(){resolve(new Response(xhr.responseText,{status:xhr.status,statusText:xhr.statusText,url:url}))};xhr.onerror=function(){reject(new TypeError('Network request failed'))};xhr.ontimeout=function(){reject(new TypeError('Network request timeout'))};var body=init.body;if(body&&typeof body==='object'&&typeof body!=='string'&&!(body instanceof ArrayBuffer)){try{body=JSON.stringify(body)}catch(e){}}xhr.send(body||null)})}
    global.fetch=fetch;global.Headers=Headers;global.Response=Response;
    if(typeof global.Request!=='function'){global.Request=function(input,init){this.url=typeof input==='string'?input:(input&&input.url)||'';this.method=(init&&init.method)||'GET';this.headers=new Headers(init&&init.headers)}}
  }
})();
`

/** 完整 polyfill bundle（regenerator + 手写 polyfill），模块加载时构建一次 */
export const POLYFILL_BUNDLE = `${regeneratorSource}\n${POLYFILL_CODE}`

/** polyfill 路径段（HTML 注入 / 路由共用） */
export const POLYFILL_SEGMENT = '__lw_polyfill__.js'

export function polyfillPath(siteId: number): string {
  return `/proxy/${siteId}/${POLYFILL_SEGMENT}`
}
