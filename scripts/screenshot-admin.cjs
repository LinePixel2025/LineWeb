/**
 * 管理后台移动端截图脚本（登录 + 截图）
 * 用法: node scripts/screenshot-admin.cjs
 * 前提: 前后端已启动（localhost:5173）
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'test-screenshots');
const ADMIN_EMAIL = 'admin@lineweb.dev';
const ADMIN_PASSWORD = 'admin123';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();

  try {
    // 1. 登录
    console.log('Step 1: 登录...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01-login-page.png'), fullPage: true });

    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="邮箱" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    await emailInput.fill(ADMIN_EMAIL);
    await passwordInput.fill(ADMIN_PASSWORD);

    const submitBtn = page.locator('button[type="submit"], button:has-text("登录"), button:has-text("Login")').first();
    await submitBtn.click();

    // 等待跳转
    await page.waitForURL('**/admin**', { timeout: 10000 }).catch(async () => {
      if (!page.url().includes('/admin')) {
        await page.goto(`${BASE_URL}/admin`, { waitUntil: 'networkidle', timeout: 10000 });
      }
    });
    await page.waitForTimeout(1500);
    console.log('  -> 已登录, URL:', page.url());

    // 2. 管理后台截图
    console.log('Step 2: 管理后台截图...');
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02-admin-mobile.png'), fullPage: false });
    await page.screenshot({ path: path.join(OUTPUT_DIR, '03-admin-mobile-fullpage.png'), fullPage: true });
    console.log('  -> 截图已保存');

    // 3. 检查水平溢出
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    console.log(`\n页面分析: body宽度=${bodyWidth}px, 视口=375px`);
    if (bodyWidth > 375) {
      console.log('警告: 检测到水平溢出！');
    } else {
      console.log('正常: 无水平溢出');
    }
  } catch (error) {
    console.error('错误:', error.message);
    await page.screenshot({ path: path.join(OUTPUT_DIR, 'error.png'), fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
