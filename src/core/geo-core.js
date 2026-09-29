/* 地理与时间的小工具（纯函数） */

export function pointInRings(lng, lat, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      var n = ring.length / 2;
      for (var i = 0, j = n - 1; i < n; j = i++) {
        var xi = ring[i * 2], yi = ring[i * 2 + 1];
        var xj = ring[j * 2], yj = ring[j * 2 + 1];
        if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
    }
    return inside;
  }

export function monthStartMs(k) { var y = +k.slice(0, 4), mo = +k.slice(5, 7) - 1; return new Date(y, mo, 1).getTime(); }

export function monthEndMs(k) { var y = +k.slice(0, 4), mo = +k.slice(5, 7) - 1; return new Date(y, mo + 1, 0, 23, 59, 59).getTime(); }

export function cityKeyOf(code) {
    return DIRECT_CITY[code.slice(0, 2)] ? code : code.slice(0, 4) + '00';
  }

export var DIRECT_CITY = { '11': 1, '12': 1, '31': 1, '50': 1, '71': 1, '81': 1, '82': 1 };
