/**
 * 文章页面截图脚本（桌面 + 移动端）
 * 用法: node scripts/screenshot-posts.cjs
 * 前提: 前后端已启动（localhost:5173）
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE_URL = 'http://localhost:5173';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'test-screenshots');

(async () => {
  const browser = await chromium.launch({ headless: true });

  // 桌面截图 (1280x800)
  console.log('=== 桌面端 1280x800 ===');
  const desktopCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const desktopPage = await desktopCtx.newPage();
  await desktopPage.goto(`${BASE_URL}/posts`, { waitUntil: 'networkidle', timeout: 30000 });
  await desktopPage.waitForTimeout(2000);
  await desktopPage.screenshot({ path: path.join(OUTPUT_DIR, 'posts-desktop.png'), fullPage: false });
  await desktopPage.screenshot({ path: path.join(OUTPUT_DIR, 'posts-desktop-fullpage.png'), fullPage: true });
  console.log('桌面截图已保存');
  await desktopCtx.close();

  // 移动端截图 (375x812 - iPhone X)
  console.log('\n=== 移动端 375x812 ===');
  const mobileCtx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const mobilePage = await mobileCtx.newPage();
  await mobilePage.goto(`${BASE_URL}/posts`, { waitUntil: 'networkidle', timeout: 30000 });
  await mobilePage.waitForTimeout(2000);
  await mobilePage.screenshot({ path: path.join(OUTPUT_DIR, 'posts-mobile.png'), fullPage: false });
  await mobilePage.screenshot({ path: path.join(OUTPUT_DIR, 'posts-mobile-fullpage.png'), fullPage: true });
  console.log('移动端截图已保存');
  await mobileCtx.close();

  await browser.close();
  console.log('\n所有截图已完成，保存在:', OUTPUT_DIR);
})();
