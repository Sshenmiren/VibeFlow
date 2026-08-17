/** 构建蓝图 + 拖动持久化的浏览器测试。用法：npx tsx scripts/browser-test-builder.ts */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:5177';
const SHOTS = 'scripts/screens';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors: string[] = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

// 打开项目
await page.goto(BASE);
await page.fill('#path-input', 'C:/Users/AcademicEsu/Desktop/vibecode/LLMengine');
await page.click('button:has-text("打开地图")');
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.waitForTimeout(800);

// ===== 测试 1：地图节点拖动 + 持久化 =====
const node = page.locator('.react-flow__node', { hasText: '开始新游戏' }).first();
const before = await node.boundingBox();
if (!before) throw new Error('找不到节点');
await page.mouse.move(before.x + before.width / 2, before.y + 10);
await page.mouse.down();
await page.waitForTimeout(150);
await page.mouse.move(before.x + before.width / 2 + 80, before.y + 50, { steps: 6 });
await page.waitForTimeout(120);
await page.mouse.move(before.x + before.width / 2 + 150, before.y + 100, { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(600); // 等保存
const afterDrag = await node.boundingBox();
console.log(`拖动: (${Math.round(before.x)},${Math.round(before.y)}) → (${Math.round(afterDrag!.x)},${Math.round(afterDrag!.y)})`);

// 刷新页面验证位置持久化（比较画布数据坐标，屏幕坐标受 fitView 缩放影响不可靠）
const parseXY = (t: string) => t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)!.slice(1).map(Number);
const flowBefore = parseXY(await node.evaluate(el => (el as HTMLElement).style.transform));
await page.reload();
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.waitForTimeout(1500);
const nodeAfter = page.locator('.react-flow__node', { hasText: '开始新游戏' }).first();
const flowAfter = parseXY(await nodeAfter.evaluate(el => (el as HTMLElement).style.transform));
const kept = Math.abs(flowAfter[0] - flowBefore[0]) < 2 && Math.abs(flowAfter[1] - flowBefore[1]) < 2;
console.log(kept ? `✅ 刷新后位置保持（画布坐标 ${flowAfter.map(Math.round).join(',')}）` : `❌ 位置丢失: ${flowBefore} → ${flowAfter}`);
await page.screenshot({ path: `${SHOTS}/10-drag-persist.png` });

// ===== 测试 2：构建蓝图 =====
await page.click('.view-tab:has-text("构建蓝图")');
await page.waitForTimeout(500);

// 加两个模块
await page.click('button:has-text("＋ 新模块")');
await page.click('button:has-text("＋ 新模块")');
await page.waitForTimeout(300);

const blocks = page.locator('.builder-block');
console.log('模块数：', await blocks.count());

// 填写模块内容
await blocks.nth(0).locator('input').fill('掷骰子按钮');
await blocks.nth(0).locator('textarea').fill('主菜单上有一个掷骰子按钮，点一下随机出1到6的数字');
await blocks.nth(1).locator('input').fill('结果弹窗');
await blocks.nth(1).locator('textarea').fill('用一个小弹窗把骰子结果大大地显示出来，再点一下关闭');

// 连线：模块1 的 source 手柄 → 模块2 的 target 手柄
const src = await blocks.nth(0).locator('.react-flow__handle.source').boundingBox();
const dst = await blocks.nth(1).locator('.react-flow__handle.target').boundingBox();
await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2);
await page.mouse.down();
await page.waitForTimeout(150);
await page.mouse.move((src!.x + dst!.x) / 2, (src!.y + dst!.y) / 2, { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.move(dst!.x + dst!.width / 2, dst!.y + dst!.height / 2, { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(400);

// 连线后应弹出连线编辑器
const edgeEditor = page.locator('input[aria-label="连线含义"]');
if (await edgeEditor.count()) {
  await edgeEditor.fill('把骰子点数传给弹窗显示');
  await page.click('button:has-text("好了")');
  console.log('✅ 连线并写上含义');
} else {
  console.log('❌ 连线编辑器没出现');
}
await page.waitForTimeout(1200); // 等蓝图去抖保存
await page.screenshot({ path: `${SHOTS}/11-builder.png` });

// 刷新验证蓝图持久化
await page.reload();
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.click('.view-tab:has-text("构建蓝图")');
await page.waitForTimeout(800);
const blocksAfter = await page.locator('.builder-block').count();
const title0 = await page.locator('.builder-block').nth(0).locator('input').inputValue();
console.log(blocksAfter === 2 && title0 ? `✅ 蓝图持久化（${blocksAfter} 个模块，标题「${title0}」）` : '❌ 蓝图丢失');

// 确认发给 AI（只到计划阶段，不执行）
await page.click('button:has-text("确认，发给 AI 实现")');
await page.waitForSelector('button:has-text("开始执行")', { timeout: 10_000 });
console.log('✅ 蓝图已打包成修改单，等待执行确认');
await page.screenshot({ path: `${SHOTS}/12-builder-sent.png` });

console.log(errors.length ? `⚠️ 浏览器报错：\n${errors.slice(0, 5).join('\n')}` : '✅ 无浏览器报错');
await browser.close();
