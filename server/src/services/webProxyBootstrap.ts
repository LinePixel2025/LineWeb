/**
 * 网页反代 — 注入到上游 HTML 的引导脚本
 *
 * 目标（按重要性排序）：
 *  1. 让「根路径请求」继续留在反代前缀下：fetch / XHR / WebSocket / EventSource / history
 *  2. 把站点视为「同源」：所有请求都带 `x-lw-cookie`，由服务端合并进上游 Cookie 头
 *  3. 隔离同一 LineWeb 源下的 localStorage / sessionStorage（不同反代站点互不串味）
 *  4. 禁掉 Service Worker（否则会以 LineWeb 源的身份接管整个站点作用域）
 *
 * 只做「浏览器层面」能做的事；HTML/CSS 里的 URL 重写在服务端完成。
 */

import { PLAYBACK_ADAPTERS } from './webProxyPlayback.js'

export interface BootstrapOptions {
  siteId: number
  origin: string
  /** 本文档实际来自的上游 origin（兄弟子域登录页等与站点 origin 不同） */
  pageOrigin?: string
  /** 站点注册域（如 bilibili.com）：族内子域都改写进反代；空串 = 不启用 */
  family?: string
  /** 首屏可读的非 HttpOnly Cookie（等价浏览器里 document.cookie 的可见范围） */
  cookies: Array<{ name: string; value: string }>
  /** 该站点是否强制桌面模式（伪装 navigator，配合服务端 UA 覆盖） */
  forceDesktop?: boolean
  /** 桌面 UA 字符串（由服务端统一定义，避免双份漂移） */
  desktopUserAgent?: string
  /** 需要在脚本层也改写进资源代理的 CDN 主机后缀（如 hdslb.com） */
  cdnHosts?: string[]
  /** 站点档案主机后缀（page→内嵌主机 / res→资源代理 / media→媒体代理） */
  hostRules?: { page: string[]; res: string[]; media: string[] }
  /** 档案「无扩展名媒体路径」正则源串（如抖音 /aweme/v1/play/） */
  mediaPatterns?: string[]
  /** 有效兼容模式（legacy 启用无 MSE 原生播放适配等） */
  compat?: 'modern' | 'legacy'
  /** WS 传输：'poll' 强制走 HTTP 桥（测试 / 站点设置） */
  wsTransport?: string
  /** 站点档案 id（bilibili / douyin），无 MSE 播放适配按它启用 */
  profileId?: string
}

/**
 * WebSocket over HTTP 桥 polyfill + SSE polyfill（ES5，注入到引导脚本 IIFE 内）。
 * 依赖 IIFE 作用域里的 SITE_ID / WS_PREFIX / mapWsUrl / mapHttpUrl / cookieString。
 *  - 无原生 WebSocket 或 ?lw_ws=poll → 直接走 HTTP 桥；
 *  - 有原生 WS → 先尝试原生，open 前失败（error / 未 open 即 close）自动降级到桥。
 */
const WS_BRIDGE_POLYFILL = `
var WS_HTTP_PREFIX='/proxy-ws-http/'+SITE_ID;
var FORCE_WS_POLL=/[?&]lw_ws=poll(?:&|$)/.test(location.search)||cfg.wsTransport==='poll';
function wsPathOf(mapped){var i=mapped.indexOf('://');var rest=i>=0?mapped.slice(i+3):mapped;var s=rest.indexOf('/');return s>=0?rest.slice(s):'/'}
function b64ToBytes(b64){var bin=atob(b64);var len=bin.length;var bytes=new Uint8Array(len);for(var i=0;i<len;i++)bytes[i]=bin.charCodeAt(i);return bytes}
function utf8Decode(bytes){var out='';var i=0;while(i<bytes.length){var c=bytes[i++];if(c<128){out+=String.fromCharCode(c)}else if(c<224){out+=String.fromCharCode(((c&31)<<6)|(bytes[i++]&63))}else if(c<240){out+=String.fromCharCode(((c&15)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63))}else{var cp=((c&7)<<18)|((bytes[i++]&63)<<12)|((bytes[i++]&63)<<6)|(bytes[i++]&63);cp-=65536;out+=String.fromCharCode(55296+(cp>>10),56320+(cp&1023))}}return out}
function LWEvent(type,target){this.type=type;this.target=target;this.currentTarget=target;this.bubbles=false;this.cancelable=false;this.defaultPrevented=false;this.timeStamp=Date.now()}
LWEvent.prototype.preventDefault=function(){this.defaultPrevented=true};
LWEvent.prototype.stopPropagation=function(){};
LWEvent.prototype.stopImmediatePropagation=function(){};
function LWEmitter(){this._listeners={}}
LWEmitter.prototype.addEventListener=function(t,fn){if(!fn)return;var a=this._listeners[t]||(this._listeners[t]=[]);if(a.indexOf(fn)<0)a.push(fn)};
LWEmitter.prototype.removeEventListener=function(t,fn){var a=this._listeners[t];if(!a)return;var i=a.indexOf(fn);if(i>=0)a.splice(i,1)};
LWEmitter.prototype.dispatchEvent=function(ev){var on=this['on'+ev.type];if(typeof on==='function'){try{on.call(this,ev)}catch(e){}}var a=this._listeners[ev.type];if(a){a=a.slice();for(var i=0;i<a.length;i++){try{a[i].call(this,ev)}catch(e){}}}return !ev.defaultPrevented};
var NativeWS=window.WebSocket;
function LWWebSocket(url,protocols){
  LWEmitter.call(this);
  this.CONNECTING=0;this.OPEN=1;this.CLOSING=2;this.CLOSED=3;
  this.readyState=0;this.bufferedAmount=0;this.binaryType='blob';this.protocol='';
  this._opened=false;this._closed=false;this._fellBack=false;this._native=null;this._session=null;this._queue=[];this._protocols=protocols;
  var mapped=mapWsUrl(String(url));this.url=mapped;this._bridgePath=wsPathOf(mapped);
  if(NativeWS&&!FORCE_WS_POLL){this._startNative()}else{this._startBridge()}
}
LWWebSocket.prototype=new LWEmitter();LWWebSocket.prototype.constructor=LWWebSocket;
LWWebSocket.CONNECTING=0;LWWebSocket.OPEN=1;LWWebSocket.CLOSING=2;LWWebSocket.CLOSED=3;
LWWebSocket.prototype._protocolsArray=function(){var p=this._protocols;if(p===undefined||p===null)return [];if(typeof p==='string')return [p];if(Object.prototype.toString.call(p)==='[object Array]')return p;return []};
LWWebSocket.prototype._msgEvent=function(data){var ev=new LWEvent('message',this);ev.data=data;ev.origin=location.origin;ev.lastEventId='';ev.source=null;ev.ports=[];return ev};
LWWebSocket.prototype._startNative=function(){
  var self=this;
  try{
    var ws=this._protocols===undefined?new NativeWS(this.url):new NativeWS(this.url,this._protocols);
    this._native=ws;try{ws.binaryType=this.binaryType}catch(e){}
    ws.onopen=function(){self._opened=true;self.readyState=1;self.protocol=ws.protocol||'';self.dispatchEvent(new LWEvent('open',self))};
    ws.onmessage=function(ev){self.dispatchEvent(self._msgEvent(ev.data))};
    ws.onerror=function(){if(!self._opened){self._fallback()}else{self.dispatchEvent(new LWEvent('error',self))}};
    ws.onclose=function(ev){if(!self._opened){self._fallback();return}self._closed=true;self.readyState=3;var e=new LWEvent('close',self);e.code=ev.code;e.reason=ev.reason;e.wasClean=ev.wasClean;self.dispatchEvent(e)};
  }catch(e){this._fallback()}
};
LWWebSocket.prototype._fallback=function(){
  if(this._fellBack||this._closed)return;this._fellBack=true;
  if(this._native){try{this._native.onopen=this._native.onmessage=this._native.onerror=this._native.onclose=null;this._native.close()}catch(e){}}
  this._native=null;this._startBridge();
};
LWWebSocket.prototype._startBridge=function(){
  var self=this;var xhr=new XMLHttpRequest();
  xhr.open('POST',WS_HTTP_PREFIX+'/open',true);
  xhr.setRequestHeader('Content-Type','application/json');
  var c=cookieString();if(c)xhr.setRequestHeader('x-lw-cookie',c);
  xhr.onreadystatechange=function(){
    if(xhr.readyState!==4)return;
    if(xhr.status===200){var resp;try{resp=JSON.parse(xhr.responseText)}catch(e){self._failClose(1006,'bad open response');return}
      self._session=resp.session;self.protocol=resp.protocol||'';self._opened=true;self.readyState=1;
      self.dispatchEvent(new LWEvent('open',self));self._flushQueue();self._poll();
    }else{self._failClose(1006,'bridge open failed '+xhr.status)}
  };
  xhr.send(JSON.stringify({path:this._bridgePath,protocols:this._protocolsArray()}));
};
LWWebSocket.prototype._poll=function(){
  var self=this;if(this._closed||!this._session)return;
  var xhr=new XMLHttpRequest();xhr.open('GET',WS_HTTP_PREFIX+'/'+this._session+'/poll',true);
  var c=cookieString();if(c)xhr.setRequestHeader('x-lw-cookie',c);
  xhr.onreadystatechange=function(){
    if(xhr.readyState!==4)return;if(self._closed)return;
    if(xhr.status!==200){self._failClose(1006,'poll failed');return}
    var resp;try{resp=JSON.parse(xhr.responseText)}catch(e){self._poll();return}
    var frames=resp.frames||[];for(var i=0;i<frames.length;i++)self._deliver(frames[i]);
    if(resp.closed){self._closed=true;self.readyState=3;var e=new LWEvent('close',self);e.code=resp.code||1000;e.reason=resp.reason||'';e.wasClean=true;self.dispatchEvent(e);return}
    self._poll();
  };
  xhr.send();
};
LWWebSocket.prototype._deliver=function(frame){
  var bytes=b64ToBytes(frame.data);var data;
  if(frame.binary){if(this.binaryType==='arraybuffer'){data=bytes.buffer}else{try{data=new Blob([bytes])}catch(e){data=bytes.buffer}}}
  else{try{data=utf8Decode(bytes)}catch(e){data=''}}
  this.dispatchEvent(this._msgEvent(data));
};
LWWebSocket.prototype._flushQueue=function(){var q=this._queue;this._queue=[];for(var i=0;i<q.length;i++){try{this.send(q[i])}catch(e){}}};
LWWebSocket.prototype.send=function(data){
  if(this.readyState===0){this._queue.push(data);return}
  if(this.readyState!==1)throw new Error('WebSocket is not open');
  if(this._native){this._native.send(data);return}
  var xhr=new XMLHttpRequest();xhr.open('POST',WS_HTTP_PREFIX+'/'+this._session+'/send',true);
  var c=cookieString();if(c)xhr.setRequestHeader('x-lw-cookie',c);
  if(typeof data==='string'){xhr.setRequestHeader('Content-Type','text/plain;charset=UTF-8');xhr.send(data)}
  else if(data instanceof ArrayBuffer){xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.send(new Uint8Array(data))}
  else if(data&&data.buffer instanceof ArrayBuffer){xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.send(data)}
  else if(typeof Blob!=='undefined'&&data instanceof Blob){xhr.setRequestHeader('Content-Type','application/octet-stream');var fr=new FileReader();fr.onload=function(){xhr.send(new Uint8Array(fr.result))};fr.readAsArrayBuffer(data)}
  else{xhr.setRequestHeader('Content-Type','text/plain;charset=UTF-8');xhr.send(String(data))}
};
LWWebSocket.prototype.close=function(code,reason){
  if(this._closed||this.readyState===3)return;this.readyState=2;
  if(this._native){try{this._native.close(code,reason)}catch(e){}return}
  if(this._session){var xhr=new XMLHttpRequest();xhr.open('POST',WS_HTTP_PREFIX+'/'+this._session+'/close',true);xhr.setRequestHeader('Content-Type','application/json');var c=cookieString();if(c)xhr.setRequestHeader('x-lw-cookie',c);xhr.send(JSON.stringify({code:code,reason:reason}))}
  this._closed=true;this.readyState=3;var e=new LWEvent('close',this);e.code=code||1000;e.reason=reason||'';e.wasClean=true;this.dispatchEvent(e);
};
LWWebSocket.prototype._failClose=function(code,reason){
  if(this._closed)return;this._closed=true;this.readyState=3;
  this.dispatchEvent(new LWEvent('error',this));
  var e=new LWEvent('close',this);e.code=code;e.reason=reason;e.wasClean=false;this.dispatchEvent(e);
};
window.WebSocket=LWWebSocket;
function LWSSE(url,opts){
  LWEmitter.call(this);
  this.CONNECTING=0;this.OPEN=1;this.CLOSED=2;this.readyState=0;
  this.url=mapHttpUrl(String(url));this.withCredentials=!!(opts&&opts.withCredentials);
  this._lastId='';this._retry=3000;this._closed=false;this._xhr=null;this._connect();
}
LWSSE.prototype=new LWEmitter();LWSSE.prototype.constructor=LWSSE;
LWSSE.prototype._connect=function(){
  var self=this;if(this._closed)return;
  var xhr=new XMLHttpRequest();this._xhr=xhr;xhr.open('GET',this.url,true);
  xhr.setRequestHeader('Accept','text/event-stream');
  var c=cookieString();if(c)xhr.setRequestHeader('x-lw-cookie',c);
  if(this._lastId)xhr.setRequestHeader('Last-Event-ID',this._lastId);
  var pos=0;var pending='';
  xhr.onreadystatechange=function(){
    if(xhr.readyState===2&&self.readyState===0){self.readyState=1;self.dispatchEvent(new LWEvent('open',self))}
    if(xhr.readyState>=3&&xhr.status===200){var text=xhr.responseText||'';if(text.length>pos){pending+=text.slice(pos);pos=text.length;var parts=pending.split(/\\r?\\n\\r?\\n/);pending=parts.pop();for(var i=0;i<parts.length;i++)self._emitEvent(parts[i])}}
    if(xhr.readyState===4){if(self._closed)return;self.readyState=0;self.dispatchEvent(new LWEvent('error',self));setTimeout(function(){self._connect()},self._retry)}
  };
  xhr.send();
};
LWSSE.prototype._emitEvent=function(block){
  var lines=block.split(/\\r?\\n/);var data=[];var type='message';
  for(var i=0;i<lines.length;i++){var line=lines[i];
    if(line.indexOf('data:')===0)data.push(line.slice(5).replace(/^ /,''));
    else if(line.indexOf('event:')===0)type=line.slice(6).replace(/^ /,'');
    else if(line.indexOf('id:')===0)this._lastId=line.slice(3).replace(/^ /,'');
    else if(line.indexOf('retry:')===0){var r=parseInt(line.slice(6),10);if(!isNaN(r))this._retry=r}
  }
  if(data.length===0)return;
  var ev=new LWEvent(type,this);ev.data=data.join('\\n');ev.lastEventId=this._lastId;ev.origin=location.origin;
  this.dispatchEvent(ev);
};
LWSSE.prototype.close=function(){this._closed=true;this.readyState=2;if(this._xhr){try{this._xhr.abort()}catch(e){}}};
`

/** 生成可内联的 <script> 内容（不含 <script> 标签本身） */
export function buildBootstrapScript(options: BootstrapOptions): string {
  const payload = JSON.stringify({
    siteId: options.siteId,
    origin: options.origin,
    pageOrigin: options.pageOrigin || options.origin,
    family: options.family || '',
    cookies: options.cookies,
    desktop: !!options.forceDesktop,
    ua: options.desktopUserAgent || '',
    cdnHosts: options.cdnHosts || [],
    hostRules: options.hostRules || { page: [], res: [], media: [] },
    mediaPatterns: options.mediaPatterns || [],
    compat: options.compat || 'modern',
    wsTransport: options.wsTransport || '',
    profileId: options.profileId || '',
  })
  // 防止上游域名中出现奇怪字符破坏脚本（域名本身已由 URL 解析校验）
  const safePayload = payload.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, '')

  return `(function(){try{
var cfg=${safePayload};
var SITE_ID=cfg.siteId;
var PREFIX='/proxy/'+SITE_ID;
var WS_PREFIX='/proxy-ws/'+SITE_ID;
var siteHost='';try{siteHost=new URL(cfg.origin).host}catch(e){}
var FAMILY=String(cfg.family||'').toLowerCase();
var PAGE_ORIGIN=cfg.pageOrigin||cfg.origin;var pageOriginHost='';try{pageOriginHost=new URL(PAGE_ORIGIN).host}catch(e){}
function isFamilyHost(host){if(!FAMILY)return false;host=String(host||'').toLowerCase();return host===FAMILY||host.slice(-(FAMILY.length+1))==='.'+FAMILY}
function toEmbeddedPath(u){var sch=u.protocol==='http:'?'http':'https';return PREFIX+'/'+sch+'/'+u.host+(u.pathname||'/')+(u.search||'')+(u.hash||'')}
var CDN_HOSTS=cfg.cdnHosts||[];
function hostInList(host,list){host=String(host||'').toLowerCase();for(var i=0;i<(list||[]).length;i++){var s=String(list[i]||'').toLowerCase();if(!s)continue;if(host===s||host.slice(-(s.length+1))==='.'+s)return true}return false}
function isCdnHost(host){return hostInList(host,CDN_HOSTS)}
var HOST_RULES=cfg.hostRules||{page:[],res:[],media:[]};
function profileClass(host){if(hostInList(host,HOST_RULES.page))return 'page';if(hostInList(host,HOST_RULES.res))return 'res';if(hostInList(host,HOST_RULES.media))return 'media';return ''}
var MEDIA_PATTERNS=[];try{for(var mpi=0;mpi<(cfg.mediaPatterns||[]).length;mpi++){MEDIA_PATTERNS.push(new RegExp(cfg.mediaPatterns[mpi],'i'))}}catch(e){}
function hitMediaPattern(u){var t=(u.pathname||'')+(u.search||'');for(var i=0;i<MEDIA_PATTERNS.length;i++){if(MEDIA_PATTERNS[i].test(t))return true}return false}
function mapAbsUrl(u){if(hitMediaPattern(u))return toMediaPath(u);if(isSiteHost(u.host))return toProxyPath(u);if(isFamilyHost(u.host))return toEmbeddedPath(u);var pc=profileClass(u.host);if(pc==='page')return toEmbeddedPath(u);if(pc==='res')return toResPath(u);if(pc==='media')return toMediaPath(u);if(isCdnHost(u.host))return isMediaFile(u)?toMediaPath(u):toResPath(u);if(isMediaFile(u))return toMediaPath(u);if(isResFile(u))return toResPath(u);return null}
var pageHost=location.host;
var wsScheme=location.protocol==='https:'?'wss://':'ws://';
if(cfg.desktop&&cfg.ua){try{Object.defineProperty(navigator,'userAgent',{configurable:true,get:function(){return cfg.ua}})}catch(e){}try{Object.defineProperty(navigator,'platform',{configurable:true,get:function(){return 'Win32'}})}catch(e){}try{Object.defineProperty(navigator,'userAgentData',{configurable:true,get:function(){return {brands:[{brand:'Chromium',version:'131'},{brand:'Google Chrome',version:'131'},{brand:'Not_A Brand',version:'24'}],mobile:false,platform:'Windows'}}})}catch(e){}}
var STORE_PREFIX='__lw'+SITE_ID+'__';
var rawGet=Storage.prototype.getItem,rawSet=Storage.prototype.setItem,rawRemove=Storage.prototype.removeItem,rawKey=Storage.prototype.key;
var jar={};var jarKey=STORE_PREFIX+'cookie_jar';
try{var saved=JSON.parse(rawGet.call(localStorage,jarKey)||'{}');for(var sk in saved){if(Object.prototype.hasOwnProperty.call(saved,sk))jar[sk]=saved[sk]}}catch(e){}
for(var ci=0;ci<(cfg.cookies||[]).length;ci++){var ck=cfg.cookies[ci];if(ck&&ck.name)jar[ck.name]=ck.value}
function persistJar(){try{rawSet.call(localStorage,jarKey,JSON.stringify(jar))}catch(e){}}
function cookieString(){var out=[];for(var k in jar){if(Object.prototype.hasOwnProperty.call(jar,k)&&jar[k]!==null&&jar[k]!==undefined)out.push(k+'='+jar[k])}return out.join('; ')}
function setVirtualCookie(v){var s=String(v||'');var parts=s.split(';');var first=(parts[0]||'').trim();var eq=first.indexOf('=');if(eq<=0)return;var name=first.slice(0,eq).trim();var value=first.slice(eq+1).trim();if(!name)return;var expired=false;for(var i=1;i<parts.length;i++){var a=parts[i].trim();var lower=a.toLowerCase();if(lower.indexOf('max-age=')===0){var n=parseInt(a.slice(8),10);if(n<=0)expired=true}if(lower.indexOf('expires=')===0){var t=Date.parse(a.slice(8));if(!isNaN(t)&&t<=Date.now())expired=true}}if(expired){delete jar[name]}else{jar[name]=value}persistJar()}
try{Object.defineProperty(document,'cookie',{configurable:true,get:function(){return cookieString()},set:setVirtualCookie})}catch(e){}
try{var sp=Storage.prototype;sp.getItem=function(k){return rawGet.call(this,STORE_PREFIX+k)};sp.setItem=function(k,v){return rawSet.call(this,STORE_PREFIX+k,v)};sp.removeItem=function(k){return rawRemove.call(this,STORE_PREFIX+k)};sp.clear=function(){var keys=[];for(var i=0;i<this.length;i++){var kk=rawKey.call(this,i);if(kk&&kk.indexOf(STORE_PREFIX)===0)keys.push(kk)}for(var j=0;j<keys.length;j++)rawRemove.call(this,keys[j])}}catch(e){}
function isSiteHost(host){return !!host&&host===siteHost}
function toProxyPath(u){return PREFIX+u.pathname+u.search+u.hash}
var MEDIA_PREFIX=PREFIX+'/__lw_media__/';
var RES_PREFIX=PREFIX+'/__lw_res__/';
var MEDIA_EXT_RE=/\\.(m3u8|mpd|ts|m4s|mp4|m4v|webm|flv|mp3|m4a|aac|ogg|oga|opus|vtt|srt|key)$/i;
var RES_EXT_RE=/\\.(css|js|mjs|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot)$/i;
function isMediaPath(s){return s.indexOf(MEDIA_PREFIX)===0}
function isResPath(s){return s.indexOf(RES_PREFIX)===0}
function toMediaPath(u){return MEDIA_PREFIX+(u.protocol==='http:'?'http':'https')+'/'+u.host+(u.pathname||'/')+(u.search||'')}
function toResPath(u){return RES_PREFIX+(u.protocol==='http:'?'http':'https')+'/'+u.host+(u.pathname||'/')+(u.search||'')}
function isMediaFile(u){return MEDIA_EXT_RE.test(u.pathname||'')}
function isResFile(u){return RES_EXT_RE.test(u.pathname||'')}
function isSpecialUrl(s){var l=s.toLowerCase();return l.indexOf('javascript:')===0||l.indexOf('data:')===0||l.indexOf('blob:')===0||l.indexOf('mailto:')===0||l.indexOf('tel:')===0||l.indexOf('about:')===0||l.indexOf('file:')===0}
function mapHttpUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(isSpecialUrl(s))return value;if(s.charAt(0)==='#')return value;if(isMediaPath(s)||isResPath(s))return value;if(s.charAt(0)==='/'&&s.charAt(1)!=='/'){if(s===PREFIX||s.indexOf(PREFIX+'/')===0)return value;if(pageOriginHost&&pageOriginHost!==siteHost){try{return toEmbeddedPath(new URL(s,PAGE_ORIGIN))}catch(e){}return PREFIX+s}return PREFIX+s}if(s.charAt(0)==='/'&&s.charAt(1)==='/'){try{var p=new URL('https:'+s);var pm=mapAbsUrl(p);if(pm!==null)return pm}catch(e){}return value}var lower=s.toLowerCase();if(lower.indexOf('http://')===0||lower.indexOf('https://')===0){try{var u=new URL(s);var um=mapAbsUrl(u);if(um!==null)return um}catch(e){}return value}return value}
function mapMediaUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(isSpecialUrl(s))return value;if(isMediaPath(s))return value;if(s.charAt(0)==='/'&&s.charAt(1)!=='/'){if(s===PREFIX||s.indexOf(PREFIX+'/')===0)return value;try{return toMediaPath(new URL(s,cfg.origin))}catch(e){return PREFIX+s}}if(s.charAt(0)==='/'&&s.charAt(1)==='/'){try{return toMediaPath(new URL('https:'+s))}catch(e){}return value}if(/^https?:\\/\\//i.test(s)){try{return toMediaPath(new URL(s))}catch(e){}return value}try{var pp=location.pathname;var base=cfg.origin;if(pp===PREFIX||pp.indexOf(PREFIX+'/')===0){base=cfg.origin+(pp.slice(PREFIX.length)||'/')+location.search}var ru=new URL(s,base);if(isMediaFile(ru))return toMediaPath(ru)}catch(e){}return value}
function mapWsUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(s.charAt(0)==='/'){if(s.indexOf(WS_PREFIX)===0)return value;if(pageOriginHost&&pageOriginHost!==siteHost){try{var u0=new URL(s,PAGE_ORIGIN);return wsScheme+pageHost+WS_PREFIX+'/'+(u0.protocol==='https:'?'https':'http')+'/'+u0.host+(u0.pathname||'/')+(u0.search||'')}catch(e){}return wsScheme+pageHost+WS_PREFIX+s}return wsScheme+pageHost+WS_PREFIX+s}var lower=s.toLowerCase();if(lower.indexOf('ws://')===0||lower.indexOf('wss://')===0){try{var u=new URL(s);if(isSiteHost(u.host))return wsScheme+pageHost+WS_PREFIX+u.pathname+u.search+u.hash;if(isFamilyHost(u.host)||profileClass(u.host)==='page')return wsScheme+pageHost+WS_PREFIX+'/'+(u.protocol==='ws:'?'http':'https')+'/'+u.host+u.pathname+u.search+u.hash}catch(e){}return value}return value}
function addCookieHeader(init){var c=cookieString();if(!c)return init;var next=init?Object.assign({},init):{};try{var h=new Headers(next.headers||{});if(!h.has('x-lw-cookie'))h.set('x-lw-cookie',c);next.headers=h}catch(e){}return next}
var nativeFetch=window.fetch;
if(typeof nativeFetch==='function'){window.fetch=function(input,init){try{if(typeof input==='string'||input instanceof URL){input=mapHttpUrl(String(input));init=addCookieHeader(init)}else if(input&&typeof input==='object'&&typeof input.url==='string'){var mapped=mapHttpUrl(input.url);if(mapped!==input.url){input=new Request(mapped,input)}}}catch(e){}return nativeFetch.call(this,input,init)}}
if(window.XMLHttpRequest){var xhrOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){try{arguments[1]=mapHttpUrl(url)}catch(e){}return xhrOpen.apply(this,arguments)};var xhrSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){try{var c=cookieString();if(c)this.setRequestHeader('x-lw-cookie',c)}catch(e){}return xhrSend.apply(this,arguments)}}
if(window.EventSource){var NativeES=window.EventSource;var LWES=function(url,opts){return opts===undefined?new NativeES(mapHttpUrl(String(url))):new NativeES(mapHttpUrl(String(url)),opts)};LWES.prototype=NativeES.prototype;try{Object.setPrototypeOf(LWES,NativeES)}catch(e){}window.EventSource=LWES}else{window.EventSource=LWSSE}
if(navigator.sendBeacon){var nativeBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){return nativeBeacon(mapHttpUrl(String(url)),data)}}
${WS_BRIDGE_POLYFILL}
try{['pushState','replaceState'].forEach(function(name){var orig=history[name];if(typeof orig!=='function')return;history[name]=function(state,title,url){if(typeof url==='string'&&url.charAt(0)==='/'&&url.charAt(1)!=='/'&&url.indexOf(PREFIX)!==0){if(pageOriginHost&&pageOriginHost!==siteHost&&url.indexOf(RES_PREFIX)!==0&&url.indexOf(MEDIA_PREFIX)!==0){try{url=toEmbeddedPath(new URL(url,PAGE_ORIGIN))}catch(e){url=PREFIX+url}}else{url=PREFIX+url}}return orig.call(this,state,title,url)}})}catch(e){}
// 查询参数里的族内绝对 URL 重映射（如登录页 ?goUrl=https%3A%2F%2Fwww.bilibili.com%2F...）：
// 应用代码在引导脚本之后才读 location.search，replaceState 后 location.href=goUrl 会留在反代内
try{if(location.search&&location.search.length>1&&window.URLSearchParams&&typeof history.replaceState==='function'){var qs=new URLSearchParams(location.search);var qsDirty=false;qs.forEach(function(v,k){if(typeof v!=='string')return;var t=v.trim();if(!/^https?:\\/\\//i.test(t))return;var m=mapHttpUrl(t);if(m!==t){qs.set(k,m);qsDirty=true}});if(qsDirty)history.replaceState(history.state||null,'',location.pathname+'?'+qs.toString()+location.hash)}}catch(e){}
try{var imgDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');if(imgDesc&&imgDesc.set&&imgDesc.configurable){Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:imgDesc.enumerable,get:imgDesc.get,set:function(v){return imgDesc.set.call(this,mapHttpUrl(String(v)))}})}}catch(e){}
try{var mediaDesc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');if(mediaDesc&&mediaDesc.set&&mediaDesc.configurable){Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,enumerable:mediaDesc.enumerable,get:mediaDesc.get,set:function(v){return mediaDesc.set.call(this,mapMediaUrl(String(v)))}})}}catch(e){}
try{var sourceProto=window.HTMLSourceElement&&HTMLSourceElement.prototype;var sourceDesc=sourceProto&&Object.getOwnPropertyDescriptor(sourceProto,'src');if(sourceDesc&&sourceDesc.set&&sourceDesc.configurable){Object.defineProperty(sourceProto,'src',{configurable:true,enumerable:sourceDesc.enumerable,get:sourceDesc.get,set:function(v){return sourceDesc.set.call(this,mapMediaUrl(String(v)))}})}}catch(e){}
try{var scriptDesc=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,'src');if(scriptDesc&&scriptDesc.set&&scriptDesc.configurable){Object.defineProperty(HTMLScriptElement.prototype,'src',{configurable:true,enumerable:scriptDesc.enumerable,get:scriptDesc.get,set:function(v){return scriptDesc.set.call(this,mapHttpUrl(String(v)))}})}}catch(e){}
try{var iframeDesc=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,'src');if(iframeDesc&&iframeDesc.set&&iframeDesc.configurable){Object.defineProperty(HTMLIFrameElement.prototype,'src',{configurable:true,enumerable:iframeDesc.enumerable,get:iframeDesc.get,set:function(v){return iframeDesc.set.call(this,mapHttpUrl(String(v)))}})}}catch(e){}
try{var rawSetAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){try{var n=String(name).toLowerCase();if(n==='src'||n==='data-src'){var t=this&&this.tagName;if(t==='VIDEO'||t==='AUDIO'||t==='SOURCE')value=mapMediaUrl(String(value))}}catch(e){}return rawSetAttribute.call(this,name,value)}}catch(e){}
try{if(navigator.serviceWorker&&navigator.serviceWorker.register){navigator.serviceWorker.register=function(){return Promise.reject(new Error('LineWeb 反代模式已禁用 Service Worker'))}}}catch(e){}
function fixAttr(el,name){try{var v=el.getAttribute&&el.getAttribute(name);if(!v)return;if(name==='style'){var next=v.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi,function(m,q,u){return 'url('+q+mapHttpUrl(u)+q+')'});if(next!==v)el.setAttribute(name,next);return}var tag=el.tagName;var mapped=(tag==='VIDEO'||tag==='AUDIO'||tag==='SOURCE')&&(name==='src'||name==='data-src')?mapMediaUrl(v):mapHttpUrl(v);if(mapped!==v)el.setAttribute(name,mapped)}catch(e){}}
try{if(window.MutationObserver){var mo=new MutationObserver(function(records){for(var i=0;i<records.length;i++){var r=records[i];if(r.type==='attributes'&&r.target&&r.attributeName)fixAttr(r.target,r.attributeName);else if(r.addedNodes){for(var j=0;j<r.addedNodes.length;j++){var n=r.addedNodes[j];if(n&&n.nodeType===1){if(n.hasAttribute&&(n.hasAttribute('src')||n.hasAttribute('href')||n.hasAttribute('poster'))){fixAttr(n,'src');fixAttr(n,'href');fixAttr(n,'poster')}}}}}});mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','action','style','data-src']})}else{var lwScan=function(){try{var els=document.querySelectorAll('img,script,link,video,audio,source,iframe');for(var i=0;i<els.length;i++){fixAttr(els[i],'src');fixAttr(els[i],'href');fixAttr(els[i],'poster')}}catch(e){}};setInterval(lwScan,1500)}}catch(e){}
window.__LINEWEB_PROXY__={siteId:SITE_ID,origin:cfg.origin,prefix:PREFIX,wsPrefix:WS_PREFIX,mediaPrefix:MEDIA_PREFIX,forceDesktop:!!cfg.desktop,compat:cfg.compat||'modern',profileId:cfg.profileId||''};
${PLAYBACK_ADAPTERS}
}catch(e){console.warn('[LineWeb] 反代引导脚本初始化失败',e)}})();`
}
