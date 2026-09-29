import { describe, it, expect } from 'vitest';
import { cAttr, chartTable, chartSwitch, matrixTable } from '../../src/core/chart-core.js';

/* 柱状 / 折线 / 面积 / 饼图 / 环形 / 条形 已经全部交给 ECharts（ui/island.jsx），
   这里原来那套手写 SVG 实现和它的单测一起删了 —— 测的是没人调用的死代码。
   留在这里的是表格类：数据密集、要能选中复制，直接出 <table> 更合适。 */

const items = [
  { label: '广东省', v: 1590691, click: '440000' },
  { label: '浙江省', v: 992094, click: '330000' },
  { label: '河南省', v: 985381, click: '410000' }
];

describe('chart-core / 可点击标记', () => {
  it('有 click 才加 data-k', () => {
    expect(cAttr({ click: '440000' })).toBe(' class="chart-click" data-k="440000"');
    expect(cAttr({ click: '' })).toBe('');
    expect(cAttr({})).toBe('');
    expect(cAttr(null)).toBe('');
  });
  it('data-k 里的引号会被转义（否则会撑破属性）', () => {
    expect(cAttr({ click: 'a"b' })).toContain('&quot;');
  });
});

describe('chart-core / 表格', () => {
  it('表格按数量算占比，并说明截断', () => {
    const t = chartTable(items, { limit: 2 });
    expect((t.match(/<tr/g) || []).length).toBe(3);   // 表头 + 2 行
    expect(t).toContain('仅显示前 2 项');
    expect(t).toContain('共 3 项');
  });
  it('占比按总数算', () => {
    const t = chartTable(items, { limit: 3 });
    expect(t).toContain('44.6%');   // 1,590,691 / 3,568,166
  });
  it('表头行的数字带千分位', () => {
    expect(chartTable(items, {})).toContain('1,590,691');
  });
  it('行上带可点击标记', () => {
    expect(chartTable(items, {})).toContain('data-k="440000"');
  });
  it('名称里的 HTML 会被转义', () => {
    const t = chartTable([{ label: '<img src=x onerror=1>', v: 1 }], {});
    expect(t).toContain('&lt;img');
    expect(t).not.toContain('<img');
  });
  it('不截断时不出现"仅显示前"', () => {
    expect(chartTable(items, { limit: 10 })).not.toContain('仅显示前');
  });
  it('空数据不抛异常', () => {
    expect(chartTable([], {})).toContain('<table');
  });
});

describe('chart-core / 图表切换器', () => {
  it('只给当前类型加 on', () => {
    const sw = chartSwitch('time', [['bar', '柱状'], ['line', '折线']], 'line');
    expect(sw).toContain('data-ct="line" class="on"');
    expect(sw).not.toContain('data-ct="bar" class="on"');
  });
  it('按钮带分组标识，方便自动化按组点', () => {
    expect(chartSwitch('geo', [['hbar', '排行']], 'hbar')).toContain('data-cs="geo"');
  });
});

describe('chart-core / 矩阵交叉表', () => {
  const data = { 'pdd|2024-01': 100, 'pdd|2024-02': 50, 'jd|2024-01': 25 };
  const o = {
    rows: [{ key: 'pdd', label: '拼多多' }, { key: 'jd', label: '京东' }],
    cols: [{ key: '2024-01', label: '24/01' }, { key: '2024-02', label: '24/02' }],
    get: (r, c) => data[r + '|' + c] || 0
  };
  it('格子带数据条，行列表头齐全', () => {
    const html = matrixTable(o);
    expect(html).toContain('拼多多');
    expect(html).toContain('24/01');
    expect((html.match(/data-mtx=/g) || []).length).toBe(4);      // 2 行 × 2 列
    expect(html).toContain('width:100%');                          // 最大值那条满格
    expect(html).toContain('width:50%');
    expect(html).toContain('合计');
  });
  it('行列小计与总计按度量单位缩写', () => {
    const html = matrixTable(Object.assign({}, o, {
      rows: [{ key: 'pdd', label: '拼多多' }],
      get: () => 12000
    }));
    expect(html).toContain('1.2万');
  });
  it('没数据时返回空串', () => {
    expect(matrixTable({ rows: [], cols: [] })).toBe('');
  });
});
