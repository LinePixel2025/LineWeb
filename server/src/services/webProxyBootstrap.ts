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

export interface BootstrapOptions {
  siteId: number
  origin: string
  /** 首屏可读的非 HttpOnly Cookie（等价浏览器里 document.cookie 的可见范围） */
  cookies: Array<{ name: string; value: string }>
  /** 该站点是否强制桌面模式（伪装 navigator，配合服务端 UA 覆盖） */
  forceDesktop?: boolean
  /** 桌面 UA 字符串（由服务端统一定义，避免双份漂移） */
  desktopUserAgent?: string
}

/** 生成可内联的 <script> 内容（不含 <script> 标签本身） */
export function buildBootstrapScript(options: BootstrapOptions): string {
  const payload = JSON.stringify({
    siteId: options.siteId,
    origin: options.origin,
    cookies: options.cookies,
    desktop: !!options.forceDesktop,
    ua: options.desktopUserAgent || '',
  })
  // 防止上游域名中出现奇怪字符破坏脚本（域名本身已由 URL 解析校验）
  const safePayload = payload.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028|\u2029/g, '')

  return `(function(){try{
var cfg=${safePayload};
var SITE_ID=cfg.siteId;
var PREFIX='/proxy/'+SITE_ID;
var WS_PREFIX='/proxy-ws/'+SITE_ID;
var siteHost='';try{siteHost=new URL(cfg.origin).host}catch(e){}
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
function mapHttpUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(isSpecialUrl(s))return value;if(s.charAt(0)==='#')return value;if(isMediaPath(s)||isResPath(s))return value;if(s.charAt(0)==='/'&&s.charAt(1)!=='/'){if(s===PREFIX||s.indexOf(PREFIX+'/')===0)return value;return PREFIX+s}if(s.charAt(0)==='/'&&s.charAt(1)==='/'){try{var p=new URL('https:'+s);if(isSiteHost(p.host))return toProxyPath(p);if(isMediaFile(p))return toMediaPath(p);if(isResFile(p))return toResPath(p)}catch(e){}return value}var lower=s.toLowerCase();if(lower.indexOf('http://')===0||lower.indexOf('https://')===0){try{var u=new URL(s);if(isSiteHost(u.host))return toProxyPath(u);if(isMediaFile(u))return toMediaPath(u);if(isResFile(u))return toResPath(u)}catch(e){}return value}return value}
function mapMediaUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(isSpecialUrl(s))return value;if(isMediaPath(s))return value;if(s.charAt(0)==='/'&&s.charAt(1)!=='/'){if(s===PREFIX||s.indexOf(PREFIX+'/')===0)return value;try{return toMediaPath(new URL(s,cfg.origin))}catch(e){return PREFIX+s}}if(s.charAt(0)==='/'&&s.charAt(1)==='/'){try{return toMediaPath(new URL('https:'+s))}catch(e){}return value}if(/^https?:\\/\\//i.test(s)){try{return toMediaPath(new URL(s))}catch(e){}return value}try{var pp=location.pathname;var base=cfg.origin;if(pp===PREFIX||pp.indexOf(PREFIX+'/')===0){base=cfg.origin+(pp.slice(PREFIX.length)||'/')+location.search}var ru=new URL(s,base);if(isMediaFile(ru))return toMediaPath(ru)}catch(e){}return value}
function mapWsUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(s.charAt(0)==='/'){if(s.indexOf(WS_PREFIX)===0)return value;return wsScheme+pageHost+WS_PREFIX+s}var lower=s.toLowerCase();if(lower.indexOf('ws://')===0||lower.indexOf('wss://')===0){try{var u=new URL(s);if(isSiteHost(u.host))return wsScheme+pageHost+WS_PREFIX+u.pathname+u.search+u.hash}catch(e){}return value}return value}
function addCookieHeader(init){var c=cookieString();if(!c)return init;var next=init?Object.assign({},init):{};try{var h=new Headers(next.headers||{});if(!h.has('x-lw-cookie'))h.set('x-lw-cookie',c);next.headers=h}catch(e){}return next}
var nativeFetch=window.fetch;
if(typeof nativeFetch==='function'){window.fetch=function(input,init){try{if(typeof input==='string'||input instanceof URL){input=mapHttpUrl(String(input));init=addCookieHeader(init)}else if(input&&typeof input==='object'&&typeof input.url==='string'){var mapped=mapHttpUrl(input.url);if(mapped!==input.url){input=new Request(mapped,input)}}}catch(e){}return nativeFetch.call(this,input,init)}}
if(window.XMLHttpRequest){var xhrOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){try{arguments[1]=mapHttpUrl(url)}catch(e){}return xhrOpen.apply(this,arguments)};var xhrSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){try{var c=cookieString();if(c)this.setRequestHeader('x-lw-cookie',c)}catch(e){}return xhrSend.apply(this,arguments)}}
if(window.EventSource){var NativeES=window.EventSource;var LWES=function(url,opts){return opts===undefined?new NativeES(mapHttpUrl(String(url))):new NativeES(mapHttpUrl(String(url)),opts)};LWES.prototype=NativeES.prototype;try{Object.setPrototypeOf(LWES,NativeES)}catch(e){}window.EventSource=LWES}
if(navigator.sendBeacon){var nativeBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){return nativeBeacon(mapHttpUrl(String(url)),data)}}
if(window.WebSocket){var NativeWS=window.WebSocket;var LWWS=function(url,protocols){var target=mapWsUrl(String(url));return protocols===undefined?new NativeWS(target):new NativeWS(target,protocols)};LWWS.prototype=NativeWS.prototype;try{Object.setPrototypeOf(LWWS,NativeWS)}catch(e){}window.WebSocket=LWWS}
try{['pushState','replaceState'].forEach(function(name){var orig=history[name];if(typeof orig!=='function')return;history[name]=function(state,title,url){if(typeof url==='string'&&url.charAt(0)==='/'&&url.charAt(1)!=='/'&&url.indexOf(PREFIX)!==0)url=PREFIX+url;return orig.call(this,state,title,url)}})}catch(e){}
try{var mediaDesc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src');if(mediaDesc&&mediaDesc.set&&mediaDesc.configurable){Object.defineProperty(HTMLMediaElement.prototype,'src',{configurable:true,enumerable:mediaDesc.enumerable,get:mediaDesc.get,set:function(v){return mediaDesc.set.call(this,mapMediaUrl(String(v)))}})}}catch(e){}
try{var sourceProto=window.HTMLSourceElement&&HTMLSourceElement.prototype;var sourceDesc=sourceProto&&Object.getOwnPropertyDescriptor(sourceProto,'src');if(sourceDesc&&sourceDesc.set&&sourceDesc.configurable){Object.defineProperty(sourceProto,'src',{configurable:true,enumerable:sourceDesc.enumerable,get:sourceDesc.get,set:function(v){return sourceDesc.set.call(this,mapMediaUrl(String(v)))}})}}catch(e){}
try{var rawSetAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){try{var n=String(name).toLowerCase();if(n==='src'||n==='data-src'){var t=this&&this.tagName;if(t==='VIDEO'||t==='AUDIO'||t==='SOURCE')value=mapMediaUrl(String(value))}}catch(e){}return rawSetAttribute.call(this,name,value)}}catch(e){}
try{if(navigator.serviceWorker&&navigator.serviceWorker.register){navigator.serviceWorker.register=function(){return Promise.reject(new Error('LineWeb 反代模式已禁用 Service Worker'))}}}catch(e){}
function fixAttr(el,name){try{var v=el.getAttribute&&el.getAttribute(name);if(!v)return;if(name==='style'){var next=v.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi,function(m,q,u){return 'url('+q+mapHttpUrl(u)+q+')'});if(next!==v)el.setAttribute(name,next);return}var tag=el.tagName;var mapped=(tag==='VIDEO'||tag==='AUDIO'||tag==='SOURCE')&&(name==='src'||name==='data-src')?mapMediaUrl(v):mapHttpUrl(v);if(mapped!==v)el.setAttribute(name,mapped)}catch(e){}}
try{if(window.MutationObserver){var mo=new MutationObserver(function(records){for(var i=0;i<records.length;i++){var r=records[i];if(r.type==='attributes'&&r.target&&r.attributeName)fixAttr(r.target,r.attributeName);else if(r.addedNodes){for(var j=0;j<r.addedNodes.length;j++){var n=r.addedNodes[j];if(n&&n.nodeType===1){if(n.hasAttribute&&(n.hasAttribute('src')||n.hasAttribute('href')||n.hasAttribute('poster'))){fixAttr(n,'src');fixAttr(n,'href');fixAttr(n,'poster')}}}}}});mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','action','style','data-src']})}}catch(e){}
window.__LINEWEB_PROXY__={siteId:SITE_ID,origin:cfg.origin,prefix:PREFIX,wsPrefix:WS_PREFIX,mediaPrefix:MEDIA_PREFIX,forceDesktop:!!cfg.desktop};
}catch(e){console.warn('[LineWeb] 反代引导脚本初始化失败',e)}})();`
}
