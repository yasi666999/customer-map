import { openApp, importCsv, checker } from '../lib.mjs';

export const name = '时间轴 / 拖拽刷选';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);
  const r = await page.evaluate(() => { const b = document.getElementById('ta-track').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const mid = r.y + r.h / 2;

  const init = await page.evaluate(() => document.getElementById('ta-range').textContent);
  c.ok('初始显示全部时间', /全部时间/.test(init), init);

  // 拖出一段
  await page.mouse.move(r.x + r.w * 0.15, mid);
  await page.mouse.down();
  await page.mouse.move(r.x + r.w * 0.45, mid, { steps: 12 });
  const during = await page.evaluate(() => document.getElementById('ta-range').textContent);
  await page.mouse.up();
  await page.waitForTimeout(1100);
  const applied = await page.evaluate(() => ({
    label: document.getElementById('ta-range').textContent,
    win: !document.getElementById('ta-win').hidden,
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value
  }));
  c.ok('拖动时提示"松手应用"', /松手应用/.test(during), during);
  c.ok('松手后应用筛选', applied.win && applied.from !== '' && applied.to !== '', JSON.stringify(applied));
  c.ok('选中窗口可见', applied.win, applied.label);

  // 拖右手柄
  const w = await page.evaluate(() => { const b = document.getElementById('ta-win').getBoundingClientRect(); return { right: b.right, y: b.y + b.height / 2 }; });
  await page.mouse.move(w.right - 5, w.y);
  await page.mouse.down();
  await page.mouse.move(w.right + r.w * 0.2, w.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const afterHandle = await page.evaluate(() => document.getElementById('f-to').value);
  c.ok('拖手柄能扩大范围', afterHandle !== applied.to, applied.to + ' → ' + afterHandle);

  // 平移
  const w2 = await page.evaluate(() => { const b = document.getElementById('ta-win').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const beforeFrom = await page.evaluate(() => document.getElementById('f-from').value);
  await page.mouse.move(w2.x, w2.y);
  await page.mouse.down();
  await page.mouse.move(w2.x - r.w * 0.12, w2.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const afterFrom = await page.evaluate(() => document.getElementById('f-from').value);
  c.ok('按住中间可整体平移', afterFrom !== beforeFrom, beforeFrom + ' → ' + afterFrom);

  // 悬停气泡
  await page.mouse.move(r.x + r.w * 0.6, mid);
  await page.waitForTimeout(300);
  const bub = await page.evaluate(() => ({ hidden: document.getElementById('ta-bub').hidden, text: document.getElementById('ta-bub').textContent }));
  c.ok('悬停显示月份与客户数', !bub.hidden && /客户/.test(bub.text), bub.text);

  // 双击重置
  await page.mouse.dblclick(r.x + r.w * 0.6, mid);
  await page.waitForTimeout(1000);
  const reset = await page.evaluate(() => ({ label: document.getElementById('ta-range').textContent, from: document.getElementById('f-from').value }));
  c.ok('双击重置', /全部时间/.test(reset.label) && reset.from === '', JSON.stringify(reset));

  // 单击选一个月
  await page.mouse.click(r.x + r.w * 0.8, mid);
  await page.waitForTimeout(1000);
  const single = await page.evaluate(() => document.getElementById('ta-range').textContent);
  c.ok('单击选中一个月', /1 个月/.test(single), single);

  /* ---- 快捷区间：日常更多是"我只看最近三个月"，不该每次都手拖 ---- */
  const presets = await page.$$eval('#ta-presets button', (bs) => bs.map((b) => b.textContent.trim()));
  c.ok('有一排快捷区间', presets.length >= 4 && /近 3 月/.test(presets.join('')), presets.join(' / '));
  await page.click('#ta-presets button[data-months="3"]');
  await page.waitForTimeout(900);
  const preset = await page.evaluate(() => ({
    label: document.getElementById('ta-range').textContent,
    from: document.getElementById('f-from').value,
    to: document.getElementById('f-to').value,
    on: [].slice.call(document.querySelectorAll('#ta-presets button'))
      .filter((b) => b.className === 'on').map((b) => b.textContent.trim())
  }));
  c.ok('点「近 3 月」把范围切成 3 个月', /3 个月/.test(preset.label), preset.label);
  c.ok('快捷区间真的写进了时间筛选', preset.from !== '' && preset.to !== '', JSON.stringify(preset));
  c.ok('当前快捷区间被标出来', preset.on.length === 1 && /3/.test(preset.on[0]), JSON.stringify(preset.on));

  await page.click('#ta-presets button[data-months="0"]');
  await page.waitForTimeout(900);
  const backAll = await page.evaluate(() => document.getElementById('ta-range').textContent);
  c.ok('点「全部」能回到整段', /全部时间/.test(backAll), backAll);

  /* ---- 刻度：以前只有一句"全部时间 · 37 个月"，看不出覆盖了什么时候 ---- */
  const ticks = await page.$$eval('#ta-ticks span', (ss) => ss.map((x) => x.textContent));
  c.ok('时间轴下面有月份刻度', ticks.length >= 3 && /\/\d\d$/.test(ticks[0]), ticks.join(' '));

  /* ---- 选中区间高亮：柱子分主题色和灰色两种 ---- */
  await page.click('#ta-presets button[data-months="6"]');
  await page.waitForTimeout(900);
  const colors = await page.evaluate(() => {
    const cv = document.getElementById('ta-canvas');
    const g = cv.getContext('2d');
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let blue = 0, gray = 0;
    for (let i = 0; i < d.length; i += 4 * 3) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (b > r + 40) { blue++; }
      else if (Math.abs(r - gg) < 14 && Math.abs(gg - b) < 14 && r > 80 && r < 230) { gray++; }
    }
    return { blue, gray };
  });
  c.ok('选中的区间是主题色、区间外是灰色', colors.blue >= 5 && colors.gray >= 5, JSON.stringify(colors));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
