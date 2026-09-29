import { describe, it, expect } from 'vitest';
import { REGION_LEVELS, regionLen, regionLevelLabel, regionBucket, regionSql, DIMENSIONS, MEASURES, measureKeyOf, measureList, sumKeysOf, measureValue, sizeBucketOf, SIZE_BUCKETS, formatValue, monthIndex, monthKeyOfIndex, prevMonth, calendarMonths, monthKey, regionLevelOfCodes, regionUnitOf, coverageLabelOf, personaBucketOf, PERSONA_BUCKETS } from '../../src/analysis/semantic.js';

/* 语义层 = Power BI 的「模型」：维度只有一种口径、度量是定义、日期是连续的。
   这一组盯的就是这三件事不许被改回去。 */

describe('语义层 / 地区维度（唯一口径）', () => {
  it('按层级归桶：省 2 位 / 市 4 位 / 区县 6 位', () => {
    expect(regionBucket('440304', 'province')).toBe('44');
    expect(regionBucket('440304', 'city')).toBe('4403');
    expect(regionBucket('440304', 'district')).toBe('440304');
  });
  it('编码不够长就归不进去（返回空串，而不是硬凑）', () => {
    expect(regionBucket('4403', 'district')).toBe('');
    expect(regionBucket('44', 'city')).toBe('');
    expect(regionBucket('', 'province')).toBe('');
    expect(regionBucket(null, 'district')).toBe('');
  });
  it('非数字字符被清掉（编码里混进空格、横线也能认）', () => {
    expect(regionBucket(' 440304 ', 'district')).toBe('440304');
    expect(regionBucket('44-03-04', 'district')).toBe('440304');
  });
  it('层级定义完整，每个都有 key/label/位数', () => {
    expect(REGION_LEVELS.map((l) => l.key)).toEqual(['province', 'city', 'district']);
    expect(regionLen('province')).toBe(2);
    expect(regionLen('nope')).toBe(2);        // 不认识的层级退回省级
    expect(regionLevelLabel('district')).toBe('区县');
  });
  it('SQL 表达式和 JS 归桶是同一套规则（两条通道必须一致）', () => {
    const d = regionSql('district');
    // 显式 CAST：adcode 全是数字，不转换的话 DuckDB 会当成整数，length() 直接报错
    expect(d.expr).toBe('substr(CAST(adcode AS VARCHAR), 1, 6)');
    expect(d.cond).toBe('length(CAST(adcode AS VARCHAR)) >= 6');
    expect(regionSql('city').expr).toBe('substr(CAST(adcode AS VARCHAR), 1, 4)');
  });
});

describe('语义层 / 度量是定义，不是代码', () => {
  it('每个度量都有 label / kind / sql', () => {
    for (const [k, d] of Object.entries(MEASURES)) {
      expect(typeof d.label, k).toBe('string');
      expect(typeof d.kind, k).toBe('string');
      expect(typeof d.sql, k).toBe('string');
    }
  });
  it('度量列表带 key / label / 格式，够生成下拉', () => {
    const list = measureList();
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.map((m) => m.key)).toContain('amount');
    expect(list.map((m) => m.key)).toContain('aov');
    expect(list[0].key).toBe('cust');
  });
  it('不认识的度量名回退到客户数', () => {
    expect(measureKeyOf('nope')).toBe('cust');
    expect(measureKeyOf(undefined)).toBe('cust');
  });
  it('sum 类：在分组累加器上直接取值', () => {
    expect(measureValue('cust', { cust: 42 })).toBe(42);
    expect(measureValue('rows', { rows: 7 })).toBe(7);
    expect(measureValue('amount', { amount: 123.5 })).toBe(123.5);
  });
  it('distinct 类：取集合大小', () => {
    expect(measureValue('places', { _set_places: new Set(['a', 'b', 'c']) })).toBe(3);
    expect(measureValue('places', {})).toBe(0);
    expect(measureValue('shops', { _set_shops: new Set(['x']) })).toBe(1);
  });
  it('calc 类：比率由依赖项算出来，不是逐行平均', () => {
    // 客单价 = 金额 / 客户数（先在分组里聚合，再相除 —— 等价于 DAX 的 DIVIDE）
    expect(measureValue('aov', { amount: 1000, cust: 4 })).toBe(250);
    expect(measureValue('aov', { amount: 1000, cust: 0 })).toBe(0);   // 不除零
  });
  it('派生度量会声明它依赖哪些和', () => {
    expect(sumKeysOf('cust')).toEqual(['cust']);
    expect(sumKeysOf('aov').sort()).toEqual(['amount', 'cust']);
    expect(sumKeysOf('places')).toEqual([]);   // 去重类不需要"和"
  });
});

describe('语义层 / 日期表', () => {
  it('月份序号与月份键能来回换', () => {
    expect(monthKeyOfIndex(monthIndex('2026-01'))).toBe('2026-01');
    expect(monthKeyOfIndex(monthIndex('2026-12'))).toBe('2026-12');
  });
  it('上月按日历算，会跨年', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-09')).toBe('2026-08');
  });
  it('连续月份会把缺的月补出来（环比才拿得到日历上个月）', () => {
    expect(calendarMonths(['2026-01', '2026-04'])).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(calendarMonths(['2025-12', '2026-02'])).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('月份乱序也会先排好', () => {
    expect(calendarMonths(['2026-03', '2026-01'])).toEqual(['2026-01', '2026-02', '2026-03']);
  });
  it('空数据返回空数组，不炸', () => {
    expect(calendarMonths([])).toEqual([]);
    expect(calendarMonths(null)).toEqual([]);
  });
  it('时间戳转月份键（本地时区）', () => {
    expect(monthKey(new Date(2026, 8, 15).getTime())).toBe('2026-09');
  });
});


describe('语义层 / 客户规模分档', () => {
  it('按 1 / 10 / 100 / 1000 分四档', () => {
    expect(sizeBucketOf(1)).toBe('1–9');
    expect(sizeBucketOf(9)).toBe('1–9');
    expect(sizeBucketOf(10)).toBe('10–99');
    expect(sizeBucketOf(99)).toBe('10–99');
    expect(sizeBucketOf(100)).toBe('100–999');
    expect(sizeBucketOf(999)).toBe('100–999');
    expect(sizeBucketOf(1000)).toBe('1000 以上');
  });
  it('边界值落在大的那一档（10 不算 1–9）', () => {
    expect(sizeBucketOf(10)).not.toBe('1–9');
    expect(sizeBucketOf(100)).not.toBe('10–99');
    expect(sizeBucketOf(1000)).not.toBe('100–999');
  });
  it('count 为 0 或空按 1 算（一个地点至少一个客户）', () => {
    expect(sizeBucketOf(0)).toBe('1–9');
    expect(sizeBucketOf(null)).toBe('1–9');
    expect(sizeBucketOf(undefined)).toBe('1–9');
  });
  it('维度表里的 SQL 分支和 JS 的分档边界一致（两条通道不能各说各话）', () => {
    // SQL 里写的是 cnt >= 1000 / >= 100 / >= 10，和 SIZE_BUCKETS 必须对得上
    const sql = DIMENSIONS.size.sql;
    SIZE_BUCKETS.forEach((b) => { expect(sql).toContain('>= ' + b.min); });
    expect(sql).toContain("'1–9'");   // 兜底那一档也必须一样
  });
});

describe('语义层 / 数字格式', () => {
  it('金额用元 / 万 / 亿', () => {
    expect(formatValue(1234.5, 'money')).toBe('1234.50');
    expect(formatValue(12345678, 'money')).toBe('1234.57 万');
    expect(formatValue(1234567890, 'money')).toBe('12.35 亿');
  });
  it('数量给精确数字 + 千分位（KPI 要给人看准数，不缩写）', () => {
    expect(formatValue(999, 'num')).toBe('999');
    expect(formatValue(1234567, 'num')).toBe('1,234,567');
    expect(formatValue(123456, 'num')).toBe('123,456');
  });
  it('负数保留符号', () => {
    expect(formatValue(-1234567, 'num')).toBe('-1,234,567');
    expect(formatValue(-12345678, 'money')).toBe('-1234.57 万');
  });
  it('空值当 0', () => {
    expect(formatValue(null, 'num')).toBe('0');
    expect(formatValue(undefined, 'money')).toBe('0.00');
  });

  it('地区层级按行数取多数 —— 少量"市级标签被匹到区县"的行不能改变口径', () => {
    // 真实场景：汇总表是按市级聚合的，但再解析时 "湖南省长沙市" 里的 "长沙" 会命中 "长沙县"
    const mixed = new Array(5000).fill('310100').concat(['430121', '430121', '430121', '430121', '430121']);
    expect(regionLevelOfCodes(mixed)).toBe('city');
    expect(regionUnitOf('city')).toBe('城市');
    expect(coverageLabelOf('city')).toBe('覆盖城市');
  });

  it('真有区县数据时判成区县；只有省级码时判成省', () => {
    expect(regionLevelOfCodes(['310101', '310104', '440303'])).toBe('district');
    expect(regionLevelOfCodes(['310000', '440000'])).toBe('province');
    expect(coverageLabelOf('district')).toBe('覆盖区县');
    expect(regionUnitOf('province')).toBe('省份');
  });

  it('也接受 rowRegions 那种 { d: 编码 } 的对象数组', () => {
    expect(regionLevelOfCodes([{ d: '440300' }, { d: '440300' }, { d: '' }])).toBe('city');
    expect(regionLevelOfCodes([])).toBe('province');
  });

  it('客户画像分档：按人均单量四档，阈值和 SQL 里那条 CASE 必须一致', () => {
    expect(personaBucketOf(100, 100)).toBe('一次性为主');   // 1.0 单/人
    expect(personaBucketOf(120, 100)).toBe('一次性为主');   // 1.2 正好在边界上，算第一档
    expect(personaBucketOf(200, 100)).toBe('复购型');
    expect(personaBucketOf(300, 100)).toBe('复购型');
    expect(personaBucketOf(500, 100)).toBe('高频复购');
    expect(personaBucketOf(600, 100)).toBe('高频复购');
    expect(personaBucketOf(900, 100)).toBe('重度客户');
    // 没有画像字段的老数据：返回空串 → 不进画像维度（和 SQL 返回 NULL 对齐）
    expect(personaBucketOf(0, 0)).toBe('');
    expect(personaBucketOf(undefined, undefined)).toBe('');
    expect(PERSONA_BUCKETS.length).toBe(4);
  });

  it('画像度量：复购率 / 活跃率 / 人均单量都是派生的，除零给 0', () => {
    const acc = { cust: 200, rep: 50, act: 120, orders: 900, amount: 0, rows: 0 };
    expect(measureValue('repRate', acc)).toBeCloseTo(0.25, 6);
    expect(measureValue('activeRate', acc)).toBeCloseTo(0.6, 6);
    expect(measureValue('freq', acc)).toBeCloseTo(4.5, 6);
    expect(measureValue('repRate', { cust: 0 })).toBe(0);
    expect(formatValue(0.253, 'pct')).toBe('25.3%');
    expect(formatValue(4.55, 'num1')).toBe('4.5');
  });
});
