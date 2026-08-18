/** 视图内新构想（突发奇想）+ 拖动持久化的浏览器测试。用法：npx tsx scripts/browser-test-builder.ts */
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

await page.goto(BASE);
await page.fill('#path-input', 'C:/Users/AcademicEsu/Desktop/vibecode/LLMengine');
await page.click('button:has-text("打开地图")');
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.waitForTimeout(1000);

// ===== 测试 1：地图节点拖动 + 数据坐标持久化 =====
const node = page.locator('.react-flow__node', { hasText: '开始新游戏' }).first();
const before = (await node.boundingBox())!;
await page.mouse.move(before.x + before.width / 2, before.y + 10);
await page.mouse.down();
await page.waitForTimeout(150);
await page.mouse.move(before.x + before.width / 2 + 120, before.y + 80, { steps: 8 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(600);
const parseXY = (t: string) => t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)!.slice(1).map(Number);
const flowBefore = parseXY(await node.evaluate(el => (el as HTMLElement).style.transform));
await page.reload();
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.waitForTimeout(1500);
const flowAfter = parseXY(await page.locator('.react-flow__node', { hasText: '开始新游戏' }).first()
  .evaluate(el => (el as HTMLElement).style.transform));
const kept = Math.abs(flowAfter[0] - flowBefore[0]) < 2 && Math.abs(flowAfter[1] - flowBefore[1]) < 2;
console.log(kept ? '✅ 拖动位置刷新后保持' : `❌ 位置丢失: ${flowBefore} → ${flowAfter}`);

// ===== 测试 2：在用户旅程视图上直接画新构想 =====
await page.click('button:has-text("突发奇想")');
await page.waitForSelector('.map-node.draft', { timeout: 5000 });
console.log('✅ 草稿模块出现在用户旅程图上');

const draft = page.locator('.react-flow__node:has(.map-node.draft)').first();
await draft.locator('input').fill('每日签到奖励');
await draft.locator('textarea').fill('玩家每天第一次进入主菜单时弹出签到奖励');

// 把草稿拖到主菜单节点附近（右下方空地）
const menuNode = page.locator('.react-flow__node', { hasText: '进入主菜单' }).first();
const menuBox = (await menuNode.boundingBox())!;
const draftBox = (await draft.boundingBox())!;
await page.mouse.move(draftBox.x + draftBox.width / 2, draftBox.y + 6);
await page.mouse.down();
await page.waitForTimeout(150);
await page.mouse.move(menuBox.x + menuBox.width / 2 + 60, menuBox.y + 220, { steps: 10 });
await page.waitForTimeout(120);
await page.mouse.up();
await page.waitForTimeout(400);

// 连线：现有节点「进入主菜单」的 source 手柄 → 草稿的 target 手柄
await menuNode.hover();
await page.waitForTimeout(200);
const srcHandle = (await menuNode.locator('.react-flow__handle.source').boundingBox())!;
const draftBox2 = (await draft.boundingBox())!;
const dstHandle = (await draft.locator('.react-flow__handle.target').boundingBox())!;
await page.mouse.move(srcHandle.x + srcHandle.width / 2, srcHandle.y + srcHandle.height / 2);
await page.mouse.down();
await page.waitForTimeout(200);
await page.mouse.move((srcHandle.x + dstHandle.x) / 2, (srcHandle.y + dstHandle.y) / 2, { steps: 8 });
await page.waitForTimeout(150);
await page.mouse.move(dstHandle.x + dstHandle.width / 2, dstHandle.y + dstHandle.height / 2, { steps: 8 });
await page.waitForTimeout(150);
await page.mouse.up();
await page.waitForTimeout(500);

const edgeEditor = page.locator('input[aria-label="连线含义"]');
if (await edgeEditor.count()) {
  await edgeEditor.fill('进入主菜单时检查今天是否已签到');
  await page.click('button:has-text("好了")');
  console.log('✅ 现有环节连到新构想，并写上含义');
} else {
  console.log('❌ 连线编辑器没出现（连线失败）');
  console.log('   draft位置:', JSON.stringify(draftBox2), '\n   src手柄:', JSON.stringify(srcHandle));
}
await page.waitForTimeout(1000);
await page.screenshot({ path: `${SHOTS}/11-draft-on-journey.png` });

// 刷新验证草稿持久化在旅程视图上
await page.reload();
await page.waitForSelector('.react-flow__node', { timeout: 30_000 });
await page.waitForTimeout(1200);
const draftCount = await page.locator('.map-node.draft').count();
const draftTitle = draftCount ? await page.locator('.react-flow__node:has(.map-node.draft)').first().locator('input').inputValue() : '';
console.log(draftCount === 1 && draftTitle ? `✅ 草稿随视图持久化（「${draftTitle}」）` : `❌ 草稿丢失 (count=${draftCount})`);

// 确认发给 AI（到计划阶段）
await page.click('button:has-text("交给 AI 实现")');
await page.waitForSelector('button:has-text("开始执行")', { timeout: 10_000 });
console.log('✅ 构想打包成修改单（含现有环节的真实源码上下文）');
await page.screenshot({ path: `${SHOTS}/12-draft-sent.png` });

console.log(errors.length ? `⚠️ 浏览器报错：\n${errors.slice(0, 5).join('\n')}` : '✅ 无浏览器报错');
await browser.close();
