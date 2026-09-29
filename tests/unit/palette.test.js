import { describe, it, expect } from 'vitest';
import { rampColor, HEAT_RAMPS, regionBreaks, regionColor, REGION_RAMP } from '../../src/core/palette.js';

describe('palette', () => {
  it('rampColor 两端取到首尾色', () => {
    expect(rampColor(HEAT_RAMPS.classic, 0)).toEqual([0, 40, 200]);
    const top = rampColor(HEAT_RAMPS.classic, 1);
    const want = HEAT_RAMPS.classic[HEAT_RAMPS.classic.length - 1];
    top.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(2));
  });
  it('rampColor 对越界值做钳制', () => {
    expect(rampColor(HEAT_RAMPS.classic, -5)).toEqual([0, 40, 200]);
    const top2 = rampColor(HEAT_RAMPS.classic, 9);
    const want2 = HEAT_RAMPS.classic[HEAT_RAMPS.classic.length - 1];
    top2.forEach((v, i) => expect(Math.abs(v - want2[i])).toBeLessThanOrEqual(2));
  });
  it('regionBreaks 用分位数切 5 档', () => {
    const m = new Map();
    for (let i = 1; i <= 100; i++) { m.set('c' + i, i); }
    const cls = regionBreaks(m);
    expect(cls.max).toBe(100);
    expect(cls.breaks).toHaveLength(4);
    expect(cls.breaks[0]).toBe(21);   // 第 20 百分位（0 基下标）
    for (let i = 1; i < cls.breaks.length; i++) { expect(cls.breaks[i]).toBeGreaterThan(cls.breaks[i - 1]); }
  });
  it('regionColor 没数据时给灰色，有数据时落在色阶上', () => {
    const m = new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]);
    const cls = regionBreaks(m);
    expect(regionColor(0, cls)).toContain('rgba');
    const top = regionColor(5, cls);
    const rgb = REGION_RAMP[REGION_RAMP.length - 1];
    expect(top).toBe('rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')');
  });
  it('regionBreaks 遇到空数据不炸', () => {
    const cls = regionBreaks(new Map());
    expect(cls.max).toBe(0);
    expect(cls.breaks).toHaveLength(4);
  });
});
