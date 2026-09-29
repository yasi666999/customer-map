import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseTime, matchHeader, parseCsv, detectColumns, buildRecordFromCells,
  importCsvPipelined, buildRecords, textToRecords, makeInterner,
  ROW_PROTO, EMPTY_ARR, MAX_QUOTED_LINES
} from '../../src/data/import-parse.js';

/* 这一组是拆模块时补上的：解析层以前埋在 main.js 里，只能靠端到端用例覆盖，
   想单测一段 CSV 的解析行为得先起浏览器。拆出来之后这里直接跑。 */

describe('import-parse / 时间解析', () => {
  it('认得常见日期时间写法', () => {
    expect(parseTime('2026-09-01 12:30:00')).toBe(new Date(2026, 8, 1, 12, 30, 0).getTime());
    expect(parseTime('2026/9/1')).toBe(new Date(2026, 8, 1, 0, 0, 0).getTime());
  });
  it('认得 Excel 序列号和两种时间戳', () => {
    expect(parseTime(45000)).toBe(Math.round((45000 - 25569) * 86400000));   // Excel 序列号
    expect(parseTime(1756000000)).toBe(1756000000000);                      // 秒级
    expect(parseTime(1756000000000)).toBe(1756000000000);                   // 毫秒级
  });
  it('认不出来就返回 null，不是 NaN', () => {
    expect(parseTime('')).toBe(null);
    expect(parseTime(null)).toBe(null);
    expect(parseTime('不是时间')).toBe(null);
    expect(parseTime(123)).toBe(null);
  });
});

describe('import-parse / 表头识别', () => {
  it('完整匹配和包含匹配都认', () => {
    expect(matchHeader('收货地址', ['地址'])).toBe(true);
    expect(matchHeader('receiving_address', ['收货地址'])).toBe(false);
    expect(matchHeader('create_time', ['create_time'])).toBe(true);
  });
  it('单字关键字不做包含匹配（否则「市」会把「城市编码」也吃了）', () => {
    expect(matchHeader('城市', ['市'])).toBe(false);
    expect(matchHeader('市', ['市'])).toBe(true);
  });
  it('时间列按 create_time 优先，而不是按列位置', () => {
    const cols = detectColumns(['地址', 'trade_time', 'create_time']);
    expect(cols.header[cols.mi]).toBe('create_time');
    expect(cols.timeCol).toBe('create_time');
    expect(cols.ai).toBe(0);
  });
  it('没有表头时给出提示，并退回第一列当地址', () => {
    const cols = detectColumns(['广东省深圳市福田区', '1']);
    expect(cols.hasHeader).toBe(false);
    expect(cols.warn).toMatch(/没识别到表头/);
    expect(cols.ai).toBe(0);
  });
  it('只有省市区编码时进入编码模式，不当成没表头', () => {
    const cols = detectColumns(['province', 'city', 'area']);
    expect(cols.codeMode).toBe(true);
    expect(cols.hasHeader).toBe(true);
    expect(cols.warn).toBe('');
  });
  it('有表头但没有地址列时给提示', () => {
    const cols = detectColumns(['order_code', 'platform']);
    expect(cols.hasHeader).toBe(true);
    expect(cols.warn).toMatch(/没找到地址列/);
  });
});

describe('import-parse / 一行 → 一条记录', () => {
  const cols = detectColumns(['地址', '客户数', 'create_time', 'platform', '手机号']);
  it('正常行能取出地址 / 数量 / 时间 / 平台 / 电话', () => {
    const rec = buildRecordFromCells(['广东省深圳市福田区华强北街道', '12', '2026-09-01 08:00:00', '京东', '138 0000 0000'], cols);
    expect(rec.raw).toBe('广东省深圳市福田区华强北街道');
    expect(rec.count).toBe(12);
    expect(rec.plat).toBe('京东');
    expect(rec.phone).toBe('13800000000');
    expect(rec.t).toBe(new Date(2026, 8, 1, 8, 0, 0).getTime());
  });
  it('分隔线这种垃圾行直接丢掉', () => {
    expect(buildRecordFromCells(['-----'], cols)).toBe(null);
    expect(buildRecordFromCells([''], cols)).toBe(null);
    expect(buildRecordFromCells(null, cols)).toBe(null);
  });
  it('表头写了「百度」就按 BD09 标记坐标来源', () => {
    const c2 = detectColumns(['地址', '经度(百度BD09)', '纬度(百度BD09)']);
    const rec = buildRecordFromCells(['某地', '116.4', '39.9'], c2);
    expect(rec.coord).toBe('bd09');
    expect(rec.lng).toBeCloseTo(116.4, 5);
  });
});

describe('import-parse / CSV 解析', () => {
  it('带引号的字段里的逗号不当分隔符', () => {
    const rows = parseCsv('a,"b,c",d\n1,2,3');
    expect(rows[0]).toEqual(['a', 'b,c', 'd']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });
  it('引号里的换行算字段内容', () => {
    const rows = parseCsv('a,"第一行\n第二行",c');
    expect(rows[0][1]).toBe('第一行\n第二行');
  });
  it('引号区间跨行超过阈值时判定为脏引号，回退重跑，后面的行照常保留', () => {
    // 容错规则 2：跨行超过 MAX_QUOTED_LINES（20）还没闭合 → 回退到引号位置当普通字符重跑。
    // 这是为那些有一堆落单引号的导出表加的（旧实现会丢掉 43% 的行）。
    const body = Array.from({ length: MAX_QUOTED_LINES + 5 }, (_, i) => '广东省深圳市福田区第' + i + '号,1').join('\n');
    const rows = parseCsv('地址,数量\n"' + body + '\n山东省青岛市示例路10号,2');
    const flat = rows.map(r => r.join(',')).join('\n');
    expect(flat).toMatch(/示例路10号/);
    expect(flat).toMatch(/第0号/);
    expect(rows.length).toBeGreaterThan(MAX_QUOTED_LINES);
  });
  it('跨行没超过阈值的引号仍然算"引号里的换行"（不能误判成脏引号）', () => {
    const rows = parseCsv('地址,备注\n"广东省深圳市\n福田区",x');
    expect(rows.length).toBe(2);
    expect(rows[1][0]).toBe('广东省深圳市\n福田区');
  });
  it('BOM 会被剥掉', () => {
    expect(parseCsv('\uFEFFa,b')[0][0]).toBe('a');
  });
});

describe('import-parse / 流式解析', () => {
  it('分片跑完并把记录交出来，表头信息走回调', async () => {
    const text = '地址,客户数,create_time\n' + Array.from({ length: 50 }, (_, i) => `广东省深圳市福田区第${i}号,${i + 1},2026-09-01 00:00:00`).join('\n');
    let colsSeen = null;
    const recs = await importCsvPipelined(text, null, null, (c) => { colsSeen = c; });
    expect(recs.length).toBe(50);
    expect(recs[0].count).toBe(1);
    expect(colsSeen).not.toBe(null);
    expect(colsSeen.timeCol).toBe('create_time');
  });
  it('isAborted 返回 true 就中断', async () => {
    const text = '地址\n' + Array.from({ length: 100 }, (_, i) => '广东省深圳市第' + i + '号').join('\n');
    const recs = await importCsvPipelined(text, () => {}, () => true);
    expect(recs.length).toBe(0);
  });
  it('脏 CSV 样例：40 行一条不少', async () => {
    const csv = fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'dirty-quotes.csv'), 'utf8');
    const recs = await importCsvPipelined(csv);
    expect(recs.length).toBe(40);
    const raws = recs.map(r => r.raw);
    expect(raws.some(x => x.indexOf('门牌16"院内') >= 0)).toBe(true);   // 字段中间的引号保留
    expect(raws.some(x => /示例路137号/.test(x))).toBe(true);            // 未闭合引号那行还在
    expect(raws.some(x => /示例路10号/.test(x))).toBe(true);           // 最后一行也在
  });
  it('Excel 路径：整表进来，自动跳过表头行', () => {
    const rows = [['地址', '客户数'], ['广东省深圳市福田区', '3'], ['浙江省杭州市余杭区', '5']];
    let colsSeen = null;
    const recs = buildRecords(rows, (c) => { colsSeen = c; });
    expect(recs.length).toBe(2);
    expect(recs[0].count).toBe(3);
    expect(colsSeen.hasHeader).toBe(true);
  });
});

describe('import-parse / 纯文本与瘦身基础设施', () => {
  it('一行一个地址，空行和分隔线跳过', () => {
    const recs = textToRecords('广东省深圳市福田区\n\n----\n浙江省杭州市余杭区\n');
    expect(recs.length).toBe(2);
    expect(recs[0].raw).toBe('广东省深圳市福田区');
    expect(recs[0].lng).toBe(null);
  });
  it('去重字典在容量内返回同一个字符串对象，超了就原样返回', () => {
    const intern = makeInterner(2);
    const a = intern('广东省深圳市');
    expect(intern('广东省深圳市')).toBe(a);
    const c = '浙江省杭州市';
    expect(intern(c)).toBe(c);
    const d = '江苏省南京市';
    expect(intern(d)).toBe(d);
  });
  it('原型兜底字段读到的是默认值，不是 undefined', () => {
    expect(ROW_PROTO.id).toBe('');
    expect(ROW_PROTO.error).toBe('');
    expect(ROW_PROTO.confidence).toBe(null);
    expect(ROW_PROTO.match).toBe(null);
    expect(Array.isArray(ROW_PROTO.phones)).toBe(true);
    expect(ROW_PROTO.flags).toBe(EMPTY_ARR);
    expect(Object.isFrozen(EMPTY_ARR)).toBe(true);
  });
  it('脏引号阈值是有意留的 20 行，不是随手写的', () => {
    expect(MAX_QUOTED_LINES).toBe(20);
  });
});
