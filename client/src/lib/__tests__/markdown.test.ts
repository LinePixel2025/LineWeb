/// <reference types="vitest/globals" />
import { renderMarkdown } from '../markdown'

// 说明：项目 vitest.config.ts 已开启 globals，测试文件无需从 'vitest' 导入
describe('renderMarkdown', () => {
  it('渲染 GFM：标题 / 列表 / 表格 / 引用 / 链接', () => {
    const html = renderMarkdown([
      '# 标题',
      '',
      '- 一',
      '- 二',
      '',
      '| 列 A | 列 B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '> 引用',
      '',
      '[链接](https://example.com)',
    ].join('\n'))

    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<table>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('渲染 LaTeX：$...$、$$...$$、\\(...\\)、\\[...\\]', () => {
    const html = renderMarkdown([
      '行内 $E=mc^2$ 公式。',
      '',
      '$$\int_0^1 x^2 dx$$',
      '',
      '剩余 \\(a^2+b^2=c^2\\) 与',
      '',
      '\\[\\frac{1}{2}\\]',
    ].join('\n'))

    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
    // DOMPurify 必须保留 KaTeX 的排版 style 与 MathML
    expect(html).toContain('style=')
    expect(html).toContain('<math')
  })

  it('代码块 / 行内代码中的公式标记保持原文', () => {
    const html = renderMarkdown([
      '```latex',
      'E = \\\\(mc^2\\\\)',
      '```',
      '',
      '`\\\\(a+b\\\\)`',
    ].join('\n'))

    expect(html).toContain('<code class="language-latex">')
    expect(html).not.toContain('class="katex"')
  })

  it('未闭合公式不会抛错（流式输出中途）', () => {
    expect(() => renderMarkdown('正在生成 $E=mc')).not.toThrow()
    expect(() => renderMarkdown('正在生成 \\(a+b')).not.toThrow()
  })

  it('货币金额不会被误判为公式', () => {
    const html = renderMarkdown('价格从 $5 到 $10，另加 $3 服务费。')
    expect(html).not.toContain('class="katex"')
    expect(html).toContain('$5')
    expect(html).toContain('$10')
  })

  it('DOMPurify 过滤脚本、事件属性与危险链接', () => {
    const html = renderMarkdown([
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(1)">',
      '[危险](javascript:alert(1))',
    ].join('\n'))

    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('href="javascript:')
  })
})
