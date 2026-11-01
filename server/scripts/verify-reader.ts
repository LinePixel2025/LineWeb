/**
 * 小说阅读器纯函数自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 覆盖：EPUB 元数据解析（container.xml → OPF → 标题/作者/封面路径）、
 *       zip 路径解析、XML 实体解码、格式识别、书架列表合并进度排序的输入口径。
 *
 * 用法: cd server && npx tsx scripts/verify-reader.ts
 *      （或 npm run verify:reader）
 */

import JSZip from 'jszip'
import {
  BOOK_DIR,
  BOOK_MAX_BYTES,
  decodeXmlEntities,
  detectBookFormatForTest,
  extractOpfPathFromContainer,
  parseOpfMetadata,
  readEpubMeta,
  resolveZipPath,
} from '../src/services/readerService.js'

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

// === 常量口径 ===
assert(BOOK_DIR === '_books', '书籍系统目录为 _books')
assert(BOOK_MAX_BYTES === 50 * 1024 * 1024, '单本上限 50 MiB')

// === XML 实体解码 ===
assertEqual(decodeXmlEntities('三体&amp;地球往事'), '三体&地球往事', '解码 &amp;')
assertEqual(decodeXmlEntities('&#x4e2d;&#25991;'), '中文', '解码数字实体（十六进制/十进制）')
assertEqual(decodeXmlEntities('&lt;b&gt;不加深意 markup&lt;/b&gt;'), '<b>不加深意 markup</b>', '解码标签实体')
assertEqual(decodeXmlEntities('&amp;lt;'), '&lt;', '&amp; 不递归解码')

// === container.xml → OPF 路径 ===
assertEqual(
  extractOpfPathFromContainer('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
  'OEBPS/content.opf',
  '提取 rootfile full-path（双引号）',
)
assertEqual(
  extractOpfPathFromContainer("<rootfile full-path='META-INF/book.opf'/>"),
  'META-INF/book.opf',
  '提取 rootfile full-path（单引号回退）',
)
assertEqual(extractOpfPathFromContainer('<container/>'), null, '无 rootfile 返回 null')

// === OPF 元数据解析 ===
const opfBase = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="t1">三体</dc:title>
    <dc:creator id="a1">刘慈欣</dc:creator>
    <meta name="cover" content="cover-image-item"/>
  </metadata>
  <manifest>
    <item id="cover-image-item" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
</package>`

const meta3 = parseOpfMetadata(opfBase, 'OEBPS')
assert(meta3 !== null, 'EPUB3 OPF 解析成功')
assertEqual(meta3?.title, '三体', 'EPUB3 标题')
assertEqual(meta3?.author, '刘慈欣', 'EPUB3 作者')
assertEqual(meta3?.coverPath, 'OEBPS/images/cover.jpg', 'EPUB3 封面按 OPF 目录解析')

// EPUB2：<meta name="cover" content="id"> 指向 manifest item
const opf2 = opfBase.replace(' properties="cover-image"', '')
const meta2 = parseOpfMetadata(opf2, 'OEBPS')
assertEqual(meta2?.coverPath, 'OEBPS/images/cover.jpg', 'EPUB2 meta name=cover 约定')

// 无封面 & 无作者
const opfNoCover = `<?xml version="1.0"?><package><metadata><dc:title>只有标题</dc:title></metadata><manifest><item id="x" href="a.xhtml"/></manifest></package>`
const metaNoCover = parseOpfMetadata(opfNoCover, '')
assertEqual(metaNoCover?.title, '只有标题', '无封面 OPF 标题')
assertEqual(metaNoCover?.author, '', '无作者回退空串')
assertEqual(metaNoCover?.coverPath, null, '无封面返回 null')
assertEqual(parseOpfMetadata('<package/>', ''), null, '无元数据返回 null')

// 属性乱序 / 实体 / 截断
const opfMessy = `<?xml version="1.0"?><package><metadata><dc:creator>余华 &amp; 出版社</dc:creator><dc:title>&#x6d3b;&#30528;</dc:title></metadata><manifest/></package>`
const metaMessy = parseOpfMetadata(opfMessy, '')
assertEqual(metaMessy?.title, '活着', '数字实体标题')
assertEqual(metaMessy?.author, '余华 & 出版社', '实体作者')

// title 超长截断到 120
const longTitle = '长'.repeat(300)
assertEqual(parseOpfMetadata(`<package><metadata><dc:title>${longTitle}</dc:title></metadata></package>`, '')?.title?.length, 120, '超长标题截断 120')

// === zip 路径解析 ===
assertEqual(resolveZipPath('OEBPS', 'images/cover.jpg'), 'OEBPS/images/cover.jpg', '相对 href 拼接')
assertEqual(resolveZipPath('OEBPS', '../cover.jpg'), 'cover.jpg', '.. 回退到根')
assertEqual(resolveZipPath('', 'cover.jpg'), 'cover.jpg', '空 OPF 目录')
assertEqual(resolveZipPath('OEBPS', 'a%20b.jpg'), 'OEBPS/a b.jpg', '百分号解码')
assertEqual(resolveZipPath('OEBPS', 'a%zz.jpg'), 'OEBPS/a%zz.jpg', '非法百分号保留原值')
assertEqual(resolveZipPath('OEBPS', './sub/../cover.jpg'), 'OEBPS/cover.jpg', './ 与 ../ 归一化')

// === 格式识别（经导出的测试探针）===
assertEqual(detectBookFormatForTest('book.epub', Buffer.from('xx')), 'epub', '扩展名 .epub')
assertEqual(detectBookFormatForTest('书.txt', Buffer.from('正文')), 'txt', '扩展名 .txt（中文文件名）')
assertEqual(
  detectBookFormatForTest('novel', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])),
  'epub',
  '无扩展名 ZIP 魔数兜底为 epub',
)
assertEqual(detectBookFormatForTest('novel', Buffer.from([0x1f, 0x8b, 0x08, 0x00])), null, '既无扩展名又非 ZIP 拒绝')
assertEqual(detectBookFormatForTest('a.PDF', Buffer.from('%PDF-1.4')), null, 'PDF 扩展名不受支持')

// === 端到端：用 jszip 构造最小 EPUB 再读回 ===
async function verifyEpubRoundtrip(): Promise<void> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip')
  zip.file('META-INF/container.xml', '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')
  zip.file('OEBPS/content.opf', opfBase)
  zip.file('OEBPS/images/cover.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]))
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })

  const meta = await readEpubMeta(buffer)
  assert(meta !== null, '最小 EPUB 端到端解析成功')
  assertEqual(meta?.metadata.title, '三体', '端到端标题')
  assertEqual(meta?.metadata.author, '刘慈欣', '端到端作者')
  assertEqual(meta?.metadata.coverPath, 'OEBPS/images/cover.jpg', '端到端封面路径')
  assert(meta?.cover !== null && meta !== null && meta.cover?.length === 6, '端到端封面字节读出')

  // 损坏 zip → null（不抛错）
  const broken = await readEpubMeta(Buffer.from('this is not a zip file'))
  assertEqual(broken, null, '损坏 zip 返回 null 不抛错')

  // 缺 OPF → null
  const zip2 = new JSZip()
  zip2.file('META-INF/container.xml', '<container/>')
  const empty = await readEpubMeta(await zip2.generateAsync({ type: 'nodebuffer' }))
  assertEqual(empty, null, '缺 OPF 返回 null')
}

async function main(): Promise<void> {
  verifyEpubRoundtrip()
  console.log(`verify:reader 通过（${passed} 断言）`)
}

main().catch((err) => {
  console.error(String(err))
  process.exit(1)
})
