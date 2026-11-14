/**
 * 网页反代 — 无 MSE 原生播放适配（注入引导脚本 IIFE 内，ES5）
 *
 * 老旧 WebView 与 iPhone Safari 没有 MediaSource，抖音/B 站的 MSE 播放器无法工作。
 * 这里在 `!window.MediaSource` 时按站点档案启用原生 <video> 降级：
 *   - B 站：非 WBI 的 playurl 请求强制 fnval=1（mp4）+ platform=html5；
 *     SSR __playinfo__ 只有 dash 时异步重取 mp4 durl 回填（WBI 请求不动，避免破坏签名）。
 *   - 抖音：从已改写的 RENDER_DATA 取 play_addr/封面，用原生 <video> 替换播放器；
 *     缓存信息流接口里的播放地址，URL 切换时换源。
 *
 * 全部 best-effort：任何一步失败都静默回退，绝不影响页面其余功能。
 * 依赖 IIFE 作用域：cfg.profileId / mapHttpUrl / mapMediaUrl / cookieString。
 */

export const PLAYBACK_ADAPTERS = `
(function(){
  try{
    if(window.MediaSource)return;
    var pid=cfg.profileId;
    if(pid==='bilibili'){lwBiliNoMse()}
    else if(pid==='douyin'){lwDouyinNoMse()}
  }catch(e){}

  function lwBiliNoMse(){
    // 非 WBI playurl 请求强制 mp4（fnval=1）+ html5；WBI 请求保持原样以免破坏 w_rid
    try{
      var xo=XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open=function(m,u){
        try{
          if(typeof u==='string'&&u.indexOf('/player/playurl')>=0&&u.indexOf('w_rid=')<0){
            if(u.indexOf('fnval=')>=0){u=u.replace(/fnval=\\d+/,'fnval=1')}else{u+=(u.indexOf('?')>=0?'&':'?')+'fnval=1'}
            if(u.indexOf('platform=')<0){u+='&platform=html5'}
            arguments[1]=u;
          }
        }catch(e){}
        return xo.apply(this,arguments);
      };
    }catch(e){}
    // __playinfo__ 仅 dash 时异步重取 mp4 durl 回填
    try{
      var pi=window.__playinfo__;
      if(pi&&pi.data&&pi.data.dash&&!pi.data.durl){
        var st=window.__INITIAL_STATE__||{};var vd=st.videoData||{};
        var avid=st.aid||vd.aid;
        var cid=vd.cid||(vd.pages&&vd.pages[0]&&vd.pages[0].cid);
        if(avid&&cid){
          var xhr=new XMLHttpRequest();
          xhr.open('GET','https://api.bilibili.com/x/player/playurl?avid='+avid+'&cid='+cid+'&qn=64&fnval=1&platform=html5',true);
          var c=cookieString();if(c)xhr.setRequestHeader('x-lw-cookie',c);
          xhr.onreadystatechange=function(){
            if(xhr.readyState===4&&xhr.status===200){
              try{var r=JSON.parse(xhr.responseText);if(r&&r.data&&r.data.durl){window.__playinfo__={code:0,message:'0',data:r.data}}}catch(e){}
            }
          };
          xhr.send();
        }
      }
    }catch(e){}
  }

  function lwDouyinNoMse(){
    var cache={};
    function firstUrl(o){try{var l=o&&(o.url_list||o.urlList);if(l&&l.length)return l[0];if(typeof o==='string')return o}catch(e){}return ''}
    function pickVideo(detail){
      try{
        var v=detail.video||{};
        var src=firstUrl(v.play_addr||v.playAddr||v.playApi);
        var poster=firstUrl(v.cover||v.origin_cover||v.dynamic_cover);
        return src?{src:src,poster:poster}:null;
      }catch(e){return null}
    }
    function readRenderDetail(){
      try{
        var el=document.getElementById('RENDER_DATA');if(!el)return null;
        var data=JSON.parse(decodeURIComponent(el.textContent||''));
        for(var k in data){
          var node=data[k];if(!node||typeof node!=='object')continue;
          if(node.aweme&&node.aweme.detail)return node.aweme.detail;
          if(node.awemeDetail)return node.awemeDetail;
          if(node.detail&&node.detail.video)return node.detail;
        }
      }catch(e){}
      return null;
    }
    function ensureVideo(){
      var v=document.querySelector('video');if(v)return v;
      var host=document.querySelector('#sliderVideo')||document.querySelector('[class*="playerContainer"]')||document.querySelector('[class*="video-player"]')||document.querySelector('[class*="player"]')||document.body;
      v=document.createElement('video');
      v.setAttribute('controls','');v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');
      v.style.width='100%';v.style.height='100%';v.style.maxHeight='100vh';v.style.background='#000';v.style.objectFit='contain';
      try{host.innerHTML='';host.appendChild(v)}catch(e){document.body.appendChild(v)}
      return v;
    }
    function play(info){
      if(!info||!info.src)return;
      try{
        var v=ensureVideo();var src=mapMediaUrl(info.src);
        if(v.getAttribute('src')!==src){v.setAttribute('src',src);if(info.poster)v.setAttribute('poster',mapHttpUrl(info.poster));try{v.load()}catch(e){}}
      }catch(e){}
    }
    function currentAwemeId(){var m=/\\/video\\/(\\d+)/.exec(location.pathname);return m?m[1]:''}
    function init(){
      var id=currentAwemeId();
      if(id&&cache[id]){play(cache[id]);return}
      var detail=readRenderDetail();
      if(detail){var info=pickVideo(detail);var aid=detail.aweme_id||detail.awemeId||id;if(aid&&info)cache[aid]=info;play(info)}
    }
    // 信息流接口响应缓存播放地址（仅扫描 aweme 相关 JSON）
    function scanJson(text){
      try{
        if(!text||text.indexOf('play_addr')<0&&text.indexOf('playAddr')<0)return;
        var data=JSON.parse(text);
        var list=data.aweme_list||data.awemeList||(data.data&&data.data.aweme_list)||[];
        for(var i=0;i<list.length;i++){var a=list[i];var info=pickVideo(a);var aid=a.aweme_id||a.awemeId;if(aid&&info)cache[aid]=info}
      }catch(e){}
    }
    try{
      var nf=window.fetch;
      if(typeof nf==='function'){window.fetch=function(input,init){
        var p=nf.apply(this,arguments);
        try{var u=typeof input==='string'?input:(input&&input.url)||'';
          if(u.indexOf('aweme')>=0||u.indexOf('feed')>=0){p.then(function(r){try{r.clone().text().then(scanJson).catch(function(){})}catch(e){}}).catch(function(){})}
        }catch(e){}
        return p;
      }}
    }catch(e){}
    try{
      var xs=XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.send=function(){
        try{var self=this;var u=self.__lw_url||'';
          if(u.indexOf('aweme')>=0||u.indexOf('feed')>=0){self.addEventListener('load',function(){try{scanJson(self.responseText)}catch(e){}})}
        }catch(e){}
        return xs.apply(this,arguments);
      };
      var xo2=XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open=function(m,u){try{this.__lw_url=String(u)}catch(e){}return xo2.apply(this,arguments)};
    }catch(e){}
    if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(init,0)})}else{setTimeout(init,0)}
    window.addEventListener('popstate',function(){setTimeout(init,300)});
    try{
      var ps=history.pushState;
      history.pushState=function(){var r=ps.apply(this,arguments);setTimeout(init,400);return r};
    }catch(e){}
  }
})();
`
