/* 首屏主题预置：在 CSS 与 React 之前决定明暗，避免暗色模式白闪。
   独立成 public 下的静态文件，而不是 index.html 内联脚本：
   生产环境的 CSP 是 script-src 'self'，内联脚本会被浏览器拦截并报错。 */
(function () {
  try {
    var saved = localStorage.getItem('lineweb_theme') || 'auto';
    var dark = saved === 'dark' ||
      (saved === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
