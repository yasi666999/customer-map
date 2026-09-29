import { openApp, checker, ROOT } from '../lib.mjs';
import path from 'node:path';
import fs from 'node:fs';

export const name = '行数据瘦身 / 地址解析路径 · 导出';

/* 另一组用例用的是「自带坐标的汇总表」，走的是快路径。
   这组故意用「不带坐标的订单表」，走完整的清洗 + 本地解析 + 导出，
   把 P0-2 行数据瘦身最容易悄悄改坏的地方（原型兜底字段）钉死在测试里。 */
const CSV_ORDER = path.join(ROOT, '示例_订单数据.csv');
const CSV_DIRTY = path.join(ROOT, 'tests', 'fixtures', 'dirty-quotes.csv');

export default async function run(browser) {
  const c = checker();
  const page = await openApp(browser);

  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', CSV_ORDER);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 400;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(600);

  const imported = await page.evaluate(() => ({
    total: document.getElementById('st-total').textContent,
    todo: document.getElementById('st-todo').textContent
  }));
  c.eq('订单数据全部导入', imported.total, '443');
  c.eq('导入时全部是待解析', imported.todo, '443');

  // --- 行对象结构：实例上只放少数字段，其余靠原型兜底 ---
  const shape = await page.evaluate(() => {
    const rows = window.__cm.state.rows;
    const r0 = rows[0];
    return {
      n: rows.length,
      共用原型: Object.getPrototypeOf(r0) === Object.getPrototypeOf(rows[rows.length - 1]),
      实例字段数: Object.keys(r0).length,
      protos: new Set(rows.map(r => Object.getPrototypeOf(r))).size,
      // 原型兜底字段必须读到「默认值」，而不是 undefined
      id: r0.id, error: r0.error, confidence: r0.confidence, match: r0.match,
      phones是数组: Array.isArray(r0.phones), flags是数组: Array.isArray(r0.flags),
      // 这一份数据里确实有值的字段
      shop: r0.shop, code: r0.code, amount: r0.amount, plat: r0.plat
    };
  });
  c.ok('所有行共用同一个原型（说明瘦身生效）', shape.共用原型 && shape.protos === 1, JSON.stringify({ 共用原型: shape.共用原型, protos: shape.protos }));
  c.ok('实例字段数明显少于 25', shape.实例字段数 < 20, String(shape.实例字段数));
  c.ok('原型兜底字段读到的是默认值而不是 undefined',
    shape.id === '' && shape.error === '' && shape.confidence === null && shape.match === null,
    JSON.stringify({ id: shape.id, error: shape.error, confidence: shape.confidence, match: shape.match }));
  c.ok('phones / flags 仍然是数组', shape.phones是数组 && shape.flags是数组, JSON.stringify(shape));
  c.ok('有值的字段照常落在实例上',
    shape.shop === '示例数码旗舰店' && shape.code === 'SO100001' && shape.amount === 236 && shape.plat === '京东',
    JSON.stringify({ shop: shape.shop, code: shape.code, amount: shape.amount, plat: shape.plat }));

  // --- 解析：走完整的清洗 + 本地地名匹配 ---
  await page.click('#btn-run');
  await page.waitForFunction(() => document.getElementById('btn-run').textContent.indexOf('开始解析') >= 0, null, { timeout: 180000 });
  await page.waitForTimeout(1000);

  const parsed = await page.evaluate(() => {
    const rows = window.__cm.state.rows;
    const bad = [];
    let ok = 0;
    for (const r of rows) {
      if (r.status !== 'ok') { bad.push(r.raw); continue; }
      ok++;
      if (typeof r.lng !== 'number' || typeof r.lat !== 'number') { bad.push('坐标不是数字:' + r.raw); }
      if (!r.level) { bad.push('缺 level:' + r.raw); }
      if (!Array.isArray(r.flags)) { bad.push('flags 不是数组:' + r.raw); }
      if (typeof r.error !== 'string') { bad.push('error 不是字符串:' + r.raw); }
    }
    const r0 = rows[0];
    return {
      ok, bad: bad.slice(0, 5),
      stOk: document.getElementById('st-ok').textContent,
      stTodo: document.getElementById('st-todo').textContent,
      first: { lng: r0.lng, lat: r0.lat, level: r0.level, source: r0.source, m: r0.match && [r0.match.p, r0.match.c, r0.match.d] }
    };
  });
  c.eq('全部 443 条解析成功', parsed.ok, 443);
  c.ok('没有字段类型坏掉的行', parsed.bad.length === 0, JSON.stringify(parsed.bad));
  c.eq('待解析归零', parsed.stTodo, '0');
  c.ok('解析结果落到实例上',
    parsed.first.source === 'local' && typeof parsed.first.lng === 'number' && /福田区/.test(parsed.first.level),
    JSON.stringify(parsed.first));
  c.ok('匹配结果能读到省市区', parsed.first.m && parsed.first.m[0] === '广东省' && parsed.first.m[2] === '福田区', JSON.stringify(parsed.first.m));

  // --- 导出：导出函数会把原型兜底字段一起读出来，能兜住默认值写错的情况 ---
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('#btn-export')
  ]);
  const file = await download.path();
  const csv = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = csv.split(/\r?\n/).filter(x => x.length);
  c.ok('导出表头正确', lines[0].indexOf('原始地址') >= 0 && lines[0].indexOf('经度(高德GCJ02)') >= 0, lines[0].slice(0, 80));
  c.eq('导出行数 = 表头 + 443', lines.length, 444);
  const first = lines[1];
  c.ok('导出内容含原始地址与解析结果',
    first.indexOf('广东省深圳市福田区华强北街道示例路1号示例大厦') >= 0 && first.indexOf('已定位') >= 0,
    first.slice(0, 120));
  c.ok('导出内容含订单字段（编号/平台/店铺/金额）',
    first.indexOf('SO100001') >= 0 && first.indexOf('京东') >= 0 && first.indexOf('示例数码旗舰店') >= 0 && first.indexOf('236') >= 0,
    first.slice(0, 160));

  // --- 脏 CSV 容错：落单的引号不能把后面的行吞掉 ---
  // 导出表里落单引号很常见（整份文件引号个数是奇数），旧实现会成片吞行，
  // 43% 的数据无声无息丢了。这条断言就是钉住这个行为。
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', CSV_DIRTY);
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) > 10;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(500);

  const dirty = await page.evaluate(() => {
    const rows = window.__cm.state.rows;
    const raws = rows.map(r => r.raw);
    return {
      n: rows.length,
      总行数: document.getElementById('st-total').textContent,
      带引号的行: raws.filter(x => x.indexOf('"') >= 0).length,
      保留中途引号: raws.some(x => x.indexOf('门牌16"院内') >= 0),
      有未闭合引号那行: raws.some(x => /示例路137号/.test(x)),
      有最后一行: raws.some(x => /示例路10号/.test(x))
    };
  });
  c.eq('脏引号不影响行数（40 行全部导入）', dirty.n, 40);
  c.ok('字段中间的引号按普通字符保留', dirty.保留中途引号 && dirty.带引号的行 >= 1, JSON.stringify(dirty));
  c.ok('未闭合的引号没有吞掉后面的行', dirty.有未闭合引号那行 && dirty.有最后一行, JSON.stringify(dirty));

  /* ---- 只有 省 + 市 编码的订单表（很常见的一种导出形态）----
     以前这种情况 lookupByCode 会退化成"扫到同 4 位前缀的第一个区县"，
     于是整个深圳的行都被贴成"罗湖区"、坐标也落在那个区。现在按城市中心点定位，
     匹配结果里没有区县（d 为空），城市名和坐标都是城市级的。 */
  const cityCsv = '\uFEFFprovince,city,shop_name,platform,phone\n' +
    '440000,440300,示例-测试店铺,拼多多,19593403028\n' +
    '440000,440300,示例-测试店铺,拼多多,19593403028\n' +
    '110000,110100,示例-北京店,淘宝网,13800138000\n' +
    '540000,540600,示例-那曲店,快手,13900139000\n';
  await page.click('#btn-import');
  await page.setInputFiles('#imp-file', { name: 'city-only.csv', mimeType: 'text/csv', buffer: Buffer.from(cityCsv, 'utf8') });
  await page.waitForFunction(() => {
    const l = document.getElementById('loading'), s = document.getElementById('st-total');
    return l && l.hidden && s && parseInt((s.textContent || '0').replace(/,/g, ''), 10) === 4;
  }, null, { timeout: 60000 });
  // 省市编码的行要跑一遍本地解析（和日常用法一样：导入完点「开始解析」）
  await page.click('#btn-run');
  await page.waitForFunction(() => {
    const s = document.getElementById('st-total'), ok = document.getElementById('st-ok'), b = document.getElementById('btn-run');
    if (!s || !ok || !b) { return false; }
    const n = parseInt((s.textContent || '0').replace(/,/g, ''), 10);
    const o = parseInt((ok.textContent || '0').replace(/,/g, ''), 10);
    return b.textContent.indexOf('开始解析') === 0 && n > 0 && o === n;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(400);
  const cityRows = await page.evaluate(() => window.__cm.state.rows.map((r) => ({
    q: r.quality, p: r.match && r.match.p, c: r.match && r.match.c, d: r.match && r.match.d,
    lng: r.lng, lat: r.lat, shop: r.shop, plat: r.plat, phone: r.phone2
  })));
  const sz = cityRows[0];
  c.eq('只有省市编码也能定位（4 行全部定位成功）', cityRows.filter((r) => r.q).length, 4);
  c.ok('省市编码按"城市"定位，不硬塞一个区县进去',
    sz && sz.q === 'city' && sz.p === '广东省' && sz.c === '深圳市' && (sz.d === '' || sz.d == null),
    JSON.stringify(sz));
  c.ok('城市级定位用的是城市中心点',
    sz && Math.abs(sz.lng - 114.085) < 0.05 && Math.abs(sz.lat - 22.608) < 0.05,
    JSON.stringify([sz && sz.lng, sz && sz.lat]));
  const bj = cityRows[2];
  c.ok('直辖市也走城市级（北京市）', bj && bj.q === 'city' && bj.c === '北京市', JSON.stringify(bj));
  const naqu = cityRows[3];
  c.ok('地名库里没收录的市退回省级，不硬编坐标',
    naqu && naqu.q === 'province' && naqu.p === '西藏自治区', JSON.stringify(naqu));
  c.ok('订单表自带的店铺 / 平台 / 手机号被认出来',
    sz && sz.shop === '示例-测试店铺' && sz.plat === '拼多多' && sz.phone === '19593403028',
    JSON.stringify({ shop: sz && sz.shop, plat: sz && sz.plat, phone: sz && sz.phone }));
  c.results.push({ name: '没有页面报错', pass: page.__errors.length === 0, detail: page.__errors.join(' | ') });
  await page.close();
  return c.results;
}
