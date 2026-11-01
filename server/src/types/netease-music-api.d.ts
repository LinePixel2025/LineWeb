/**
 * @neteasecloudmusicapienhanced/api 的包内深路径补充声明：
 * 包类型入口（interface.d.ts）只覆盖 main.js 导出的接口函数，
 * generateConfig.js（官方启动例程）无类型，这里补最小声明。
 */
declare module '@neteasecloudmusicapienhanced/api/generateConfig.js' {
  /** 注册匿名 token + 生成 xeapi 公钥 + neapikey（内部各步自 catch，不会 reject） */
  function generateConfig(): Promise<void>
  export default generateConfig
}
