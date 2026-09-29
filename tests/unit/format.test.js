import { describe, it, expect } from 'vitest';
import { esc, shortNum, fmtMonth, toDateStr } from '../../src/core/format.js';

describe('format', () => {
  it('esc 转义 HTML 特殊字符', () => {
    expect(esc('<b a="1">&')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;');
    expect(esc("'")).toBe('&#39;');
    expect(esc(null)).toBe('');
  });
  it('shortNum 用中文单位', () => {
    expect(shortNum(999)).toBe('999');
    expect(shortNum(12345)).toBe('1.2万');
    expect(shortNum(1234567)).toBe('123万');
    expect(shortNum(123456789)).toBe('1.2亿');
  });
  it('fmtMonth 把 2024-05 变成 24/05', () => {
    expect(fmtMonth('2024-05')).toBe('24/05');
  });
  it('toDateStr 输出 YYYY-MM-DD', () => {
    const s = toDateStr(new Date(2024, 4, 7).getTime());
    expect(s).toBe('2024-05-07');
  });
});
