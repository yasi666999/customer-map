/* 地址清洗模块：纯函数、无依赖，浏览器与 Node 通用 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.AddressClean = factory(); }
}(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var NOTE_WORDS = ['门卫', '保安', '前台', '门口', '楼下', '楼上', '里面', '进去', '院内',
    '拨打', '电话', '手机', '联系', '分机', '备注', '说明', '自提', '代收', '签收',
    '配送', '派送', '送货', '上门', '辛苦', '谢谢', '麻烦', '尽快', '请放', '勿放',
    '不要放', '可以放', '人不在', '没人', '到货', '到件', '快递', '外卖',
    '附近', '旁边', '对面', '斜对面', '仓库', '货架', '收件', '寄件'];

  var TRAILING_INSTRUCTION = /(送货上门|配送上门|送货|配送|上门|自提|代收|放门口|放前台|放门卫|放保安室|不要放|勿放|可以放|请放)$/;

  var PHONE_RE = /1[3-9]\d{9}/g;
  var TEL_RE = /0\d{2,3}-?\d{7,8}/g;

  var ADMIN_ATOM = /^(?:北京市|天津市|上海市|重庆市|香港特别行政区|澳门特别行政区|[\u4e00-\u9fa5]{1,4}省|[\u4e00-\u9fa5]{2,10}自治区|[\u4e00-\u9fa5]{2,10}自治州|[\u4e00-\u9fa5]{1,8}市|[\u4e00-\u9fa5]{1,8}(?:区|县|旗)|[\u4e00-\u9fa5]{1,10}(?:街道|镇|乡|苏木))/;

  var POI_HINT = /(小区|花园|公寓|大厦|大楼|广场|中心|工业园|科技园|产业园|创业园|商贸城|商城|市场|医院|学校|大学|学院|中学|小学|幼儿园|公司|工厂|银行|酒店|宾馆|超市|门店|专卖店|店|驿站|菜鸟|车站|机场|地铁站|景区|公园|村|社区|苑|城|湾|里|园)/;
  var DOOR_HINT = /(号|弄|栋|幢|单元|室|楼|座|排|巷|组|门)$|(\d+号)|(\d+栋)|(\d+单元)|(\d+室)|(#\d)|((大厦|大楼|公寓|小区|广场|中心|工业园|科技园|产业园|商贸城|商城|市场|医院|学校|大学|公司|工厂|酒店|宾馆|超市|驿站)[^，,]{0,12}\d)/;

  function uniq(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) { if (out.indexOf(arr[i]) < 0) { out.push(arr[i]); } }
    return out;
  }

  function toHalfWidth(s) {
    return s.replace(/[\uFF01-\uFF5E]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    }).replace(/\u3000/g, ' ');
  }

  function isNoteText(t) {
    if (!t) { return false; }
    if (PHONE_RE.test(t)) { PHONE_RE.lastIndex = 0; return true; }
    PHONE_RE.lastIndex = 0;
    if (/\d{3,}/.test(t) && /(电话|拨打|联系|手机|转|分机)/.test(t)) { return true; }
    for (var i = 0; i < NOTE_WORDS.length; i++) {
      if (t.indexOf(NOTE_WORDS[i]) >= 0) { return true; }
    }
    if (/^[放送请勿不要可以如果]/.test(t) && t.length <= 12) { return true; }
    return false;
  }

  function isAdminPhrase(u) {
    if (!u || u.length < 3 || u.length > 16) { return false; }
    var rest = u, guard = 0;
    while (rest.length > 0) {
      if (guard++ > 4) { return false; }
      var m = rest.match(ADMIN_ATOM);
      if (!m) { return false; }
      rest = rest.slice(m[0].length);
    }
    return true;
  }

  function collapseAdminRepeats(s) {
    var changed = true, guard = 0;
    while (changed && guard++ < 30) {
      changed = false;
      for (var len = 15; len >= 3 && !changed; len--) {
        for (var i = 0; i + 2 * len <= s.length; i++) {
          var unit = s.substr(i, len);
          if (s.substr(i + len, len) === unit && isAdminPhrase(unit)) {
            s = s.slice(0, i + len) + s.slice(i + 2 * len);
            changed = true;
            break;
          }
        }
      }
    }
    return s;
  }

  function cleanAddress(raw) {
    var s = String(raw == null ? '' : raw);
    var id = '', phones = [], dropped = [];

    s = toHalfWidth(s);
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[a-z]/g, function (c) { return c.toUpperCase(); });
    s = s.replace(/^["'\u201c\u201d\u2018\u2019\s]+/, '').replace(/["'\u201c\u201d\u2018\u2019\s]+$/, '');

    // 1. 方括号：【备注】 [编号] [电话]
    s = s.replace(/[\[\u3010]([^\]\u3011]{0,60})[\]\u3011]/g, function (m, inner) {
      var t = String(inner).trim();
      if (/^\d{2,12}$/.test(t)) { if (!id) { id = t; } return ''; }
      var ph = t.match(PHONE_RE) || []; PHONE_RE.lastIndex = 0;
      var tl = t.match(TEL_RE) || []; TEL_RE.lastIndex = 0;
      phones = phones.concat(ph, tl);
      if (t) { dropped.push(t); }
      return '';
    });
    // 截断的方括号，如 "...1601[3986"
    s = s.replace(/[\[\u3010]([^\]\u3011]{0,20})$/, function (m, inner) {
      var t = String(inner).trim();
      if (/^\d{2,12}$/.test(t)) { if (!id) { id = t; } return ''; }
      return '';
    });

    // 2. 圆括号：仅当内容是备注或电话时删除，否则保留（如 "示例新材料(江苏)"）
    s = s.replace(/[(\uFF08]([^)\uFF09]{0,80})[)\uFF09]/g, function (m, inner) {
      var t = String(inner).trim();
      if (/[\d]/.test(t) && /(电话|拨打|联系|手机|转|分机)/.test(t)) {
        var ph = t.match(PHONE_RE) || []; PHONE_RE.lastIndex = 0;
        var tl = t.match(TEL_RE) || []; TEL_RE.lastIndex = 0;
        phones = phones.concat(ph, tl);
        dropped.push(t);
        return '';
      }
      if (isNoteText(t)) { dropped.push(t); return ''; }
      return m;
    });

    // 3. 行尾物流指令
    var prev;
    do { prev = s; s = s.replace(TRAILING_INSTRUCTION, ''); } while (s !== prev);

    // 4. 逗号/分号后的备注片段
    var parts = s.split(/[\uFF0C,\uFF1B;]/);
    if (parts.length > 1) {
      var kept = [parts[0]];
      for (var i = 1; i < parts.length; i++) {
        var p = parts[i].trim();
        if (!p) { continue; }
        if (isNoteText(p)) { dropped.push(p); continue; }
        kept.push(p);
      }
      s = kept.join('');
    }

    // 5. 去掉分隔空白与残留标点
    s = s.replace(/\s+/g, '');
    s = s.replace(/[.\u3002\uFF0C,\uFF1B;:：]+$/, '');

    // 6. 直辖市补全 + 重复行政区折叠
    //    只在后面紧跟行政区划时补"市"，避免误伤"北京东路""示例科技"这类路名/公司名
    s = s.replace(/(北京|上海|天津|重庆)(?!市)(?=.{1,8}?(?:区|县|旗|街道|镇|乡|市))/g, '$1市');
    s = collapseAdminRepeats(s);

    // 7. 提取电话
    var ph2 = s.match(PHONE_RE) || []; PHONE_RE.lastIndex = 0;
    var tl2 = s.match(TEL_RE) || []; TEL_RE.lastIndex = 0;
    phones = phones.concat(ph2, tl2);
    s = s.replace(PHONE_RE, ''); PHONE_RE.lastIndex = 0;
    s = s.replace(/转\d{3,6}/g, '');
    s = s.replace(/[.\u3002\uFF0C,;；]+$/, '').trim();

    phones = uniq(phones.filter(function (p) { return !!p; }));

    var flags = [];
    var hasAdmin = /(省|市|区|县|旗|镇|乡|街道|自治区|自治州)/.test(s);
    var hasCity = /(市|自治州|地区|盟)/.test(s) || /^(北京|上海|天津|重庆)/.test(s);
    var hasDoor = DOOR_HINT.test(s);
    var hasPoi = POI_HINT.test(s);

    if (!s) { flags.push('\u7a7a\u5730\u5740'); }
    else if (!hasAdmin) { flags.push('\u65e0\u884c\u653f\u533a\u5212\uff0c\u7591\u4f3c\u65e0\u6548\u884c'); }
    if (s && !hasCity) { flags.push('\u7f3a\u5c11\u57ce\u5e02\uff0c\u9700\u4eba\u5de5\u6307\u5b9a'); }

    var quality;
    if (!s || !hasAdmin) { quality = 'invalid'; }
    else if (hasDoor) { quality = 'high'; }
    else if (hasPoi) { quality = 'poi'; }
    else if (/(区|县|旗)/.test(s)) { quality = 'district'; }
    else { quality = 'city'; }

    return {
      raw: String(raw == null ? '' : raw).trim(),
      clean: s,
      id: id,
      phones: phones,
      droppedNotes: uniq(dropped),
      flags: flags,
      quality: quality
    };
  }

  function parseRows(text) {
    var lines = String(text == null ? '' : text).split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) { continue; }
      if (/^[-=*_#~]{2,}$/.test(t)) { continue; }
      out.push(cleanAddress(t));
    }
    return out;
  }

  var QUALITY_LABEL = {
    high: '\u95e8\u724c\u7ea7',
    poi: 'POI\u7ea7',
    district: '\u533a\u53bf\u7ea7',
    city: '\u57ce\u5e02\u7ea7',
    invalid: '\u65e0\u6548'
  };

  return {
    cleanAddress: cleanAddress,
    parseRows: parseRows,
    isAdminPhrase: isAdminPhrase,
    collapseAdminRepeats: collapseAdminRepeats,
    QUALITY_LABEL: QUALITY_LABEL
  };
}));
