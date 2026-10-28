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
}

/** 生成可内联的 <script> 内容（不含 <script> 标签本身） */
export function buildBootstrapScript(options: BootstrapOptions): string {
  const payload = JSON.stringify({
    siteId: options.siteId,
    origin: options.origin,
    cookies: options.cookies,
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
function mapHttpUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;var lower=s.toLowerCase();if(lower.indexOf('javascript:')===0||lower.indexOf('data:')===0||lower.indexOf('blob:')===0||lower.indexOf('mailto:')===0||lower.indexOf('tel:')===0||lower.indexOf('about:')===0||lower.indexOf('file:')===0)return value;if(s.charAt(0)==='#')return value;if(s.charAt(0)==='/'&&s.charAt(1)!=='/'){if(s===PREFIX||s.indexOf(PREFIX+'/')===0)return value;return PREFIX+s}if(s.charAt(0)==='/'&&s.charAt(1)==='/'){try{var p=new URL('https:'+s);if(isSiteHost(p.host))return toProxyPath(p)}catch(e){}return value}if(lower.indexOf('http://')===0||lower.indexOf('https://')===0){try{var u=new URL(s);if(isSiteHost(u.host))return toProxyPath(u)}catch(e){}return value}return value}
function mapWsUrl(value){if(typeof value!=='string')return value;var s=value.trim();if(!s)return value;if(s.charAt(0)==='/'){if(s.indexOf(WS_PREFIX)===0)return value;return wsScheme+pageHost+WS_PREFIX+s}var lower=s.toLowerCase();if(lower.indexOf('ws://')===0||lower.indexOf('wss://')===0){try{var u=new URL(s);if(isSiteHost(u.host))return wsScheme+pageHost+WS_PREFIX+u.pathname+u.search+u.hash}catch(e){}return value}return value}
function addCookieHeader(init){var c=cookieString();if(!c)return init;var next=init?Object.assign({},init):{};try{var h=new Headers(next.headers||{});if(!h.has('x-lw-cookie'))h.set('x-lw-cookie',c);next.headers=h}catch(e){}return next}
var nativeFetch=window.fetch;
if(typeof nativeFetch==='function'){window.fetch=function(input,init){try{if(typeof input==='string'||input instanceof URL){input=mapHttpUrl(String(input));init=addCookieHeader(init)}else if(input&&typeof input==='object'&&typeof input.url==='string'){var mapped=mapHttpUrl(input.url);if(mapped!==input.url){input=new Request(mapped,input)}}}catch(e){}return nativeFetch.call(this,input,init)}}
if(window.XMLHttpRequest){var xhrOpen=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url){try{arguments[1]=mapHttpUrl(url)}catch(e){}return xhrOpen.apply(this,arguments)};var xhrSend=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.send=function(){try{var c=cookieString();if(c)this.setRequestHeader('x-lw-cookie',c)}catch(e){}return xhrSend.apply(this,arguments)}}
if(window.EventSource){var NativeES=window.EventSource;var LWES=function(url,opts){return opts===undefined?new NativeES(mapHttpUrl(String(url))):new NativeES(mapHttpUrl(String(url)),opts)};LWES.prototype=NativeES.prototype;try{Object.setPrototypeOf(LWES,NativeES)}catch(e){}window.EventSource=LWES}
if(navigator.sendBeacon){var nativeBeacon=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(url,data){return nativeBeacon(mapHttpUrl(String(url)),data)}}
if(window.WebSocket){var NativeWS=window.WebSocket;var LWWS=function(url,protocols){var target=mapWsUrl(String(url));return protocols===undefined?new NativeWS(target):new NativeWS(target,protocols)};LWWS.prototype=NativeWS.prototype;try{Object.setPrototypeOf(LWWS,NativeWS)}catch(e){}window.WebSocket=LWWS}
try{['pushState','replaceState'].forEach(function(name){var orig=history[name];if(typeof orig!=='function')return;history[name]=function(state,title,url){if(typeof url==='string'&&url.charAt(0)==='/'&&url.charAt(1)!=='/'&&url.indexOf(PREFIX)!==0)url=PREFIX+url;return orig.call(this,state,title,url)}})}catch(e){}
try{if(navigator.serviceWorker&&navigator.serviceWorker.register){navigator.serviceWorker.register=function(){return Promise.reject(new Error('LineWeb 反代模式已禁用 Service Worker'))}}}catch(e){}
function fixAttr(el,name){try{var v=el.getAttribute&&el.getAttribute(name);if(!v)return;if(name==='style'){var next=v.replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi,function(m,q,u){return 'url('+q+mapHttpUrl(u)+q+')'});if(next!==v)el.setAttribute(name,next);return}var mapped=mapHttpUrl(v);if(mapped!==v)el.setAttribute(name,mapped)}catch(e){}}
try{if(window.MutationObserver){var mo=new MutationObserver(function(records){for(var i=0;i<records.length;i++){var r=records[i];if(r.type==='attributes'&&r.target&&r.attributeName)fixAttr(r.target,r.attributeName);else if(r.addedNodes){for(var j=0;j<r.addedNodes.length;j++){var n=r.addedNodes[j];if(n&&n.nodeType===1){if(n.hasAttribute&&(n.hasAttribute('src')||n.hasAttribute('href')||n.hasAttribute('poster'))){fixAttr(n,'src');fixAttr(n,'href');fixAttr(n,'poster')}}}}}});mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','poster','action','style']})}}catch(e){}
window.__LINEWEB_PROXY__={siteId:SITE_ID,origin:cfg.origin,prefix:PREFIX,wsPrefix:WS_PREFIX};
}catch(e){console.warn('[LineWeb] 反代引导脚本初始化失败',e)}})();`
}
