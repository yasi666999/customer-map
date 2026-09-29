/* 格式化与文本工具（纯函数，可单测） */

export function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

export function shortNum(v) {
    if (v >= 100000000) { return (v / 100000000).toFixed(1) + '亿'; }
    if (v >= 10000) { return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '万'; }
    return String(v);
  }

export function niceMax(v) {
    if (!v) { return 1; }
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * p;
  }

export function clipText(s, px) {
    s = String(s == null ? '' : s);
    var max = Math.floor(px / 12);
    return (max > 1 && s.length > max) ? s.slice(0, max - 1) + '…' : s;
  }

export function fmtDate(ms) { var d = new Date(ms); return (d.getMonth() + 1) + '/' + d.getDate(); }

/* 年月：时间跨度和月度说明用这个。fmtDate 只给"日"级的短标签用（M/D），
   拿它显示跨 37 个月的区间会变成 "2/1 – 9/1"，年份全丢了、根本看不出是哪一段。 */
export function fmtYearMonth(ms) {
  var d = new Date(ms);
  return d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0');
}

export function fmtMonth(k) { var p = k.split('-'); return p[0].slice(2) + '/' + p[1]; }

export function toDateStr(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
