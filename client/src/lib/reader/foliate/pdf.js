/**
 * PDF 支持 stub（vendor 修改版）。
 *
 * 原版 foliate-js 的 pdf.js 依赖 vendor/pdfjs（约 13MB 的 pdf.js 构建），
 * 体积过大不宜进 LineWeb 前端包——PDF 预览由网盘 DrivePreview 负责，
 * 阅读器不接受 PDF 文件。这里保留同名模块导出，view.js 打开 PDF 时
 * 会命中此 stub 并抛出可理解的错误，而不是模块解析失败。
 */
export async function makePDF() {
    throw new Error('阅读器不支持 PDF 文件，请使用网盘的文件预览打开 PDF')
}
