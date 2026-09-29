/* 导入流水线 / 详情 / 地点字典
   ==================================================================
   从 main.js 搬出来的"数据怎么进来、单条怎么看、本地字典怎么养"这一整条：

     1. 导入：读文件（CSV / Excel，本地组件）→ 识别编码 → 建行对象 → 分片整理（不卡界面）
     2. 解析调度：一条条跑本地解析，边跑边报进度
     3. 详情弹窗与手动点选：单条客户的位置校正
     4. 示例数据 / 地点字典：字典是"提升解析精度"的用户侧入口

   注意两条容易改坏的地方：
   - 分片（CHUNK）不能去掉：42 万行一次性整理会有几十秒白屏。
   - 行对象是"原型兜底 + 只写有值的字段"（见 data/import-parse.js 的 ROW_PROTO），
     字段写入顺序固定，别随手调。
   ------------------------------------------------------------------ */

export function createImportFlow(ctx) {
  var state = ctx.state;
  var params = ctx.params;
  var $ = ctx.$;
  var esc = ctx.esc;
  var mark = ctx.mark;
  var toast = ctx.toast;
  var Clean = ctx.Clean;
  var ImportParse = ctx.ImportParse;
  var downloadText = ctx.downloadText;
  var buildPlacesCsv = ctx.buildPlacesCsv;
  var todayStamp = ctx.todayStamp;
  var hasCoord = ctx.hasCoord;
  var rowLabel = ctx.rowLabel;
  var QUALITY_META = ctx.QUALITY_META;
  var getDeckEngine = ctx.getDeckEngine;
  var getPlaces = ctx.getPlaces;
  var addPlace = ctx.addPlace;
  var flushPlaces = ctx.flushPlaces;
  var refreshPlaces = ctx.refreshPlaces;
  var suggestPlaceName = ctx.suggestPlaceName;
  var invalidateView = ctx.invalidateView;
  var renderTimeAxis = ctx.renderTimeAxis;
  var buildPlatformOptions = ctx.buildPlatformOptions;
  var updateFilterSummary = ctx.updateFilterSummary;
  var updateStats = ctx.updateStats;
  var renderList = ctx.renderList;
  var rebuildMarkers = ctx.rebuildMarkers;
  var warmNameMap = ctx.warmNameMap;
  var startEngine = ctx.startEngine;
  var setTxt = ctx.setTxt;
  var EMPTY_ARR = ctx.EMPTY_ARR;
  var cacheSet = ctx.cacheSet;
  var cacheGet = ctx.cacheGet;
  var cacheFlush = ctx.cacheFlush;
  var cacheClear = ctx.cacheClear;
  var initLocalGeo = ctx.initLocalGeo;
  var invalidateRowRegions = ctx.invalidateRowRegions;
  var geocodeOne = ctx.geocodeOne;
  var fitView = ctx.fitView;

/* ---------------- 导入（解析逻辑在 data/import-parse.js） ---------------- */

/* 表头识别出来的提示语 / 时间列名要落到全局状态上，模块自己不碰 state，
   所以这里包一层。三个调用点（流式 CSV / Excel / 纯文本）都走它。 */
function applyColumnsInfo(cols) {
  if (!cols) { return; }
  state.importWarn = cols.warn || '';
  state.codeMode = !!cols.codeMode;
  state.timeCol = cols.timeCol || '';
}

/* 字符串去重字典：地址几千种（收益大），订单表地址近乎唯一（到上限就停）。
   实例留在 main.js —— 它是"这一份数据"的状态，不属于解析层。 */
var internAddr = ImportParse.makeInterner(40000);
var internText = ImportParse.makeInterner(4000);

function makeRow(rec) {
  var raw = rec.raw || '';
  var c;
  var hasCoord = rec.lng != null && rec.lat != null;
  // 快路径：这一行本来就带坐标，说明是已经整理好的汇总数据，
  // 地址栏通常是「广东省东莞市」这种干净地名，不需要跑整套正则清洗
  // （42 万行时这能省掉 0.8 秒的主线程阻塞）
  if (hasCoord && !/[\[\]\u3010\u3011()\uff08\uff09]/.test(raw)) {
    c = { clean: raw, id: '', phones: [], flags: [], quality: 'custom' };
  } else {
    c = Clean.cleanAddress(raw);
  }
  if (rec.phone) { c.phones = (c.phones || []).concat([rec.phone]); }

  var row = Object.create(ImportParse.ROW_PROTO);
  /* 下面这一组**每行都写、顺序固定**，保证 42 万行走同一套内存布局。 */
  row.raw = internAddr(rec.raw);
  row.clean = internAddr(c.clean);
  row.count = rec.count || 0;
  row.t = rec.t || null;
  row.plat = internText(rec.plat || '');
  row.lng = null;
  row.lat = null;
  row.status = 'todo';
  row.quality = internText(c.quality);
  row.preQuality = internText(c.quality);
  row.level = '';
  row.source = '';
  /* 下面这些绝大多数行都是默认值，等于默认值就不写，省一个属性槽。 */
  var rid = rec.id || c.id;
  if (rid) { row.id = rid; }
  if (c.phones && c.phones.length) { row.phones = c.phones.slice(); }
  if (rec.shop) { row.shop = rec.shop; }
  if (rec.code) { row.code = rec.code; }
  if (rec.amount) { row.amount = rec.amount; }
  /* 客户画像那几列（有就带上，没有就用 ROW_PROTO 的 0） */
  if (rec.rep) { row.rep = rec.rep; }
  if (rec.hf) { row.hf = rec.hf; }
  if (rec.act) { row.act = rec.act; }
  if (rec.orders) { row.orders = rec.orders; }
  if (rec.phone) { row.phone2 = rec.phone; }
  if (rec.acode) { row.acode = rec.acode; }
  if (rec.ccode) { row.ccode = rec.ccode; }
  if (rec.pcode) { row.pcode = rec.pcode; }
  // 带坐标的行一律清空 flags；不带坐标的才保留清洗出来的提醒
  if (!hasCoord && c.flags && c.flags.length) { row.flags = c.flags.slice(); }
  if (hasCoord) {
    // \u6587\u4ef6\u91cc\u7684\u5750\u6807\u9ed8\u8ba4\u5f53\u9ad8\u5fb7 GCJ02\uff1b\u8868\u5934\u5199\u4e86\u300c\u767e\u5ea6\u300d\u5c31\u5f53 BD09 \u6362\u7b97
    if (rec.coord === 'bd09') {
      var g = window.LocalGeocode.bd09ToGcj02(rec.lng, rec.lat);
      row.lng = g[0]; row.lat = g[1];
    } else {
      row.lng = rec.lng; row.lat = rec.lat;
    }
    row.status = 'ok';
    row.source = 'file';
    row.level = '\u6587\u4ef6\u81ea\u5e26\u5750\u6807';
    row.quality = 'custom';
  }
  return row;
}

/* 分片整理：42 万行也不会有超过 50ms 的卡顿，浮层会实时报进度 */
function loadRecords(recs) {
  var rows = [];
  var stat = { ok: 0, cust: 0, hasCount: false };
  var platMap = new Map();
  var timeHist = new Map();
  var i = 0, CHUNK = 6000;
  state.rows = [];
  showLoading('\u6b63\u5728\u6574\u7406\u6570\u636e\u2026');
          return new Promise(function (/** @type {any} */ resolve) {
    function step() {
      if (state.importAbort) { state.importAbort = false; hideLoading(); resolve(); return; }
      var end = Math.min(recs.length, i + CHUNK);
      for (; i < end; i++) {
        var row = makeRow(recs[i]);
        /* 只要有定位依据就收下：地址文本 / 区县编码 / 省市编码。
           以前这里只认 "有地址文本 或 有区县编码"，于是「只有 province+city」的订单表
           会被整表丢掉 —— 导入后一行都没有。 */
        if (row.raw || row.acode || row.ccode || row.pcode) {
          rows.push(row);
          if (row.status === 'ok') { stat.ok++; }
          if (row.count > 1) { stat.cust += row.count; stat.hasCount = true; }
          var pk = row.plat || '\uff08\u672a\u77e5\u5e73\u53f0\uff09';
          platMap.set(pk, (platMap.get(pk) || 0) + 1);
          if (row.t != null) {
            var _d = new Date(row.t);
            var _mk = _d.getFullYear() + '-' + String(_d.getMonth() + 1).padStart(2, '0');
            timeHist.set(_mk, (timeHist.get(_mk) || 0) + (row.count > 1 ? row.count : 1));
          }
        }
      }
      var pct = recs.length ? i / recs.length : 1;
      setLoading('\u6b63\u5728\u6574\u7406\u6570\u636e\u2026 ' + Math.round(pct * 100) + '%', 20 + pct * 70);
      if (i < recs.length) { setTimeout(step, 0); }
      else { finish(); }
    }
    function finish() {
      mark('loadRecords.finish');
      state.rows = rows;
      state._distTouched = false;
      invalidateView();
      state.stat = { total: rows.length, ok: stat.ok, cust: stat.cust, hasCount: stat.hasCount };
      state.platList = Array.from(platMap.entries()).sort(function (a, b) { return b[1] - a[1]; });
      state.timeHist = timeHist;
      setTimeout(renderTimeAxis, 50);
      state.activeIdx = -1;
      if (state.importWarn) { toast(state.importWarn, 7000); }
      else if (state.lastEncoding === 'gb18030') { toast('\u6587\u4ef6\u662f GB18030 \u7f16\u7801\uff0c\u5df2\u81ea\u52a8\u8f6c\u6362', 4000); }
      else if (state.codeMode) { toast('\u6570\u636e\u91cc\u6ca1\u6709\u5730\u5740\u6587\u672c\uff0c\u5df2\u6309\u7701\u5e02\u533a\u7f16\u7801\u5b9a\u4f4d', 4000); }
      setLoading('\u6b63\u5728\u5efa\u7acb\u7d22\u5f15\u2026', 95);
      buildPlatformOptions();
      updateFilterSummary();
      updateStats();
      renderList();
      warmNameMap(rows);
      startEngine(rows);
      hideLoading();
      if (state.rows.length) {
        fitView();
        rebuildMarkers();
      }
      toast('\u5bfc\u5165 ' + state.rows.length.toLocaleString() + ' \u6761\u5730\u5740');
      resolve();
    }
    step();
  });
}

function previewImport() {
  var text = $('imp-text').value;
  var recs = text.trim() ? ImportParse.textToRecords(text) : [];
  var box = $('imp-preview');
  $('imp-count').textContent = recs.length;
  if (!recs.length) { box.innerHTML = '<div class="pv">\u6682\u65e0\u5185\u5bb9</div>'; return; }
  var html = '';
  recs.slice(0, 60).forEach(function (r) {
    var c = Clean.cleanAddress(r.raw);
    var bad = c.quality === 'invalid' || c.flags.length;
    html += '<div class="pv' + (bad ? ' bad' : '') + '"><b>' + esc(c.clean || r.raw) + '</b><small>' +
      esc(r.raw) + (c.flags.length ? ('  \u26a0 ' + esc(c.flags.join('\uff1b'))) : '') + '</small></div>';
  });
  if (recs.length > 60) { html += '<div class="pv">\u2026\u8fd8\u6709 ' + (recs.length - 60) + ' \u6761</div>'; }
  box.innerHTML = html;
}

/* 自动识别文件编码：UTF-8 / GB18030（Excel 存出来的中文 CSV 基本都是 GB18030）
   以前固定按 UTF-8 读，遇到 GB18030 就整篇乱码，地址一条都解析不出来。 */
function decodeBuffer(buf) {
  var bytes = new Uint8Array(buf);
  var enc = 'utf-8';
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    enc = 'utf-8';
  } else {
    // 先按严格 UTF-8 试解一小段，失败就认为不是 UTF-8
    var probe = bytes.subarray(0, Math.min(bytes.length, 262144));
    var ok = true;
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(probe);
    } catch (e) { ok = false; }
    if (!ok) { enc = 'gb18030'; }
  }
  var text;
  try {
    text = new TextDecoder(enc === 'gb18030' ? 'gb18030' : 'utf-8').decode(bytes);
  } catch (e) {
    text = new TextDecoder('utf-8').decode(bytes);   // 旧浏览器不支持 gb18030 时兜底
    enc = 'utf-8';
  }
  return { text: text.replace(/^\uFEFF/, ''), enc: enc };
}

var IMPORT_TIMEOUT_MS = 180000;   // 3 分钟还没读完就认为异常
var MAX_IMPORT_ROWS = 1200000;
var MAX_IMPORT_BYTES = 180 * 1024 * 1024;

function showLoading(msg) {
  // <dialog> 位于浏览器最顶层，会盖住浮层，这里先关掉可能挡路的对话框
  ['dlg-import', 'dlg-settings', 'dlg-detail'].forEach(function (id) {
    var d = $(id);
    if (d && d.open) { try { d.close(); } catch (e) {} }
  });
  var el = $('loading');
  if (!el) { return; }
  el.hidden = false;
  el.style.display = 'flex';
  state.loadingHidden = false;
  setTxt('loading-txt', msg || '\u6b63\u5728\u5904\u7406\u2026');
  var f = $('loading-fill');
  if (f) { f.style.width = '4%'; }
}
function setLoading(msg, pct) {
  if (msg) { setTxt('loading-txt', msg); }
  var f = $('loading-fill');
  if (f && pct != null) { f.style.width = Math.max(4, Math.min(100, pct)) + '%'; }
}
function hideLoading() {
  var el = $('loading');
  if (el) { el.hidden = true; el.style.display = 'none'; }   // 双保险：hidden + 内联样式
  state.loadingHidden = true;
}
function abortImport(msg) {
  state.importAbort = true;
  hideLoading();
  if (msg) { toast(msg, 4200); }
}

/* 这里原来还有一个 parseCsvAsync：和 importCsvPipelined 是同一套状态机的旧副本，
   已经没人调用（产物里也被摇掉了），而且没有脏引号容错，留着只会成为日后的陷阱，故删除。 */

function readFile(file) {
  var name = (file.name || '').toLowerCase();
  var sizeMB = file.size / 1024 / 1024;

  // 超大文件直接拦下来，避免浏览器内存爆掉（表现为卡死）
  if (file.size > MAX_IMPORT_BYTES) {
    return Promise.reject(new Error(
      '\u8fd9\u4e2a\u6587\u4ef6 ' + sizeMB.toFixed(0) + ' MB\uff0c\u8d85\u8fc7\u6d4f\u89c8\u5668\u80fd\u627f\u53d7\u7684\u4e0a\u9650\u3002\u8bf7\u5148\u53cc\u51fb\u300c\u4e00\u952e\u89e3\u6790\u5927\u6587\u4ef6.bat\u300d\u8dd1\u4e00\u904d\uff0c\u518d\u5bfc\u5165\u5b83\u751f\u6210\u7684\u6c47\u603b\u6587\u4ef6'));
  }
  state.importAbort = false;
  showLoading('\u6b63\u5728\u8bfb\u53d6 ' + name + '\uff08' + sizeMB.toFixed(1) + ' MB\uff09\u2026');
  // 安全网：无论卡在哪一步，到点都会把浮层收掉并给出提示
  clearTimeout(state._importTimer);
  state._importTimer = setTimeout(function () {
    if (!state.loadingHidden) { abortImport('\u5bfc\u5165\u8d85\u65f6\uff0c\u5df2\u505c\u6b62\u3002\u6587\u4ef6\u53ef\u80fd\u592a\u5927\u6216\u683c\u5f0f\u7279\u6b8a'); }
  }, IMPORT_TIMEOUT_MS);

  var task;
  if (/\.xlsx?$/.test(name)) {
    task = loadSheetJs().then(function () {
      setLoading('\u6b63\u5728\u89e3\u6790 Excel\u2026', 30);
      return file.arrayBuffer();
    }).then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      setLoading('\u6b63\u5728\u8bc6\u522b\u5b57\u6bb5\u2026', 80);
      return ImportParse.buildRecords(rows, applyColumnsInfo);
    });
  } else {
    task = new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25')); };
      fr.readAsArrayBuffer(file);
    }).then(function (buf) {
      setLoading('\u6b63\u5728\u8bc6\u522b\u7f16\u7801\u2026', 12);
      var dec = decodeBuffer(buf);
      state.lastEncoding = dec.enc;
      if (!/\.csv$/i.test(name)) {
        setLoading('\u6b63\u5728\u89e3\u6790\u2026', 60);
        return ImportParse.textToRecords(dec.text);
      }
      return ImportParse.importCsvPipelined(dec.text, function (p, n) {
        setLoading('\u6b63\u5728\u89e3\u6790 CSV\u2026 ' + Math.round(p * 100) + '%\uff08' + n.toLocaleString() + ' \u884c\uff09', 12 + p * 70);
      }, function () { return state.importAbort; }, applyColumnsInfo).then(function (recs) {
        return recs.length ? recs : ImportParse.textToRecords(dec.text);
      });
    });
  }

  return task.then(function (recs) {
    if (recs.length > MAX_IMPORT_ROWS) {
      throw new Error('\u8fd9\u4e2a\u6587\u4ef6\u6709 ' + recs.length.toLocaleString() + ' \u884c\uff0c' +
        '\u8d85\u8fc7\u6d4f\u89c8\u5668\u80fd\u627f\u53d7\u7684\u4e0a\u9650\uff08' + MAX_IMPORT_ROWS.toLocaleString() + ' \u884c\uff09\u3002' +
        '\u8bf7\u5148\u7528\u300c\u4e00\u952e\u89e3\u6790\u5927\u6587\u4ef6.bat\u300d\u805a\u5408\uff0c\u518d\u5bfc\u5165\u6c47\u603b\u6587\u4ef6');
    }
    setLoading('\u6b63\u5728\u5efa\u7acb\u7d22\u5f15\u2026', 94);
    return recs;
  }).then(function (r) {
    clearTimeout(state._importTimer);
    hideLoading();
    if (state.importAbort) { throw new Error('\u5df2\u53d6\u6d88\u5bfc\u5165'); }
    return r;
  }).catch(function (e) {
    clearTimeout(state._importTimer);
    hideLoading();
    throw e;
  });
}

var sheetPromise = null;
var sheetPromise = null;
/* Excel（.xlsx / .xls）解析用 SheetJS，**本地打包**在 vendor/xlsx/ 下。
   原来是引 cdn.jsdelivr.net 的，等于"想导 Excel 就必须联网" —— 和这个工具
   "不联网、双击就能用"的前提直接矛盾：断网、内网、把文件夹拷到别的机器上，Excel 都导不了。
   现在和 deck.gl 一样按需注入本地脚本：不点 Excel 就一个字节都不加载。 */
function loadSheetJs() {
  if (window.XLSX) { return Promise.resolve(); }
  if (sheetPromise) { return sheetPromise; }
  sheetPromise = new Promise(function (/** @type {(v?: any) => void} */ resolve, /** @type {any} */ reject) {
    var s = document.createElement('script');
    s.src = 'vendor/xlsx/xlsx.full.min.js';
    s.onload = function () { if (window.XLSX) { resolve(); } else { reject(new Error('Excel 组件未初始化')); } };
    s.onerror = function () {
      sheetPromise = null;
      reject(new Error('Excel 组件加载失败（vendor/xlsx 目录是否完整？）；也可以把表格另存为 CSV 再导入'));
    };
    document.head.appendChild(s);
  });
  return sheetPromise;
}

/* ---------------- 解析调度 ---------------- */
/* 缓存键：有清洗后的地址就用地址，只有行政区划编码的行用编码当键。
   注意不能用 clean 当键 —— 编码行没有地址文本，clean 是空串，
   那样第一条"广东省深圳市"的坐标会被所有后续编码行复用（北京会落到深圳）。 */
function cacheKeyOf(r) {
  if (r.clean) { return r.clean; }
  if (r.acode || r.ccode || r.pcode) {
    return 'code:' + (r.pcode || '') + '|' + (r.ccode || '') + '|' + (r.acode || '');
  }
  return '';
}

function applyResult(r, res, viaCache) {
  state.stat = null;
  r.lng = res.lng; r.lat = res.lat;
  r.level = res.level || '';
  r.match = res.match || r.match || null;
  r.quality = res.quality || 'unknown';
  r.status = 'ok';
  r.source = viaCache ? (res.source || 'cache') : (res.source || 'local');
  r.flags = EMPTY_ARR;
  r.error = '';
  if (!viaCache) {
    cacheSet(cacheKeyOf(r), {
      lng: res.lng, lat: res.lat, level: r.level,
      quality: r.quality, source: r.source, match: r.match
    });
  }
}

/* 同步解析单条（本地解析本来就是同步的，批量时不用包 Promise） */
function geocodeSync(r) {
  var geo = initLocalGeo();
  var res;
  // 有行政区划编码就直接按编码查，最准最快
  if (r.acode || r.ccode || r.pcode) {
    res = geo.lookupByCode(r.pcode, r.ccode, r.acode);
    if (res.ok) { return { lng: res.lng, lat: res.lat, quality: res.quality, level: res.reason, match: res.match || null, source: 'code' }; }
  }
  res = geo.lookup(r.clean);
  if (!res.ok) { throw new Error(res.reason || '未能匹配到地名'); }
  return { lng: res.lng, lat: res.lat, quality: res.quality, level: res.reason, match: res.match || null, source: 'local' };
}

/* 只更新顶部几个数字，不遍历全表 —— 解析过程中高频调用也不卡 */
function updateStatsFast(ok) {
  var n = state.rows.length;
  setTxt('st-total', n);
  setTxt('st-ok', ok);
  setTxt('st-todo', n - ok);
}

function runGeocode() {
  if (state.running) { state.stopFlag = true; toast('\u6b63\u5728\u505c\u6b62\u2026'); return; }
  var todo = [], okBefore = 0;
  state.rows.forEach(function (r, i) {
    if (r.status === 'ok') { okBefore++; } else { todo.push(i); }
  });
  if (!todo.length) { toast('\u6ca1\u6709\u5f85\u89e3\u6790\u7684\u5730\u5740'); return; }

  state.running = true;
  state.stopFlag = false;
  $('st-progress-wrap').hidden = false;
  $('btn-run').textContent = '\u505c\u6b62';
  $('btn-run').disabled = false;

  var BATCH = 6000;                 // 每批处理 6000 条再让出主线程，界面不冻
  var pos = 0, okCount = 0, failCount = 0, done = 0;
  var lastFull = 0, lastCache = Date.now(), now2 = Date.now();

  function finish(msg) {
    state.running = false;
  if (typeof invalidateRowRegions === 'function') { invalidateRowRegions(); }
    $('st-progress-wrap').hidden = true;
    $('btn-run').textContent = '\u5f00\u59cb\u89e3\u6790';
    cacheFlush();
    updateStats(); renderList(); rebuildMarkers();
    toast(msg + '\uff1a\u6210\u529f ' + okCount.toLocaleString() + '\uff0c\u5931\u8d25 ' + failCount.toLocaleString(), 3200);
  }

  function step() {
    if (state.stopFlag) { finish('\u5df2\u505c\u6b62'); return; }
    var end = Math.min(todo.length, pos + BATCH);
    for (; pos < end; pos++) {
      var r = state.rows[todo[pos]];
      /* 只有省/市/区县编码、没有地址文本的行也有定位依据，不能当空行扔掉 */
      if (!r.clean && !r.acode && !r.ccode && !r.pcode) {
        r.status = 'failed'; r.error = '\u6e05\u6d17\u540e\u4e3a\u7a7a';
        r.flags = ['\u89e3\u6790\u5931\u8d25\uff1a\u6e05\u6d17\u540e\u4e3a\u7a7a'];
        failCount++; done++; continue;
      }
      var cached = cacheGet(cacheKeyOf(r));
      if (cached) {
        applyResult(r, cached, true); okCount++; done++; continue;
      }
      try {
        applyResult(r, geocodeSync(r), false);
        okCount++;
      } catch (e) {
        r.status = 'failed';
        r.error = String((e && e.message) || e);
        r.flags = ['\u89e3\u6790\u5931\u8d25\uff1a' + r.error];
        failCount++;
      }
      done++;
    }
    if (now2 - lastCache > 12000) { lastCache = now2; cacheFlush(); }

    setTxt('st-progress', Math.round(done * 100 / todo.length) + '%');
    updateStatsFast(okBefore + okCount);

    now2 = Date.now();
    // 解析期间只刷列表（地图等全部解析完再画），而且 5 秒才刷一次
    if (now2 - lastFull > 5000) {
      lastFull = now2;
      renderList();
    }
    if (pos < todo.length) { setTimeout(step, 0); }
    else { finish('\u89e3\u6790\u5b8c\u6210'); }
  }
  step();
}

/* ================= 详情弹窗与手动点选 ================= */

/* ---------------- 详情 ---------------- */
function openDetail(i) {
  var r = state.rows[i];
  if (!r) { return; }
  state.activeIdx = i;
  $('d-title').textContent = r.id ? ('\u5ba2\u6237 ' + r.id) : '\u5730\u5740\u8be6\u60c5';
  var rows = [
    ['\u539f\u59cb\u5730\u5740', r.raw],
    ['\u6e05\u6d17\u540e', r.clean || '\uff08\u7a7a\uff09'],
    ['\u72b6\u6001', r.status === 'ok' ? '\u5df2\u5b9a\u4f4d' : (r.status === 'failed' ? '\u5931\u8d25' : '\u5f85\u89e3\u6790')],
    ['\u7cbe\u5ea6', r.status === 'ok'
      ? ((QUALITY_META[r.quality] || QUALITY_META.unknown).label + (r.level ? '\uff08' + r.level + '\uff09' : ''))
      : '\u2014'],
    ['\u5750\u6807', hasCoord(r) ? (r.lng.toFixed(6) + ', ' + r.lat.toFixed(6)) : '\u2014'],
    ['\u6570\u636e\u6765\u6e90', r.source || '\u2014']
  ];
  if (r.match) {
    var mp = [r.match.p, r.match.c, r.match.d, r.match.t].filter(Boolean).join(' / ');
    if (mp) { rows.push(['\u5339\u914d\u5230', mp]); }
  }
  if (r.id) { rows.push(['\u7f16\u53f7', r.id]); }
  if (r.phones && r.phones.length) { rows.push(['\u7535\u8bdd', r.phones.join(' / ')]); }
  if (r.flags && r.flags.length) { rows.push(['\u63d0\u9192', r.flags.join('\uff1b')]); }
  if (r.error) { rows.push(['\u9519\u8bef', r.error]); }
  $('d-body').innerHTML = '<dl>' + rows.map(function (kv) {
    return '<dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd>';
  }).join('') + '</dl>';
  var d = $('dlg-detail');
  if (!d.open) { d.showModal(); }
}

function retryOne() {
  var i = state.activeIdx;
  var r = state.rows[i];
  if (!r) { return; }
  cacheClear(r.clean);
  cacheFlush();
  r.status = 'todo'; r.error = ''; r.flags = EMPTY_ARR;
  renderList(); updateStats();
  toast('\u6b63\u5728\u91cd\u65b0\u89e3\u6790\u2026');
  geocodeOne(r).then(function (res) {
    applyResult(r, res, false);
    cacheFlush();
    renderList(); updateStats(); rebuildMarkers();
    toast('\u91cd\u65b0\u89e3\u6790\u6210\u529f');
    openDetail(i);
  }).catch(function (e) {
    r.status = 'failed';
    r.error = String(e.message || e);
    r.flags = ['\u89e3\u6790\u5931\u8d25\uff1a' + r.error];
    renderList(); updateStats();
    toast('\u4ecd\u7136\u5931\u8d25\uff1a' + r.error, 4000);
  });
}

function startManualPick() {
  var i = state.activeIdx;
  if (i < 0 || !state.rows[i]) { return; }
  $('dlg-detail').close();
  state.manualPick = i;
  document.body.style.cursor = 'crosshair';
  toast('\u5728\u5730\u56fe\u4e0a\u70b9\u51fb\u8be5\u5ba2\u6237\u7684\u771f\u5b9e\u4f4d\u7f6e\uff08\u70b9\u5b8c\u4f1a\u81ea\u52a8\u8bb0\u4f4f\uff0c\u4e0b\u6b21\u76f8\u540c\u5730\u5740\u76f4\u63a5\u547d\u4e2d\uff09', 5000);
}

/* ================= 示例数据与地点字典 ================= */

/* ---------------- 示例数据 ---------------- */
var DEMO = [
  '黑龙江省哈尔滨市呼兰区利民街道示例家园5号楼2单元10楼2门',
  '上海上海市黄浦区南京东路街道示例路51号（示例大厦门卫室）',
  '陕西省西安市莲湖区示例路18号示例广场',
  '江苏常州市金坛区尧塘街道示例南路519号示例新材料科技有限公司',
  '广东省深圳市罗湖区笋岗街道示例大厦803',
  '湖南省长沙市天心区示例小区C区三栋',
  '湖北荆门市钟祥市示例街道示例东路3号',
  '广东江门市蓬江区荷塘镇示例村示例路2号',
  '河南商丘市宁陵县城关回族镇示例国际广场示例店',
  '广东省深圳市龙岗区龙城街道示例新村6巷1号',
  '广东省深圳市福田区示例中路3039号示例大厦2404',
  '江苏南京市玄武区新街口街道示例东路4号示例电视台',
  '湖北省武汉市新洲区邾城街道示例里126号',
  '广东省广州市天河区车陂街道示例大街示例驿站',
  '福建省福州市平潭县海坛街道示例二路示例小区B区#2-503',
  '湖北省武汉市汉阳区永丰街道示例西路示例家园6栋602',
  '上海市奉贤区邬桥镇示例路第二工业大道88号示例实业',
  '示例小区3栋（缺少城市的例子）'
];

/* ---------------- 地点字典 ---------------- */
function importPlacesFile(file) {
  var name = (file.name || '').toLowerCase();
  var read = /\.xlsx?$/.test(name)
    ? loadSheetJs().then(function () { return file.arrayBuffer(); }).then(function (buf) {
        var wb = window.XLSX.read(buf, { type: 'array' });
        var ws = wb.Sheets[wb.SheetNames[0]];
        return window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      })
    : new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(ImportParse.parseCsv(String(fr.result || ''))); };
        fr.onerror = function () { rej(new Error('\u6587\u4ef6\u8bfb\u53d6\u5931\u8d25')); };
        fr.readAsText(file, 'utf-8');
      });
  return read.then(function (rows) {
    if (!rows || !rows.length) { throw new Error('\u6587\u4ef6\u662f\u7a7a\u7684'); }
    var header = (rows[0] || []).map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
    var ni = -1, li = -1, ti = -1;
    header.forEach(function (h, i) {
      if (ni < 0 && /(\u540d\u79f0|\u5730\u70b9|\u5730\u5740|\u5c0f\u533a|\u5927\u53a6|name)/.test(h)) { ni = i; }
      if (li < 0 && /(\u7ecf\u5ea6|lng|lon|longitude)/.test(h)) { li = i; }
      if (ti < 0 && /(\u7eac\u5ea6|lat|latitude)/.test(h)) { ti = i; }
    });
    if (ni < 0) { ni = 0; }
    if (li < 0 || ti < 0) { throw new Error('\u9700\u8981\u300c\u7ecf\u5ea6\u300d\u548c\u300c\u7eac\u5ea6\u300d\u4e24\u5217'); }
    var added = 0;
    rows.slice(1).forEach(function (cells) {
      if (!cells) { return; }
      var nm = String(cells[ni] == null ? '' : cells[ni]).trim();
      var x = parseFloat(cells[li]), y = parseFloat(cells[ti]);
      if (!nm || !isFinite(x) || !isFinite(y)) { return; }
      if (addPlace(nm, x, y)) { added++; }
    });
    flushPlaces();
    return added;
  });
}

function exportPlaces() {
  var places = getPlaces();
  if (!places.length) { toast('地点字典还是空的'); return; }
  downloadText(buildPlacesCsv(places), '地点字典_' + todayStamp() + '.csv');
}

function saveCurrentPlace() {
  var r = state.rows[state.activeIdx];
  if (!r) { return; }
  if (!hasCoord(r)) { toast('\u8fd9\u6761\u8fd8\u6ca1\u6709\u5750\u6807\uff0c\u5148\u89e3\u6790\u6216\u624b\u52a8\u70b9\u9009'); return; }
  var def = suggestPlaceName(r);
  var nm = window.prompt('\u7ed9\u8fd9\u4e2a\u5730\u70b9\u8d77\u4e2a\u540d\u5b57\uff08\u4ee5\u540e\u5730\u5740\u91cc\u5305\u542b\u8fd9\u51e0\u4e2a\u5b57\u5c31\u4f1a\u547d\u4e2d\uff09\uff1a', def);
  if (!nm) { return; }
  nm = nm.trim();
  if (addPlace(nm, r.lng, r.lat)) {
    flushPlaces(); refreshPlaces();
    toast('\u5df2\u52a0\u5165\u5730\u70b9\u5b57\u5178\uff1a' + nm);
  } else { toast('\u5b57\u5178\u91cc\u5df2\u7ecf\u6709\u540c\u540d\u6761\u76ee'); }
}

  return {
    loadRecords: loadRecords,
    readFile: readFile,
    previewImport: previewImport,
    loadSheetJs: loadSheetJs,
    showLoading: showLoading,
    setLoading: setLoading,
    hideLoading: hideLoading,
    abortImport: abortImport,
    runGeocode: runGeocode,
    updateStatsFast: updateStatsFast,
    openDetail: openDetail,
    retryOne: retryOne,
    startManualPick: startManualPick,
    importPlacesFile: importPlacesFile,
    exportPlaces: exportPlaces,
    saveCurrentPlace: saveCurrentPlace,
    DEMO: DEMO,
    /* 导入上限：界面那边也要判断文件大小 */
    MAX_IMPORT_BYTES: MAX_IMPORT_BYTES,
    MAX_IMPORT_ROWS: MAX_IMPORT_ROWS
  };
}
