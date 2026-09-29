import { describe, it, expect } from 'vitest';
import { pointInRings, monthStartMs, monthEndMs, cityKeyOf } from '../../src/core/geo-core.js';

describe('geo-core', () => {
  // 环是"扁平"的坐标数组：[x0,y0,x1,y1,...]，和边界包里存的一样
  const square = [[100, 30, 101, 30, 101, 31, 100, 31, 100, 30]];
  it('点落在多边形内', () => {
    expect(pointInRings(100.5, 30.5, square)).toBe(true);
  });
  it('点落在多边形外', () => {
    expect(pointInRings(99.5, 30.5, square)).toBe(false);
    expect(pointInRings(100.5, 29.5, square)).toBe(false);
  });
  it('带洞的多边形：洞里的点算外面', () => {
    const hole = [square[0], [100.4, 30.4, 100.6, 30.4, 100.6, 30.6, 100.4, 30.6, 100.4, 30.4]];
    expect(pointInRings(100.5, 30.5, hole)).toBe(false);
    expect(pointInRings(100.2, 30.2, hole)).toBe(true);
  });
  it('月份起止时间覆盖整月', () => {
    const s = monthStartMs('2024-02');
    const e = monthEndMs('2024-02');
    expect(new Date(s).getDate()).toBe(1);
    expect(new Date(e).getDate()).toBe(29);   // 2024 是闰年
    expect(e).toBeGreaterThan(s);
  });
  it('直辖市的区县直接挂在省级下', () => {
    expect(cityKeyOf('110105')).toBe('110105');   // 北京朝阳区
    expect(cityKeyOf('500112')).toBe('500112');   // 重庆渝北区
    expect(cityKeyOf('440305')).toBe('440300');   // 深圳南山区 → 深圳市
    expect(cityKeyOf('330106')).toBe('330100');   // 杭州西湖区 → 杭州市
  });
});
