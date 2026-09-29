import fs from 'node:fs';
import { openApp, importCsv, checker, CSV } from '../lib.mjs';

export const name = '导入 / 统计 / 数据页';

/* 期望值从导入的那份 CSV 现算，不写死任何业务数字：
   换本机数据、换成兜底示例数据，这条断言都成立。 */
function csvRowCount(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
}

export default async function run(browser) {
  const c = checker();
  const expected = csvRowCount(CSV);
  const page = await openApp(browser);
  await importCsv(page);

  const st = await page.evaluate(() => ({
    total: document.getElementById('st-total').textContent,
    cust: document.getElementById('st-cust').textContent,
    ok: document.getElementById('st-ok').textContent
  }));
  c.eq('总行数', st.total.replace(/,/g, ''), String(expected));
  c.ok('客户总数已统计', parseInt(st.cust.replace(/,/g, ''), 10) > 0, st.cust);
  c.ok('已定位数已统计', parseInt(st.ok.replace(/,/g, ''), 10) > 0, st.ok);

  await page.click('#viewswitch button[data-view="data"]');
  await page.waitForTimeout(1500);
  /* 文案形如「共 12,345 条（表格只载入前 2 万条）」——只取第一个数字，
     否则后面"2 万"会被拼进来。 */
  const listCount = await page.textContent('#list-count');
  const m = String(listCount).match(/([\d,]+)\s*条/);
  const shown = m ? parseInt(m[1].replace(/,/g, ''), 10) : NaN;
  c.ok('数据页计数与导入行数一致', shown === expected, listCount + ' 期望 ' + expected);

  /* 关键断言：不能只查文案，必须数出真正渲染出来的行。
     之前 ag-grid 没渲染出来时，这条能兜住。 */
  const listDom = await page.evaluate(() => {
    const box = document.getElementById('list');
    const rows = box.querySelectorAll('.item, .ag-row, tbody tr').length;
    return { rows: rows, empty: box.innerHTML.length === 0, h: box.clientHeight };
  });
  c.ok('数据页真的渲染出了行', listDom.rows > 0, JSON.stringify(listDom));
  c.ok('数据页容器非空', !listDom.empty, JSON.stringify(listDom));

  // 滚动到底部，确认虚拟滚动能把后面的行也画出来
  const scrolled = await page.evaluate(async () => {
    const box = document.getElementById('list');
    const before = box.innerText.slice(0, 40);
    box.scrollTop = box.scrollHeight;
    await new Promise(r => setTimeout(r, 600));
    const rows = box.querySelectorAll('.item, .ag-row, tbody tr').length;
    return { rows: rows, changed: box.innerText.slice(0, 40) !== before };
  });
  c.ok('滚到底部仍能渲染行', scrolled.rows > 0, JSON.stringify(scrolled));
  await page.evaluate(() => { document.getElementById('list').scrollTop = 0; });

  await page.click('#viewswitch button[data-view="map"]');
  await page.waitForTimeout(400);
  const layer = await page.evaluate(() => window.__cm.layer());
  c.ok('地图点图层有内容', layer && layer.items > 0, JSON.stringify(layer));

  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
