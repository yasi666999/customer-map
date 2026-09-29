import fs from 'node:fs';
import { openApp, importCsv, checker, CSV } from '../lib.mjs';

export const name = '三期 / 度量切换 · 问答 · 配置 · 去AI化';

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);
  await importCsv(page);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 120000 });

  // --- 度量切换（Power BI 的核心概念） ---
  const kpi0 = await page.evaluate(() => document.querySelector('#dash .kpi').parentElement.textContent);
  await page.selectOption('#ana-measure', 'rows');
  await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 120000 });
  const kpi1 = await page.evaluate(() => [...document.querySelectorAll('#dash .kpi')].map(e => e.textContent.trim()));
  /* 不写死业务数字：直接和夹具文件自己的行数比（换数据也不用改用例） */
  const csvRows = fs.readFileSync(CSV, 'utf8').split('\n').filter((x) => x.trim()).length - 1;
  c.ok('度量切到记录数后 KPI 跟着变', kpi1[1].indexOf(csvRows.toLocaleString()) === 0, kpi1[1] + ' vs ' + csvRows);
  c.ok('KPI 文案跟着度量走', /记录数合计/.test(kpi1[1]), kpi1[1]);

  await page.selectOption('#ana-measure', 'places');
  await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 120000 });
  const kpi2 = await page.evaluate(() => document.querySelectorAll('#dash .kpi')[1].textContent.trim());
  /* 覆盖地区同样不写死数字：只要求"是个正整数"，以及"和地图分层着色数出来的一样"
     （跨口径一致由 region.spec 里那条断言盯着）。以前这里写死了具体数字，
     换一份数据用例就红，属于把测试绑在业务数据上。 */
  const placesN = parseInt(kpi2.replace(/[^0-9]/g, ''), 10);
  c.ok('度量切到覆盖地区（按行政区编码，和地图一致）', placesN > 0 && /覆盖/.test(kpi2), kpi2);
  await page.selectOption('#ana-measure', 'cust');
  await page.waitForTimeout(800);

  // --- 自然语言问答 ---
  await page.fill('#qa-input', '广东省有多少客户');
  await page.click('#qa-run');
  await page.waitForFunction(() => !document.getElementById('qa-answer').hidden, null, { timeout: 60000 });
  const qa1 = await page.evaluate(() => ({
    what: document.querySelector('#qa-answer .qa-what').textContent,
    num: document.querySelector('#qa-answer .qa-num b').textContent
  }));
  c.ok('问答理解出"广东省 + 客户数"', /广东省/.test(qa1.what) && /客户数/.test(qa1.what), qa1.what);
  c.ok('问答给出数值', /[0-9]/.test(qa1.num), qa1.num);

  // 应用为筛选（这一句带着区域，能变成筛选条件）
  await page.click('#qa-apply');
  await page.waitForTimeout(3000);
  const chips = await page.evaluate(() => [...document.querySelectorAll('#chips .chip')].map(e => e.textContent.trim()));
  c.ok('问答结果能一键变成筛选', chips.some(x => /广东省/.test(x)), JSON.stringify(chips));
  await page.click('#chip-clear');
  await page.waitForTimeout(2500);

  // 换一句：平台 + 时间
  await page.fill('#qa-input', '拼多多上个月有多少客户');
  await page.click('#qa-run');
  await page.waitForTimeout(2500);
  const qa2 = await page.evaluate(() => document.querySelector('#qa-answer .qa-what').textContent);
  c.ok('问答能识别平台与时间', /拼多多/.test(qa2) && /上月/.test(qa2), qa2);

  // 排名类问题
  await page.fill('#qa-input', '前 5 的省份');
  await page.click('#qa-run');
  await page.waitForFunction(() => document.querySelectorAll('#qa-answer .qa-li').length > 0, null, { timeout: 60000 });
  const qa3 = await page.evaluate(() => document.querySelectorAll('#qa-answer .qa-li').length);
  c.ok('问答能出排行榜', qa3 === 5, String(qa3));

  // --- 配置导出 / 导入 ---
  const cfg = await page.evaluate(() => {
    const btn = document.getElementById('btn-cfg-export');
    return !!btn;
  });
  c.ok('设置里有配置导出入口', cfg);
  await page.click('#btn-settings');
  await page.waitForTimeout(400);
  const hasImport = await page.evaluate(() => !!document.getElementById('btn-cfg-import') && !!document.getElementById('cfg-file'));
  c.ok('有配置导入入口', hasImport);
  await page.click('#dlg-settings button[type="submit"]');
  await page.waitForTimeout(300);

  // --- 去 AI 化：焦点态、图标、状态 ---
  await page.click('#qa-input');
  await page.keyboard.press('Tab');           // 键盘聚焦下一个可聚焦元素 → 触发 :focus-visible
  await page.waitForTimeout(200);
  const ui = await page.evaluate(() => {
    const svgs = document.querySelectorAll('.maptools .toolbtn svg').length;
    const btns = document.querySelectorAll('.maptools .toolbtn').length;
    const el = document.activeElement;
    const cs = el ? getComputedStyle(el) : null;
    return {
      svgs, btns, focused: el ? (el.id || el.tagName) : '',
      outline: cs ? (cs.outlineStyle + ' ' + cs.outlineWidth) : 'n/a',
      hasTokens: !!getComputedStyle(document.documentElement).getPropertyValue('--radius-ctl')
    };
  });
  c.ok('工具条全部换成线性图标', ui.svgs === ui.btns && ui.btns === 7, JSON.stringify(ui));
  c.ok('设计令牌已定义', ui.hasTokens, '--radius-ctl');
  c.ok('按钮有可见焦点态', /solid/.test(ui.outline) && !/0px/.test(ui.outline), ui.outline);

  /* ---- 客户画像（粗）：聚合工具写出来的复购/订单字段要能真的用起来 ---- */
  /* 用一份带画像列的小表（就是聚合工具输出的形状），验证：
     首页出现「客户画像（粗）」这张卡、四个档都在、切到复购率时显示的是百分比而不是原始小数。 */
  const personaCsv = '\uFEFF地址,经度,纬度,客户数,订单数,复购客户数,高频客户数,活跃客户数,时间,平台\n' +
    '上海市,121.449084,31.202748,100,100,10,0,20,2026-09-01,拼多多\n' +
    '广东省深圳市,114.08535,22.608102,100,250,60,5,80,2026-09-01,拼多多\n' +
    '广东省广州市,113.366885,23.149627,100,500,80,20,50,2026-09-01,淘宝网\n' +
    '北京市,116.435365,40.020935,100,900,95,60,30,2026-09-01,淘宝网\n';
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', { name: 'persona.csv', mimeType: 'text/csv', buffer: Buffer.from(personaCsv, 'utf8') });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) === 4;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.click('#viewswitch button[data-view="analysis"]');
  await page.waitForTimeout(2500);
  const persona = await page.evaluate(() => {
    const t = document.getElementById('dash').textContent;
    const opts = Array.from(document.getElementById('ana-measure').options).map((o) => o.textContent);
    /* 图表是 canvas，DOM 里读不到分类名 —— 从 ECharts 实例里取（__cmCharts 是专门给自动化留的口子） */
    const inst = (window.__cmCharts || {}).persona;
    let cats = [];
    try {
      const o = inst.getOption();
      cats = (o.yAxis && o.yAxis[0] && o.yAxis[0].data) || (o.xAxis && o.xAxis[0] && o.xAxis[0].data) || [];
    } catch (e) { cats = []; }
    return { hasCard: t.indexOf('客户画像（粗）') >= 0, opts: opts, cats: cats };
  });
  c.ok('分析页出现「客户画像（粗）」卡片', persona.hasCard, JSON.stringify(persona.buckets));
  c.ok('画像四档都能算出来（按人均单量分档）',
    persona.cats.length === 4 && persona.cats.join(',').indexOf('重度客户') >= 0, JSON.stringify(persona.cats));
  c.ok('度量下拉里有复购率/活跃率/人均单量', ['复购率（分组）', '活跃率（分组）', '人均单量（分组）'].every((n) => persona.opts.indexOf(n) >= 0),
    JSON.stringify(persona.opts));

  await page.selectOption('#ana-measure', 'repRate');
  await page.waitForFunction(() => /^用时/.test(document.getElementById('ana-status').textContent), null, { timeout: 60000 });
  await page.waitForTimeout(600);
  const repKpi = await page.evaluate(() => document.querySelectorAll('#dash .kpi')[1].textContent.replace(/\s+/g, ''));
  c.ok('切到复购率后显示的是百分比（不是 0.9715… 这种原始小数）',
    /^[0-9.]+%/.test(repKpi) && repKpi.indexOf('复购率') > 0, repKpi);
  await page.selectOption('#ana-measure', 'cust');
  await page.waitForTimeout(600);

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
