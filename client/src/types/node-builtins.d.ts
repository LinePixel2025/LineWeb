/**
 * 最小 Node 内置模块声明（仅测试使用）
 *
 * client 未安装 @types/node，为一个只读的一致性断言引入整个类型包不划算，
 * 因此这里只声明测试实际用到的函数。若将来安装 @types/node，同名模块声明会按重载合并。
 */

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string
}

declare const process: { cwd(): string }
