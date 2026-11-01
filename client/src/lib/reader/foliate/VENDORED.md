# Vendored: foliate-js

- 来源：https://github.com/johnfactotum/foliate-js
- 快照 commit：`78914aef4466eb960965702401634c2cb348e9b1`（2026-11-01 主分支 HEAD，MIT License，见 LICENSE）
- 引入方式：npm 侧该机禁用 git 依赖（EALLOWGIT），且本机直连 GitHub 不稳，故 vendor 快照进仓库。
- 更新方法：浅克隆仓库 → 对比覆盖本目录 `*.js` 与 `vendor/zip.js`、`vendor/fflate.js` → 重跑前端构建与阅读页冒烟。

## 与上游的差异（升级时注意保留）

1. **`pdf.js` 为 stub**：原版依赖 `vendor/pdfjs/`（约 13MB），未 vendor。LineWeb 阅读器不支持 PDF（网盘已有 PDF 预览），stub 抛出明确错误。
2. 删除了上游的 `rollup/`、`tests/`、`ui/`、`reader.html`、`reader.js`、`eslint.config.js`、`rollup.config.js`、`package.json`（构建/示例文件，运行时不需要）。
3. `view.js` 内 `import('./pdf.js')` 命中 stub；其余模块零外部依赖（zip 加载来自 `vendor/zip.js`，MOBI 解压来自 `vendor/fflate.js`）。
