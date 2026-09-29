import { describe, it, expect } from 'vitest';
import {
  csvCell, csvLine, buildRowsCsv, buildPlacesCsv,
  EXPORT_COLUMNS, PLACE_COLUMNS
} from '../../src/data/csv-export.js';

/* 导出文件是客户要拿去用的东西，转义写错会整行串位。
   地址里逗号、引号、换行都很常见，所以这一组盯的是转义和列对齐。 */

describe('csv-export / 单元格转义', () => {
  it('普通值不加引号', () => {
    expect(csvCell('广东省深圳市')).toBe('广东省深圳市');
    expect(csvCell(12)).toBe('12');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('含逗号就套引号', () => {
    expect(csvCell('广东省,深圳市')).toBe('"广东省,深圳市"');
  });
  it('含引号就套引号并把内部引号翻倍', () => {
    expect(csvCell('门牌16"院内')).toBe('"门牌16""院内"');
  });
  it('含换行就套引号（否则会被 Excel 当成两行）', () => {
    expect(csvCell('第一行\n第二行')).toBe('"第一行\n第二行"');
  });
  it('含回车也套引号（老实现漏了这个）', () => {
    expect(csvCell('第一行\r第二行')).toBe('"第一行\r第二行"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });
  it('一行拼起来时只有需要的字段带引号', () => {
    expect(csvLine(['a', 'b,c', 'd"e'])).toBe('a,"b,c","d""e"');
  });
});

describe('csv-export / 客户地址导出表', () => {
  const ctx = {
    bases: [{ name: '深圳仓' }],
    hasCoord: (r) => typeof r.lng === 'number' && r.lat === r.lat && r.lat !== null,
    qualityLabel: (r) => (r.status === 'ok' ? '乡镇街道级' : ''),
    toBd09: (lng, lat) => [lng + 0.006, lat + 0.006],
    statusLabel: (r) => (r.status === 'ok' ? '已定位' : '待解析')
  };
  const rows = [
    {
      raw: '广东省深圳市福田区华强北街道,示例路1号', clean: '广东省深圳市福田区华强北街道',
      status: 'ok', quality: 'town', lng: 114.1, lat: 22.5, count: 3,
      t: new Date(2026, 8, 1, 8, 0, 0).getTime(), plat: '京东', shop: '示例数码旗舰店',
      code: 'SO100001', amount: 236, distKm: 1.234, baseIdx: 0, id: 'A1',
      phones: ['13800000000', '13900000000'], flags: ['门牌16"院内'], level: '福田区'
    },
    { raw: '外仓', clean: '外仓', status: 'todo', lng: null, lat: null, flags: [] }
  ];

  it('表头就是约定的那些列', () => {
    const csv = buildRowsCsv(rows, ctx);
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toBe(EXPORT_COLUMNS.join(','));
    expect(header).toContain('经度(高德GCJ02)');
    expect(header).toContain('距常驻点(km)');
  });
  it('带 BOM，Excel 打开不乱码', () => {
    expect(buildRowsCsv(rows, ctx).charCodeAt(0)).toBe(0xFEFF);
  });
  it('行数 = 表头 + 数据行', () => {
    const lines = buildRowsCsv(rows, ctx).replace(/^\uFEFF/, '').split('\r\n');
    expect(lines.length).toBe(3);
  });
  it('内容含地址 / 平台 / 店铺 / 金额 / 电话', () => {
    const line = buildRowsCsv(rows, ctx).replace(/^\uFEFF/, '').split('\r\n')[1];
    expect(line).toContain('示例路1号');
    expect(line).toContain('京东');
    expect(line).toContain('示例数码旗舰店');
    expect(line).toContain('236');
    expect(line).toContain('13800000000 / 13900000000');
  });
  it('地址里的逗号被引号包住，不会串列', () => {
    const line = buildRowsCsv(rows, ctx).replace(/^\uFEFF/, '').split('\r\n')[1];
    expect(line).toContain('"广东省深圳市福田区华强北街道,示例路1号"');
  });
  it('备注里带引号也能正确翻倍', () => {
    const line = buildRowsCsv(rows, ctx).replace(/^\uFEFF/, '').split('\r\n')[1];
    expect(line).toContain('"门牌16""院内"');
  });
  it('有坐标的行填 GCJ02 和 BD09 两套坐标，没坐标的留空', () => {
    const lines = buildRowsCsv(rows, ctx).replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[1]).toContain('114.1');
    expect(lines[1]).toContain('114.106');
    const cells = lines[2].split(',');
    expect(cells[3]).toBe('');
    expect(cells[4]).toBe('');
    expect(cells[5]).toBe('');
  });
  it('距离和最近常驻点按名字写出来', () => {
    const line = buildRowsCsv(rows, ctx).replace(/^\uFEFF/, '').split('\r\n')[1];
    expect(line).toContain('1.23');
    expect(line).toContain('深圳仓');
  });
  it('客户数为 1 时不写（和旧导出行为一致）', () => {
    const one = [{ raw: 'x', clean: 'x', status: 'ok', lng: 1, lat: 2, count: 1, flags: [] }];
    const line = buildRowsCsv(one, ctx).replace(/^\uFEFF/, '').split('\r\n')[1];
    expect(line.split(',')[9]).toBe('');
  });
});

describe('csv-export / 地点字典导出表', () => {
  it('表头固定，带 BOM', () => {
    const csv = buildPlacesCsv([{ name: '深圳仓', lng: 114.1, lat: 22.5 }]);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe(PLACE_COLUMNS.join(','));
  });
  it('名字里有逗号也能正确转义', () => {
    const csv = buildPlacesCsv([{ name: '深圳仓,北区', lng: 114.1, lat: 22.5 }]);
    expect(csv).toContain('"深圳仓,北区"');
  });
  it('多行按顺序输出', () => {
    const csv = buildPlacesCsv([
      { name: 'A', lng: 1, lat: 2 },
      { name: 'B', lng: 3, lat: 4 }
    ]);
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines.length).toBe(3);
    expect(lines[2]).toBe('B,3,4');
  });
});
