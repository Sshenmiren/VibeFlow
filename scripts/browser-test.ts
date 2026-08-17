/** 真实浏览器交互测试。用法：npx tsx scripts/browser-test.ts */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:5177';
const SHOTS = 'scripts/screens';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const step = async (name: string) => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  console.log(`📸 ${name}`);
};

// 1. 落地页
await page.goto(BASE);
await page.waitForSelector('#path-input', { timeout: 10_000 });
await step('01-landing');

// 2. 导入项目
await page.fill('#path-input', 'C:/Users/AcademicEsu/Desktop/vibecode/LLMengine');
await page.click('button:has-text("打开地图")');
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.waitForTimeout(1200); // 等 fitView 动画
await step('02-journey-view');

// 3. 点击节点 → 详情面板（该节点解释已缓存，应快速出现）
await page.click('.react-flow__node:has-text("开始新游戏")');
await page.waitForSelector('.detail-panel', { timeout: 10_000 });
await page.waitForSelector('.detail-panel ol li', { timeout: 90_000 }); // 伪代码列表
await step('03-node-detail');

// 4. 影响范围标签
await page.click('.detail-panel button:has-text("影响范围")');
await page.waitForSelector('.detail-panel .chip', { timeout: 15_000 });
await step('04-impact');

// 5. 源码定位
await page.click('.detail-panel button:has-text("源码")');
await page.waitForSelector('.detail-panel .mono >> text=backend', { timeout: 15_000 });
await step('05-source');

// 6. 切换视图：功能地图
await page.click('.view-tab:has-text("功能地图")');
await page.waitForTimeout(1000);
await step('06-features');

// 7. 数据流
await page.click('.view-tab:has-text("数据流")');
await page.waitForTimeout(1000);
await step('07-dataflow');

// 8. 开发者模式 → 技术关系图
await page.click('.mode-toggle button:has-text("开发者模式")');
await page.click('.view-tab:has-text("技术关系")');
await page.waitForTimeout(1200);
await step('08-tech-graph');

// 9. 时间线存在
const timelineText = await page.textContent('.timeline-strip');
console.log('时间线首条：', timelineText?.slice(0, 80));

// 10. 修改历史标签
await page.click('.view-tab:has-text("用户旅程")');
await page.click('.react-flow__node:has-text("进入主菜单")');
await page.waitForSelector('.detail-panel', { timeout: 5000 });
await page.click('.detail-panel button:has-text("历史")');
await page.waitForTimeout(500);
await step('09-history');

console.log(errors.length ? `⚠️ 浏览器报错 ${errors.length} 条：\n${errors.slice(0, 5).join('\n')}` : '✅ 无浏览器报错');
await browser.close();
