/* 本地地址解析引擎：完全不联网、不依赖任何地图服务
 * 数据：geo-data.js（省/市/区县/乡镇街道 + GCJ02 坐标）
 * 思路：不做正则猜测，而是用已知地名的字典去地址里"最长匹配"，逐级收窄
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.LocalGeocode = factory(); }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var PROV_SUFFIX = /(省|自治区|特别行政区|市)$/;
  var CITY_SUFFIX = /(市|自治州|地区|盟)$/;
  var DIST_SUFFIX = /(区|县|旗|市|新区|自治县)$/;
  var TOWN_SUFFIX = /(街道|镇|乡|苏木|办事处)$/;
  var MUNI = ['北京市', '天津市', '上海市', '重庆市'];

  function shortName(name, kind) {
    if (!name) { return ''; }
    var re = kind === 'p' ? PROV_SUFFIX : kind === 'c' ? CITY_SUFFIX : kind === 'd' ? DIST_SUFFIX : TOWN_SUFFIX;
    var s = name.replace(re, '');
    return s.length >= 2 ? s : name;
  }

  function buildCharIndex(map) {
    var idx = {};
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) { continue; }
      var c0 = k.charAt(0);
      (idx[c0] = idx[c0] || []).push(k);
    }
    return idx;
  }

  /* 在 text 里找出所有出现在字典中的地名，返回按"长优先、左优先"排序的结果 */
  function findMatches(text, charIndex) {
    var out = [];
    for (var i = 0; i < text.length; i++) {
      var cands = charIndex[text.charAt(i)];
      if (!cands) { continue; }
      for (var j = 0; j < cands.length; j++) {
        var n = cands[j];
        if (n.length > text.length - i) { continue; }
        if (text.substr(i, n.length) === n) { out.push({ name: n, pos: i, len: n.length }); }
      }
    }
    out.sort(function (a, b) { return (b.len - a.len) || (a.pos - b.pos); });
    return out;
  }

  function createGeocoder(db) {
    if (!db || !db.T) { throw new Error('缺少本地地址库 geo-data.js'); }
    var P = db.P, C = db.C, D = db.D, T = db.T;

    // 全名与简称分开建索引：优先用全名匹配，简称只在受控情况下使用
    var P_F = {}, P_S = {}, C_F = {}, C_S = {}, D_F = {}, D_S = {}, T_F = {}, T_S = {};
    function put(map, key, val) {
      if (!key) { return; }
      (map[key] = map[key] || []).push(val);
    }
    P.forEach(function (n, i) { put(P_F, n, i); var s = shortName(n, 'p'); if (s !== n) { put(P_S, s, i); } });
    C.forEach(function (c, i) { put(C_F, c[1], i); var s = shortName(c[1], 'c'); if (s !== c[1]) { put(C_S, s, i); } });
    D.forEach(function (d, i) { put(D_F, d[1], i); var s = shortName(d[1], 'd'); if (s !== d[1]) { put(D_S, s, i); } });
    T.forEach(function (t, i) { put(T_F, t[1], i); var s = shortName(t[1], 't'); if (s !== t[1]) { put(T_S, s, i); } });

    var PF = buildCharIndex(P_F), PS = buildCharIndex(P_S), CF = buildCharIndex(C_F), CS = buildCharIndex(C_S),
        DF = buildCharIndex(D_F), DS = buildCharIndex(D_S), TF = buildCharIndex(T_F), TS = buildCharIndex(T_S);

    // 归属索引
    var citiesOfP = {}, distsOfC = {}, distsOfP = {}, townsOfD = {}, townsOfC = {}, townsOfP = {};
    C.forEach(function (c, i) { (citiesOfP[c[0]] = citiesOfP[c[0]] || []).push(i); });
    D.forEach(function (d, i) {
      (distsOfC[d[0]] = distsOfC[d[0]] || []).push(i);
      var pi = C[d[0]] ? C[d[0]][0] : -1;
      (distsOfP[pi] = distsOfP[pi] || []).push(i);
    });
    T.forEach(function (t, i) {
      (townsOfD[t[0]] = townsOfD[t[0]] || []).push(i);
      var di = t[0], ci = D[di] ? D[di][0] : -1, pi = C[ci] ? C[ci][0] : -1;
      (townsOfC[ci] = townsOfC[ci] || []).push(i);
      (townsOfP[pi] = townsOfP[pi] || []).push(i);
    });

    /* 先找全名；全名没命中再用简称。简称可选传入过滤函数 */
    function findLevel(text, fullChar, fullNames, shortChar, shortNames, allowedSet, shortFilter) {
      var hit = firstIn(findMatches(text, fullChar), allowedSet, fullNames);
      if (hit) { hit.via = 'full'; return hit; }
      var sm = findMatches(text, shortChar);
      if (shortFilter) { sm = sm.filter(function (m) { return shortFilter(text, m); }); }
      hit = firstIn(sm, allowedSet, shortNames);
      if (hit) { hit.via = 'short'; }
      return hit;
    }

    function firstIn(matches, allowedSet, nameMap) {
      for (var i = 0; i < matches.length; i++) {
        var ids = nameMap[matches[i].name];
        if (!ids) { continue; }
        if (!allowedSet) { return { ids: ids, hit: matches[i] }; }
        for (var j = 0; j < ids.length; j++) {
          if (allowedSet[ids[j]]) { return { ids: [ids[j]], hit: matches[i] }; }
        }
      }
      return null;
    }

    /* 按国标行政区划编码直接定位（数据里只有 province/city/area 编码时用这个）
       比字符串匹配更准更快：编码是唯一的，不会串到同名区县。 */
    /* 城市编码 → 城市序号。地名库里城市表没有编码，只有区县表有：
       区县编码前 4 位就是它所属城市的编码（440303 → 4403 深圳市），
       所以扫一遍区县表就能反推出"城市编码 → 城市"，只建一次。 */
    var cityBy4 = null, provBy2 = null;
    function buildCodeIndex() {
      if (cityBy4) { return; }
      cityBy4 = {}; provBy2 = {};
      if (!db.DC) { return; }
      for (var code in db.DC) {
        if (!Object.prototype.hasOwnProperty.call(db.DC, code)) { continue; }
        var di = db.DC[code], rec = D[di];
        if (!rec) { continue; }
        var ci = rec[0];
        if (ci == null || !C[ci]) { continue; }      // 地名库里少数区县缺父级城市（那曲、三沙的岛礁），跳过
        var c4 = code.slice(0, 4), p2 = code.slice(0, 2);
        if (cityBy4[c4] === undefined) { cityBy4[c4] = ci; }
        var pi = C[ci][0];
        if (provBy2[p2] === undefined && pi != null && P[pi]) { provBy2[p2] = pi; }
      }
    }

    /* 只有省 + 市编码（订单表里很常见：明细只到市，没有区县）：
       以前这种情况会退化成"扫到同 4 位前缀的第一个区县"，于是整个深圳的行
       都被贴上"罗湖区"的名字、坐标也落在那个区。这里改成按**城市中心点**定位，
       匹配结果里的 d 留空，地图/分析就都归到市级。 */
    function lookupByCityCode(pCode, cCode) {
      buildCodeIndex();
      function digits2(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
      var c6 = digits2(cCode);
      if (c6.length > 6) { c6 = c6.slice(0, 6); }
      var ci = c6.length >= 4 ? cityBy4[c6.slice(0, 4)] : undefined;
      if (ci !== undefined) {
        var cen = (db.Ccen && db.Ccen[ci]) || null;
        if (!cen) { return null; }
        var pi2 = C[ci][0];
        return { ok: true, lng: cen[0], lat: cen[1], quality: 'city',
          match: { p: pi2 >= 0 && P[pi2] ? P[pi2] : '', c: C[ci][1], d: '', t: '' },
          reason: '\u6309\u57ce\u5e02\u7f16\u7801 ' + c6 + ' \u5b9a\u4f4d\u5230\u5e02\u7ea7\u4e2d\u5fc3' };
      }
      var p2 = digits2(pCode).slice(0, 2);
      var pi = p2.length === 2 ? provBy2[p2] : undefined;
      if (pi !== undefined && db.Pcen && db.Pcen[pi]) {
        return { ok: true, lng: db.Pcen[pi][0], lat: db.Pcen[pi][1], quality: 'province',
          match: { p: P[pi], c: '', d: '', t: '' },
          reason: '\u57ce\u5e02\u7f16\u7801\u5730\u540d\u5e93\u91cc\u6ca1\u6536\u5f55\uff0c\u53ea\u80fd\u6309\u7701\u7ea7\u5b9a\u4f4d' };
      }
      return null;
    }

    function lookupByCode(pCode, cCode, dCode) {
      function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
      var d6 = digits(dCode);
      if (d6.length > 6) { d6 = d6.slice(0, 6); }
      /* 没有区县编码：先按市级定位（城市中心点 + 城市名），别退化成随机一个区县 */
      if (d6.length < 6) {
        var cityHit = lookupByCityCode(pCode, cCode);
        if (cityHit) { return cityHit; }
      }
      var dIdx = -1, hitLevel = '';
      if (d6.length === 6 && db.DC && db.DC[d6] !== undefined) { dIdx = db.DC[d6]; hitLevel = 'district'; }
      if (dIdx < 0) {
        // 区县编码对不上（区划调整过）：用前 4 位找同市的任意区县
        var c4 = digits(cCode);
        if (c4.length >= 4) { c4 = c4.slice(0, 4);
          for (var k in db.DC) { if (k.slice(0, 4) === c4) { dIdx = db.DC[k]; hitLevel = 'city'; break; } }
        }
      }
      if (dIdx < 0) {
        var p2 = digits(pCode).slice(0, 2);
        if (p2.length === 2) { for (var k2 in db.DC) { if (k2.slice(0, 2) === p2) { dIdx = db.DC[k2]; hitLevel = 'province'; break; } } }
      }
      if (dIdx < 0) { return { ok: false, reason: '\u7f16\u7801\u6ca1\u5728\u672c\u5730\u5e93\u91cc\u627e\u5230' }; }
      var rec = D[dIdx], ci = rec[0], pi = C[ci] ? C[ci][0] : -1;
      return {
        ok: true, lng: rec[2], lat: rec[3],
        quality: hitLevel === 'district' ? 'district' : (hitLevel === 'city' ? 'city' : 'province'),
        match: { p: pi >= 0 ? P[pi] : '', c: C[ci] ? C[ci][1] : '', d: rec[1], t: '' },
        reason: hitLevel === 'district' ? ('\u6309\u533a\u53bf\u7f16\u7801 ' + d6 + ' \u7cbe\u786e\u5339\u914d')
              : (hitLevel === 'city' ? '\u533a\u53bf\u7f16\u7801\u5df2\u8c03\u6574\uff0c\u6309\u5e02\u7ea7\u5b9a\u4f4d' : '\u4ec5\u80fd\u6309\u7701\u7ea7\u5b9a\u4f4d')
      };
    }

    /* 自定义地点字典：命中即最高优先级 */
    var custom = [];
    function setCustom(list) {
      custom = (list || []).filter(function (e) {
        return e && e.name && isFinite(e.lng) && isFinite(e.lat);
      }).sort(function (a, b) { return b.name.length - a.name.length; });
    }

    function lookup(address, opts) {
      opts = opts || {};
      var text = String(address || '').replace(/\s+/g, '');
      if (!text) { return { ok: false, reason: '\u7a7a\u5730\u5740' }; }

      // 1. 自定义字典优先
      for (var ci = 0; ci < custom.length; ci++) {
        if (text.indexOf(custom[ci].name) >= 0) {
          return { ok: true, lng: custom[ci].lng, lat: custom[ci].lat, quality: 'custom',
            match: { p: '', c: '', d: '', t: custom[ci].name },
            reason: '\u547d\u4e2d\u81ea\u5b9a\u4e49\u5730\u70b9\u300c' + custom[ci].name + '\u300d' };
        }
      }

      // 2. 省级
      var pAll = findMatches(text, PF);
      var pHit = null;
      if (pAll.length) { pHit = { ids: P_F[pAll[0].name], hit: pAll[0] }; }
      else {
        var pS = findMatches(text, PS);
        if (pS.length) { pHit = { ids: P_S[pS[0].name], hit: pS[0], viaShort: true }; }
      }
      var allowedC = null, allowedD = null, allowedT = null;
      if (pHit) {
        allowedC = {}; pHit.ids.forEach(function (pi) { (citiesOfP[pi] || []).forEach(function (i) { allowedC[i] = true; }); });
      }

      // 3. 市级
      var cHit = findLevel(text, CF, C_F, CS, C_S, allowedC, null);
      if (cHit) {
        allowedD = {}; cHit.ids.forEach(function (ci) { (distsOfC[ci] || []).forEach(function (i) { allowedD[i] = true; }); });
      } else if (pHit) {
        allowedD = {}; pHit.ids.forEach(function (pi) { (distsOfP[pi] || []).forEach(function (i) { allowedD[i] = true; }); });
      }

      // 4. 区县级
      var dHit = findLevel(text, DF, D_F, DS, D_S, allowedD, null);
      if (dHit) {
        allowedT = {}; dHit.ids.forEach(function (di) { (townsOfD[di] || []).forEach(function (i) { allowedT[i] = true; }); });
      } else if (cHit) {
        allowedT = {}; cHit.ids.forEach(function (ci) { (townsOfC[ci] || []).forEach(function (i) { allowedT[i] = true; }); });
      } else if (pHit) {
        allowedT = {}; pHit.ids.forEach(function (pi) { (townsOfP[pi] || []).forEach(function (i) { allowedT[i] = true; }); });
      }

      // 5. 乡镇街道级
      // 乡镇简称匹配的两个护栏：
      //   a) 已经收窄到区县/市，避免全国范围同名乱配
      //   b) 简称后面不能紧跟 区/县/市/旗 —— 否则是在匹配区县名，例如"呼兰区"被当成"呼兰街道"
      var narrowed = !!(dHit || cHit);
      var shortTownFilter = function (txt, m) {
        if (!narrowed) { return false; }
        var next = txt.charAt(m.pos + m.len);
        return '\u533a\u53bf\u5e02\u65d7'.indexOf(next) < 0;
      };
      var tHit = findLevel(text, TF, T_F, TS, T_S, allowedT, shortTownFilter);

      var m = { p: '', c: '', d: '', t: '' };
      if (pHit) { m.p = P[pHit.ids[0]]; }
      if (cHit) { m.c = C[cHit.ids[0]][1]; }
      if (dHit) { m.d = D[dHit.ids[0]][1]; }
      if (tHit) { m.t = T[tHit.ids[0]][1]; }

      // 6. 定坐标：能细就细
      if (tHit) {
        var t = T[tHit.ids[0]];
        var di = t[0];
        return { ok: true, lng: t[2], lat: t[3], quality: 'town', match: m,
          resolvedDistrict: D[di] ? D[di][1] : m.d,
          reason: '\u5339\u914d\u5230\u4e61\u9547/\u8857\u9053\u300c' + t[1] + '\u300d' +
            (tHit.via === 'short' ? '\uff08\u6309\u7b80\u79f0\u5339\u914d\uff09' : '') };
      }
      if (dHit) {
        var d = D[dHit.ids[0]];
        var ci2 = d[0];
        var lng = d[2], lat = d[3];
        if (!d[4] && db.Ccen && db.Ccen[ci2]) { lng = db.Ccen[ci2][0]; lat = db.Ccen[ci2][1]; }
        return { ok: true, lng: lng, lat: lat, quality: 'district', match: m,
          reason: '\u4ec5\u5339\u914d\u5230\u533a\u53bf\u7ea7\u300c' + d[1] + '\u300d' };
      }
      if (cHit) {
        var cIdx = cHit.ids[0], cc = (db.Ccen && db.Ccen[cIdx]) || null;
        if (!cc) { return { ok: false, reason: '\u7f3a\u5c11\u8be5\u5e02\u7684\u5750\u6807' }; }
        return { ok: true, lng: cc[0], lat: cc[1], quality: 'city', match: m,
          reason: '\u4ec5\u5339\u914d\u5230\u5e02\u7ea7\u300c' + C[cIdx][1] + '\u300d' };
      }
      if (pHit) {
        var pIdx = pHit.ids[0], pc = (db.Pcen && db.Pcen[pIdx]) || null;
        if (!pc) { return { ok: false, reason: '\u7f3a\u5c11\u8be5\u7701\u7684\u5750\u6807' }; }
        return { ok: true, lng: pc[0], lat: pc[1], quality: 'province', match: m,
          reason: '\u4ec5\u5339\u914d\u5230\u7701\u7ea7\u300c' + P[pIdx] + '\u300d' };
      }
      return { ok: false, reason: '\u672c\u5730\u5730\u540d\u5e93\u91cc\u6ca1\u6709\u627e\u5230\u5339\u914d' };
    }

    return {
      lookup: lookup,
      lookupByCode: lookupByCode,
      lookupByCityCode: lookupByCityCode,
      setCustom: setCustom,
      stats: function () {
        return { provinces: P.length, cities: C.length, districts: D.length, towns: T.length,
          codes: db.DC ? Object.keys(db.DC).length : 0,
          custom: custom.length, coord: db.coord || 'gcj02' };
      }
    };
  }

  /* GCJ02 → BD09（百度地图显示需要） */
  function gcj02ToBd09(lng, lat) {
    var x = lng, y = lat;
    var z = Math.sqrt(x * x + y * y) + 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0);
    var theta = Math.atan2(y, x) + 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0);
    return [z * Math.cos(theta) + 0.0065, z * Math.sin(theta) + 0.006];
  }
  /* BD09 → GCJ02 */
  function bd09ToGcj02(lng, lat) {
    var x = lng - 0.0065, y = lat - 0.006;
    var z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000.0 / 180.0);
    var theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000.0 / 180.0);
    return [z * Math.cos(theta), z * Math.sin(theta)];
  }

  return { createGeocoder: createGeocoder, gcj02ToBd09: gcj02ToBd09, bd09ToGcj02: bd09ToGcj02 };
}));
