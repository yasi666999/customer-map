/* deck.gl 地图引擎
   ------------------------------------------------------------------
   替换原来的「百度 GL 底图 + 手写 Canvas 数据层」。设计原则：

   1. 坐标系不用转换：项目里的客户坐标是 GCJ02，高德瓦片也是 GCJ02，
      两边喂给 deck.gl 的是同一套数，天然对齐（原来还要在百度 BD09 之间来回换）。
   2. 拾取结果沿用项目原有的形状（{kind:'pt'|'hex'|'cell', item, cell, count}），
      这样 main.js 里的提示卡、点击、图例全都不用改。
   3. 底图双保险：在线用高德瓦片（不需要任何密钥），离线/关闭时用本地边界。
   4. 懒加载：deck.gl 那个 2MB 的包只在真正切到 deck 引擎时才加载。 */

import Supercluster from 'supercluster';

export const AMAP_TILE = 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}';
export const BLANK_TILE = null;

/* 本地边界（window.CN_BOUNDARY_*）→ GeoJSON。
   源数据形状：[编码, 名称, [minLng,minLat,maxLng,maxLat], [环1(扁平), 环2, ...]]
   每个环当成一个独立多边形：配合 filled:false 只描边，就不必区分外环和内洞。 */
export function boundariesToGeoJSON(feats) {
  if (!feats || !feats.length) { return { type: 'FeatureCollection', features: [] }; }
  return {
    type: 'FeatureCollection',
    features: feats.map(function (f) {
      var rings = f[3] || [];
      return {
        type: 'Feature',
        properties: { code: f[0], name: f[1], bb: f[2] },
        geometry: {
          type: 'MultiPolygon',
          coordinates: rings.map(function (flat) {
            var ring = [];
            for (var i = 0; i < flat.length; i += 2) { ring.push([flat[i], flat[i + 1]]); }
            return [ring];
          })
        }
      };
    })
  };
}

/* 从点集算边界框（用于"看全图"） */
export function boundsOf(items) {
  var minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (var i = 0; i < items.length; i++) {
    var r = items[i].r || items[i];
    if (typeof r.lng !== 'number' || typeof r.lat !== 'number') { continue; }
    if (r.lng < minLng) { minLng = r.lng; }
    if (r.lng > maxLng) { maxLng = r.lng; }
    if (r.lat < minLat) { minLat = r.lat; }
    if (r.lat > maxLat) { maxLat = r.lat; }
  }
  if (!isFinite(minLng)) { return null; }
  return { minLng: minLng, minLat: minLat, maxLng: maxLng, maxLat: maxLat };
}

/* 根据经纬度跨度估一个合适的缩放级别。
   注意：deck.gl 的 WebMercatorViewport 用的是 **512px 世界瓦片**（不是标准的 256），
   同一个 zoom 下能看到的范围只有 256 基准的一半。用 256 去算会算出偏大一级的 zoom，
   实测表现为"数据被放大一倍、南边的点跑到屏幕外"。 */
var DECK_TILE = 512;
export function zoomForBounds(b, W, H) {
  if (!b) { return 4; }
  var spanLng = Math.max(0.02, b.maxLng - b.minLng);
  var spanLat = Math.max(0.02, b.maxLat - b.minLat);
  var zx = Math.log2((W * 0.88) / (spanLng * DECK_TILE / 360));
  var zy = Math.log2((H * 0.88) / (spanLat * DECK_TILE / 360));
  // 保留一位小数：deck 支持分数级缩放，取整会白白丢掉近一半画面
  return Math.max(2, Math.min(16, Math.round(Math.min(zx, zy) * 10) / 10));
}

export function isDeckReady() {
  return !!(window.deck && window.deck.Deck);
}

/* ================= 点聚合（气泡） =================
   deck.gl 官方图层里没有"带数字的气泡聚类"这一层，但这类聚类的**行业标准实现**是
   Mapbox 的 supercluster（deck.gl 官方示例里的聚合也是配它用的），所以直接用它，
   不再自己写聚类算法。
   - radius 是屏幕像素半径（64），缩放级别变了自动重新分层
   - 每个点带一个权重（客户数），reduce 求和 → 气泡里就是"这些客户加起来多少"
   - 点气泡能直接查到"展开到几级"，比固定 +2 级更准 */
const CLUSTER_RADIUS = 64;
let clusterIndex = null;
let clusterIndexKey = '';

export function buildClusters(items, zoom) {
  const key = items.length + '|' + (items.length ? String(items[0].r.clean) + '|' + items[items.length - 1].r.lat : '');
  if (clusterIndexKey !== key) {
    const idx = new Supercluster({
      radius: CLUSTER_RADIUS,
      maxZoom: 16,
      map: props => ({ i: props.i, n: props.n }),
      reduce: (acc, props) => { acc.n += props.n; }
    });
    idx.load(items.map((it, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [it.r.lng, it.r.lat] },
      properties: { i: i, n: (it.r.count > 1 ? it.r.count : 1) }
    })));
    clusterIndex = idx;
    clusterIndexKey = key;
  }
  const z = Math.max(0, Math.min(20, Math.round(zoom)));
  const features = clusterIndex.getClusters([-180, -85, 180, 85], z);
  const out = [];
  let max = 1, singles = 0;
  for (const f of features) {
    const p = f.properties;
    const isCluster = !!p.cluster;
    const n = p.n || 1;
    if (!isCluster) { singles++; }
    if (n > max) { max = n; }
    out.push({
      lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      n: n, pts: isCluster ? p.point_count : 1,
      clusterId: isCluster ? p.cluster_id : null,
      rep: isCluster ? null : items[p.i]
    });
  }
  out.sort((a, b) => b.n - a.n);
  return { list: out, max: max, groups: out.length, singles: singles, zoom: z };
}

/** 点开一个气泡要放大到几级才散开（supercluster 自带的） */
export function clusterExpansionZoom(clusterId) {
  try { return clusterIndex ? clusterIndex.getClusterExpansionZoom(clusterId) : null; } catch (e) { return null; }
}

export function createDeckEngine(opts) {
  var container = opts.container;
  var deckApi = window.deck;
  var state = {
    view: { longitude: 105, latitude: 35, zoom: 5, pitch: 0, bearing: 0 },
    layers: [],
    effects: [],
    lastPick: null
  };

  /* 注意：UMD 包里 DeckGL 是 React 包装版，传 parent 会被忽略（画布跑到 body 上）。
     要挂到指定容器必须用 deck.Deck。这个是实测出来的，别改回去。 */
  var deck = new deckApi.Deck({
    parent: container,
    views: [new deckApi.MapView({ repeat: false })],
    // 只用受控的 viewState，不要同时给 initialViewState ——
    // 两个都给的话 deck 会以 initialViewState 为准，后面 setProps 的 viewState 就不生效了
    viewState: state.view,
    controller: { scrollZoom: true, dragPan: true, doubleClickZoom: true, touchRotate: false },
    useDevicePixels: true,
    /* 保留绘制缓冲，否则 canvas.toDataURL() 拿到的是空白（WebGL 默认不保留）。
       代价是每帧多一次拷贝，本地工具这个量级可以接受；换来的是"保存地图图片"可用。 */
    glOptions: { preserveDrawingBuffer: true },
    transitionDuration: 0,   // 关掉视图过渡动画：重绘会不断打断动画，导致视图停在半路（实测踩过）
    getCursor: function (o) { return o && o.isHovering ? 'pointer' : 'grab'; },
    /* 受控模式的关键：用户拖动/缩放后必须把新的 viewState **回写**给 deck。
       不回写的话画面会弹回原位（视口还是旧的），实测表现为"拖了没反应"。 */
    onViewStateChange: function (e) {
      state.view = e.viewState;
      deck.setProps({ viewState: e.viewState });
      if (opts.onViewChange) { opts.onViewChange(e.viewState); }
    },
    getTooltip: null,
    /* 拾取结果统一包成项目原有的形状（{kind, code, name, v, cen, item, count}），
       这样 main.js 里的提示卡、点选、图例全都不用改。 */
    onHover: function (info) {
      if (!opts.onHover) { return; }
      opts.onHover(info && info.object ? info : null, info);
    },
    onClick: function (info) {
      if (!opts.onClick) { return; }
      opts.onClick(info && info.object ? info : null, info);
    },
    layers: []
  });

  window.__cmDeck = deck;   // 调试句柄（和项目里 __cmMap / __cmLayer 一个套路）

  /* 3D 柱状的灯效 —— deck.gl 官方给"挤出"图层的标配（AmbientLight + DirectionalLight）。
     不装灯的话挤出的柱子是纯色平涂，看不出立体和高度层次；装上后柱顶/柱侧面有明暗过渡。
     注意 LightingEffect 的构造方式是「遍历传入对象的每个 key，按灯自己的 type 分派」，
     所以 key 名随便取（这里 ambient / dir1 只是可读性），不需要写成 directionalLights 数组。 */
  /* 3D 柱状的灯效 —— 用 deck 官方的 AmbientLight + DirectionalLight（不自己写光照）。
     两盏方向光的朝向照抄 deck 自己在"没给灯"时用的那一组（顶光 + 侧补光），
     环境光强度做成可调参数（面板上的"立体感"）：环境光越低，柱顶和柱侧面的明暗差越大。
     LightingEffect 的构造是「遍历对象里每个 key，按灯自己的 type 分派」，
     所以 key 名随便取（ambient / dir1 / dir2 只是为了可读）。 */
  var hasLightApi = !!(deckApi.AmbientLight && deckApi.DirectionalLight && deckApi.LightingEffect);
  var lightAmbient = hasLightApi ? new deckApi.AmbientLight({ color: [255, 255, 255], intensity: 0.75 }) : null;
  var lightDir1 = hasLightApi ? new deckApi.DirectionalLight({ color: [255, 255, 255], intensity: 1.2, direction: [-1, 3, -1] }) : null;
  var lightDir2 = hasLightApi ? new deckApi.DirectionalLight({ color: [255, 255, 255], intensity: 0.85, direction: [1, -8, -2.5] }) : null;
  var lightingEffect = hasLightApi
    ? new deckApi.LightingEffect({ ambient: lightAmbient, dir1: lightDir1, dir2: lightDir2 })
    : null;
  var lightAmbNow = 0.75;

  function makeBaseLayers(p) {
    var out = [];
    if (p.boundary) {
      out.push(new deckApi.GeoJsonLayer({
        id: 'boundary', data: p.boundary, stroked: true, filled: false, pickable: false,
        getLineColor: [120, 132, 150, 150], lineWidthMinPixels: p.boundaryWidth || 0.7
      }));
    }
    if (p.tiles) {
      out.push(new deckApi.TileLayer({
        id: 'basemap', data: p.tiles, minZoom: 0, maxZoom: 18, tileSize: 256,
        renderSubLayers: function (props) {
          var b = props.tile.bbox;
          return new deckApi.BitmapLayer(props, {
            data: null,          // 不写这行 BitmapLayer 会把瓦片模板当数据容器，画面全空
            image: props.data,
            bounds: [b.west, b.south, b.east, b.north]
          });
        }
      }));
    }
    return out;
  }

  /* deck 的 TextLayer 默认只预生成 ASCII 字形（characterSet 默认 32~127）：中文会报
     "Missing character" 然后整段画不出来（实测：白色底衬画了、字是空的）。
     所以这里在造图层之前就把字符集算好传进去（官方也有 characterSet:'auto'，但它要等
     第一帧之后才从数据里收集字符，这一版配碰撞避让时会全被剔掉，不如自己先算好）。 */
  function charsetOf(items, getText) {
    var seen = Object.create(null), out = '';
    for (var i = 0; i < items.length; i++) {
      var s = String(getText(items[i]) || '');
      for (var j = 0; j < s.length; j++) { var ch = s.charAt(j); if (!seen[ch]) { seen[ch] = 1; out += ch; } }
    }
    return out;
  }

  function makeDataLayers(p) {
    var items = p.items || [];
    var params = p.params || {};
    var out = [];
    var colorOf = p.colorOf || function (r) { return [47, 111, 237]; };

    if (params.mode === 'hex') {
      // 层级（h3Res）换算成米制半径，和图例/滑块对得上；格子数用同一个 H3 口径统计，
      // 这样"调层级格子数变化"这类断言在两种引擎下都成立。
      var res = params.h3Res | 0;
      var radiusM = p.hexRadius ? p.hexRadius(res) : 30000;
      if (p.cellOf) {
        var seen = new Set();
        for (var hi = 0; hi < items.length; hi++) {
          try { seen.add(p.cellOf(items[hi].r.lat, items[hi].r.lng, res)); } catch (e) {}
        }
        p.hexStats = { bins: seen.size, res: res, radiusM: Math.round(radiusM) };
      }
      out.push(new deckApi.HexagonLayer({
        id: 'hex', data: items, pickable: true,
        getPosition: function (d) { return [d.r.lng, d.r.lat]; },
        getWeight: function (d) { return (d.r.count > 1 ? d.r.count : 1); },
        radius: Math.round(radiusM),
        coverage: 0.92,
        // 3D 挤出（deck.gl HexagonLayer 的招牌效果）：柱子高度 = 客户数
        extruded: !!params.extrude,
        elevationScale: params.extrude ? (p.elevationScale || 30) : 0,
        elevationRange: [0, 1000],
        colorRange: p.ramp || [[1,152,189],[73,227,206],[216,254,181],[254,237,177],[254,173,84],[209,55,78]],
        opacity: (params.alpha != null ? params.alpha : 85) / 100,
      }));
    } else if (params.mode === 'grid' && params.extrude) {
      // 屏幕网格没法挤出（它是 2D 的），挤出时换成地理网格 GridLayer
      var cellM = p.gridCellMeters || 30000;
      out.push(new deckApi.GridLayer({
        // id 必须和 2D 的屏幕网格分开：deck 对"同一个 id 换成另一种图层"会复用内部的
        // 聚合状态，切回 2D 时 ScreenGridLayer 会一直报 onSetColorDomain 不是函数、
        // 网格直接画不出来（和区域层级那个坑同一类问题）。
        id: 'grid3d', data: items, pickable: true, extruded: true,
        getPosition: function (d) { return [d.r.lng, d.r.lat]; },
        getWeight: function (d) { return (d.r.count > 1 ? d.r.count : 1); },
        cellSize: cellM, coverage: 0.92, elevationScale: p.elevationScale || 30,
        // 透明度滑块对网格同样有效（以前这里写死 0.8，滑了没反应）
        opacity: (params.alpha != null ? params.alpha : 85) / 100,
        colorRange: p.ramp || [[1,152,189],[73,227,206],[216,254,181],[254,237,177],[254,173,84],[209,55,78]]
      }));
    } else if (params.mode === 'grid') {
      out.push(new deckApi.ScreenGridLayer({
        id: 'grid2d', data: items, pickable: true,
        getPosition: function (d) { return [d.r.lng, d.r.lat]; },
        getWeight: function (d) { return (d.r.count > 1 ? d.r.count : 1); },
        cellSizePixels: Math.max(20, params.gridSize | 0),
        colorRange: p.ramp || [[1,152,189],[73,227,206],[216,254,181],[254,237,177],[254,173,84],[209,55,78]],
        // 同上：跟着"透明度"滑块走
        opacity: (params.alpha != null ? params.alpha : 85) / 100
      }));
    } else if (params.mode === 'heat') {
      out.push(new deckApi.HeatmapLayer({
        id: 'heat', data: items, pickable: false,
        getPosition: function (d) { return [d.r.lng, d.r.lat]; },
        getWeight: function (d) { return (d.r.count > 1 ? d.r.count : 1); },
        radiusPixels: Math.max(8, params.heatRadius || 28),
        intensity: params.heatIntensity != null ? params.heatIntensity : 1,
        // 配色方案（经典/暖色/红色）由参数面板控制
        colorRange: p.heatRamp || undefined,
        threshold: 0.05
      }));
      /* 热力图上再标出客户最多的前 N 个点 —— 光有颜色分布看不出"具体是哪几个地方" */
      var topN = params.heatTopN | 0;
      if (topN > 0 && items.length) {
        var ranked = items.slice().sort(function (a, b) { return (b.r.count || 0) - (a.r.count || 0); }).slice(0, topN);
        var fmtTop = p.formatCount || function (v) { return String(v); };
        var labelTop = p.shortLabelOf || function () { return ''; };
        var heatTopText = function (d) {
          var t = labelTop(d.r);
          return d.r.count > 1 ? t + ' ' + fmtTop(d.r.count) : t;
        };
        out.push(new deckApi.TextLayer({
          id: 'heat-top', data: ranked, pickable: false,
          getPosition: function (d) { return [d.r.lng, d.r.lat]; },
          getText: heatTopText,
          getSize: 11, sizeUnits: 'pixels', getColor: [28, 28, 30, 240],
          fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
          characterSet: charsetOf(ranked, heatTopText),
          fontWeight: 700, getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
          getPixelOffset: [0, -6], background: true, backgroundPadding: [4, 1],
          getBackgroundColor: [255, 255, 255, 220]
        }));
      }
    } else if (params.mode === 'region' && p.region && p.region.geojson) {
      var rg = p.region;
      /* 图层 id 带上层级 —— 省级和市级的 GeoJSON 形状差别很大，
         而 deck 在用同一个 id 换 data 时**不会把旧的几何清干净**：
         实测省 → 市 → 省之后，图层数据已经是 34 个省，画面却还是密密麻麻的市界
         （对比"切走再切回"的强制重建结果才看出来，图层数据和配色都是对的）。
         换个 id 就等于换一个新图层，deck 会把旧的整个销毁。和 pts / pts-grid 同一个道理。 */
      out.push(new deckApi.GeoJsonLayer({
        id: 'region-' + (rg.level || 'region'), data: rg.geojson, pickable: true,
        filled: true, stroked: true,
        getFillColor: function (f) { return p.regionColorOf(f.properties); },
        getLineColor: [255, 255, 255, 190], lineWidthMinPixels: 0.5,
        updateTriggers: { getFillColor: [rg.version] }
      }));
    } else if (params.mode === 'cluster') {
      var cl = buildClusters(items, p.zoom || 5);
      var lgMax = Math.log(1 + cl.max);
      var fmt = p.formatCount || function (v) { return String(v); };
      out.push(new deckApi.ScatterplotLayer({
        id: 'clusters', data: cl.list, pickable: true,
        getPosition: function (d) { return [d.lng, d.lat]; },
        getRadius: function (d) {
          var t = lgMax > 0 ? Math.log(1 + d.n) / lgMax : 0;
          return 10 + 16 * Math.sqrt(t);
        },
        radiusUnits: 'pixels', radiusMinPixels: 8, radiusMaxPixels: 28,
        getFillColor: function (d) {
          var t = lgMax > 0 ? Math.log(1 + d.n) / lgMax : 0;
          return [Math.round(70 + 140 * t), Math.round(150 - 90 * t), Math.round(210 - 140 * t), 210];
        },
        stroked: true, getLineColor: [255, 255, 255, 235], lineWidthMinPixels: 1.5
      }));
      var clusterTextData = cl.list.filter(function (d) { return d.n > 1; });
      var clusterText = function (d) { return fmt(d.n); };
      out.push(new deckApi.TextLayer({
        id: 'cluster-labels', data: clusterTextData, pickable: false,
        getPosition: function (d) { return [d.lng, d.lat]; },
        getText: clusterText,
        getSize: 11, sizeUnits: 'pixels',
        getColor: [255, 255, 255, 245],
        fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
        characterSet: charsetOf(clusterTextData, clusterText),
        fontWeight: 700,
        getTextAnchor: 'middle', getAlignmentBaseline: 'center'
      }));
      p.clusterStats = { bubbles: cl.list.filter(function (d) { return d.pts > 1; }).length,
        singles: cl.singles, max: cl.max, groups: cl.groups, zoom: cl.zoom, radius: CLUSTER_RADIUS };
    } else if (params.layerPoints === false) {
      // 图层面板里把"客户点"关掉就真的不画
      p.skippedPoints = true;
    } else {
      /* 「高光」：给客户最多的前几个点加一层柔和的晕，一眼看出人多的地方在哪。
         是一层静态的半透明大圆点，不打动画 —— 动画每帧都要重绘，几千个点会拖慢拖动。
         图层面板里可以关掉。 */
      if (params.glow !== false && items.length) {
        var glowN = Math.min(24, items.length);
        var glowItems = items.slice().sort(function (a, b) {
          return (b.r.count || 0) - (a.r.count || 0);
        }).slice(0, glowN);
        out.push(new deckApi.ScatterplotLayer({
          id: 'glow', data: glowItems, pickable: false,
          getPosition: function (d) { return [d.r.lng, d.r.lat]; },
          getRadius: function (d) {
            var c = colorOf(d.r);
            return c ? 26 : 26;
          },
          radiusUnits: 'pixels',
          getFillColor: function (d) {
            var c = colorOf(d.r);
            return [c[0], c[1], c[2], 34];
          },
          stroked: false
        }));
      }
      var maxC = p.maxCount || 1;
      var baseSize = params.size || 14;
      /* 点太大小时按客户数放大（和手写版同一套公式：平方根归一，避免个别大点压扁其余点）。
         关掉这个开关就是统一直径。 */
      var radiusOf = function (d) {
        var n = d.r.count > 1 ? d.r.count : 1;
        if (!params.sizeByCount || maxC <= 1 || n <= 1) { return Math.max(2.5, baseSize / 2); }
        var t = Math.sqrt(n) / Math.sqrt(maxC);
        return Math.max(3, Math.round(baseSize * (0.72 + t * 1.5)) / 2);
      };
      var fill = function (d) {
        var c = colorOf(d.r);
        return [c[0], c[1], c[2], (params.alpha != null ? params.alpha : 85) * 2.55];
      };
      /* 点太密自动降级成屏幕网格（kepler.gl 的做法）：
         视野里的点超过阈值、而且用户没关掉这个开关时，用聚合网格代替密密麻麻的点。 */
      if (params.lod !== false && items.length > (p.lodMax || 9000)) {
        out.push(new deckApi.ScreenGridLayer({
          // 换个 id：和散点图层同名的话，deck 复用图层时会残留上一种图层的 props
          id: 'pts-grid', data: items, pickable: true,
          getPosition: function (d) { return [d.r.lng, d.r.lat]; },
          getWeight: function (d) { return (d.r.count > 1 ? d.r.count : 1); },
          cellSizePixels: Math.max(20, params.gridSize | 0),
          colorRange: p.ramp || [[1,152,189],[73,227,206],[216,254,181],[254,237,177],[254,173,84],[209,55,78]],
          opacity: 0.8
        }));
        p.autoGrid = true;
      } else {
        out.push(new deckApi.ScatterplotLayer({
          id: 'pts', data: items, pickable: true,
          getPosition: function (d) { return [d.r.lng, d.r.lat]; },
          getRadius: radiusOf,
          radiusUnits: 'pixels', radiusMinPixels: 2.5,
          getFillColor: fill,
          stroked: true, getLineColor: [255, 255, 255, 235], lineWidthMinPixels: 1,
          updateTriggers: { getRadius: [params.size, params.sizeByCount, maxC] }
        }));
      }
    }
    return out;
  }

  /* ================= 常驻地址 · 辐射圈 · 连线 · 标签 =================
     全部用 deck 官方图层实现（原来百度那边是 DOM 覆盖物）：
       辐射圈 / 客户圈 → ScatterplotLayer（stroked + radiusUnits:'meters'，就是真实的米制圆）
       连线           → LineLayer
       常驻地址       → ScatterplotLayer + TextLayer（名字做底衬）
       地点标签       → TextLayer（用 characterSet 带上中文字形；数量按缩放级别控制） */
  function makeOverlayLayers(p) {
    var out = [];
    var params = p.params || {};
    var bases = (p.bases || []).filter(function (b) {
      return b && b.enabled !== false && typeof b.lng === 'number' && typeof b.lat === 'number';
    });
    var COLORS = p.baseColors || [[0, 113, 227]];
    var colAt = function (i) { return COLORS[i % COLORS.length]; };
    var items = p.items || [];
    var FONT = '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';
    /* 文字图层都要带 characterSet（见上面 charsetOf() 的说明）：不带就只有英文字母数字能显示。 */

    /* --- 辐射圈（每个常驻点 N 圈） --- */
    if (params.showRings !== false && params.radiusKm > 0 && bases.length) {
      var rings = [];
      bases.forEach(function (b, bi) {
        var col = colAt(bi);
        var n = Math.max(1, params.rings | 0 || 1);
        for (var k = 1; k <= n; k++) {
          rings.push({ lng: b.lng, lat: b.lat, r: params.radiusKm * k * 1000, col: col, km: params.radiusKm * k, k: k });
        }
      });
      out.push(new deckApi.ScatterplotLayer({
        id: 'base-rings', data: rings, pickable: false,
        getPosition: function (d) { return [d.lng, d.lat]; },
        getRadius: function (d) { return d.r; }, radiusUnits: 'meters',
        filled: true, getFillColor: function (d) { return [d.col[0], d.col[1], d.col[2], d.k === 1 ? 22 : 10]; },
        stroked: true, getLineColor: function (d) { return [d.col[0], d.col[1], d.col[2], 190]; },
        getLineWidth: function (d) { return d.k === 1 ? 2 : 1; }, lineWidthUnits: 'pixels'
      }));
      if (params.ringLabel) {
        var ringText = function (d) { return d.km + 'km'; };
        out.push(new deckApi.TextLayer({
          id: 'ring-labels', data: rings, pickable: false,
          getPosition: function (d) { return [d.lng, d.lat + d.km / 111.32]; },
          getText: ringText,
          getSize: 10, sizeUnits: 'pixels', getColor: [255, 255, 255, 250],
          fontFamily: FONT, fontWeight: 600, getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
          characterSet: charsetOf(rings, ringText),
          background: true, backgroundPadding: [5, 1],
          getBackgroundColor: function (d) { return [d.col[0], d.col[1], d.col[2], 235]; }
        }));
      }
    }

    /* --- 常驻地址的标记与名字 --- */
    if (params.showBases !== false && bases.length) {
      out.push(new deckApi.ScatterplotLayer({
        id: 'bases', data: bases, pickable: true,
        getPosition: function (d) { return [d.lng, d.lat]; },
        getRadius: function () { return Math.max(7, (params.size || 14) * 0.75); }, radiusUnits: 'pixels',
        filled: true,
        getFillColor: function (d, info) { var c = colAt(info.index); return [c[0], c[1], c[2], 255]; },
        stroked: true, getLineColor: [255, 255, 255, 245], lineWidthMinPixels: 2
      }));
      var baseText = function (d) { return d.name || '常驻'; };
      out.push(new deckApi.TextLayer({
        id: 'base-labels', data: bases, pickable: false,
        getPosition: function (d) { return [d.lng, d.lat]; },
        getText: baseText,
        getSize: 11, sizeUnits: 'pixels', getColor: [255, 255, 255, 250],
        fontFamily: FONT, fontWeight: 600, getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
        characterSet: charsetOf(bases, baseText),
        getPixelOffset: [0, -12], background: true, backgroundPadding: [6, 1],
        getBackgroundColor: function (d, info) { var c = colAt(info.index); return [c[0], c[1], c[2], 235]; }
      }));
    }

    /* --- 常驻点 → 客户的连线 ---
       原来这里是「点数超过 400 就一条都不画」——手写 Canvas 时代的性能妥协，代价是
       数据一多连线整个消失。现在连线走 deck 的 ArcLayer / LineLayer（GPU 批量绘制），
       几万条也不吃力，所以改成「按距离取最近的 N 条」：既不会一条不画，也不会糊成一团。 */
    if (params.showLines && bases.length && items.length) {
      var linkAll = items.filter(function (it) {
        var r = it.r;
        var b = r.baseIdx != null && r.baseIdx >= 0 ? bases[r.baseIdx] : null;
        return !!(b && typeof b.lng === 'number' && typeof b.lat === 'number');
      });
      var linkMax = Math.max(1, params.linkMax || 1500);
      var linkable = linkAll;
      if (linkable.length > linkMax) {
        linkable = linkable.slice().sort(function (x, y) {
          var dx = x.r.distKm == null ? 1e9 : x.r.distKm;
          var dy = y.r.distKm == null ? 1e9 : y.r.distKm;
          return dx - dy;
        }).slice(0, linkMax);
      }
      var lines = linkable.map(function (it) {
        var r = it.r;
        var b = bases[r.baseIdx];
        return { from: [b.lng, b.lat], to: [r.lng, r.lat], col: colAt(r.baseIdx) };
      });
      p.linkStats = { total: linkAll.length, drawn: lines.length, max: linkMax };
      if (lines.length) {
        if (params.linkStyle === 'line') {
          out.push(new deckApi.LineLayer({
            id: 'base-lines', data: lines, pickable: false,
            getSourcePosition: function (d) { return d.from; },
            getTargetPosition: function (d) { return d.to; },
            getColor: function (d) { return [d.col[0], d.col[1], d.col[2], 110]; },
            getWidth: 1.4, widthUnits: 'pixels'
          }));
        } else {
          /* 默认走 deck 的 ArcLayer：常驻点 → 客户的"流向"用弧线看更清楚，
             而且弧线在两个图层 id 上分开，避免换图层类型时 props 残留。 */
          out.push(new deckApi.ArcLayer({
            id: 'base-arcs', data: lines, pickable: false,
            getSourcePosition: function (d) { return d.from; },
            getTargetPosition: function (d) { return d.to; },
            getSourceColor: function (d) { return [d.col[0], d.col[1], d.col[2], 110]; },
            getTargetColor: function (d) { return [d.col[0], d.col[1], d.col[2], 205]; },
            getWidth: 1.4, widthUnits: 'pixels',
            getHeight: 0.4,
            greatCircle: false
          }));
        }
      }
    }

    /* --- 每个客户的辐射圈（客户数多时只画前 400 个，避免糊成一片） --- */
    if (params.customerRings && params.radiusKm > 0 && items.length) {
      out.push(new deckApi.ScatterplotLayer({
        id: 'customer-rings', data: items.slice(0, 400), pickable: false,
        getPosition: function (d) { return [d.r.lng, d.r.lat]; },
        getRadius: function () { return params.radiusKm * 1000; }, radiusUnits: 'meters',
        filled: true, getFillColor: function (d) { var c = p.colorOf(d.r); return [c[0], c[1], c[2], 12]; },
        stroked: true, getLineColor: function (d) { var c = p.colorOf(d.r); return [c[0], c[1], c[2], 120]; },
        lineWidthMinPixels: 1
      }));
    }

    /* --- 地点名称标签（用官方的碰撞避让扩展，不自己算矩形相交） --- */
    if (params.label && items.length) {
      /* 标签数量按缩放级别给：全国视角只标前 50 个，放大后再逐步放开。
         为什么不继续用 deck 的 CollisionFilterExtension：实测它在这个版本上会把
         **所有**标签都剔掉（文字量出来是 0 宽 → 判定成全部重叠），渲染出来一个字都没有；
         去掉之后 160 个标签正常显示，靠数量控制就不会糊成一片。 */
      var zoomNow = p.zoom || 5;
      var maxLabels = zoomNow < 4 ? 50 : (zoomNow < 6 ? 90 : 160);
      var top = items.slice().sort(function (a, b) { return (b.r.count || 0) - (a.r.count || 0); }).slice(0, maxLabels);
      var fmt = p.formatCount || function (v) { return String(v); };
      var label = p.shortLabelOf || function () { return ''; };
      var placeText = function (d) {
        var t = label(d.r);
        return d.r.count > 1 ? t + ' ' + fmt(d.r.count) : t;
      };
      out.push(new deckApi.TextLayer({
        id: 'place-labels', data: top, pickable: false,
        getPosition: function (d) { return [d.r.lng, d.r.lat]; },
        getText: placeText,
        getSize: 11, sizeUnits: 'pixels', getColor: [28, 28, 30, 235],
        fontFamily: FONT, fontWeight: 600, getTextAnchor: 'middle', getAlignmentBaseline: 'bottom',
        characterSet: charsetOf(top, placeText),
        getPixelOffset: [0, -6],
        background: true, backgroundPadding: [4, 1], getBackgroundColor: [255, 255, 255, 215]
      }));
    }
    return out;
  }
  function update(p) {
    state.layers = makeBaseLayers(p).concat(makeDataLayers(p)).concat(makeOverlayLayers(p));
    /* 只有在"真的有 3D 柱子"的时候才挂灯效：2D 图层用不上，白白多跑一遍光照计算。
       切回 2D 时必须把 effects 清空，否则灯效会一直留在渲染管线里。 */
    var has3d = !!(p.params && p.params.extrude) && (p.params.mode === 'hex' || p.params.mode === 'grid');
    if (has3d && lightingEffect) {
      // 立体感滑块 → 环境光强度。改了才重建 effect，避免拖动滑块时每帧都重编译着色器。
      var amb = Math.max(0.05, Math.min(1.5, p.params.lightAmb != null ? p.params.lightAmb : 0.75));
      if (amb !== lightAmbNow) {
        lightAmbNow = amb;
        lightAmbient.intensity = amb;
        lightingEffect.setProps({ ambient: lightAmbient, dir1: lightDir1, dir2: lightDir2 });
      }
    }
    state.effects = (lightingEffect && has3d) ? [lightingEffect] : [];
    deck.setProps({ layers: state.layers, effects: state.effects });
    return { layers: state.layers.length, lighting: state.effects.length > 0,
      linkStats: p.linkStats || null,
      clusterStats: p.clusterStats || null, hexStats: p.hexStats || null,
      autoGrid: !!p.autoGrid, skippedPoints: !!p.skippedPoints };
  }

  return {
    raw: deck,
    update: update,
    getView: function () { return state.view; },
    /**
     * 设置视野。给了 ms 就是"平滑飞过去"（deck 自带的过渡插值），
     * 不给就是瞬移 —— 拖动地图那种高频调用必须是瞬移，否则动画会被下一帧打断。
     */
    setView: function (v, ms) {
      state.view = Object.assign({}, state.view, v);
      var vs = state.view;
      if (ms) { vs = Object.assign({}, state.view, { transitionDuration: ms }); }
      deck.setProps({ viewState: vs });
    },
    zoomBy: function (d) { deck.setProps({ viewState: Object.assign({}, state.view, { zoom: state.view.zoom + d }) }); },
    fit: function (items, opts) {
      var b = boundsOf(items);
      var el = container;
      var W = el.clientWidth || 1200, H = el.clientHeight || 800;
      /* 底部有时间条这类浮层压着：把它扣掉再算取景，并且把中心往南挪半个浮层的高度 ——
         否则最南边那排点正好藏在面板后面，既看不见也点不到（实测踩过）。 */
      var inset = Math.max(0, (opts && opts.bottomInset) || 0);
      var z = zoomForBounds(b, W, Math.max(160, H - inset));
      var cLat = b ? (b.minLat + b.maxLat) / 2 : 35;
      if (b && inset) {
        var degPerPx = 360 / (DECK_TILE * Math.pow(2, z));
        cLat -= (inset / 2) * degPerPx / Math.max(0.2, Math.cos(cLat * Math.PI / 180));
      }
      var v = b
        ? { longitude: (b.minLng + b.maxLng) / 2, latitude: cLat, zoom: z, pitch: 0, bearing: 0 }
        : { longitude: 105, latitude: 35, zoom: 5, pitch: 0, bearing: 0 };
      state.view = Object.assign({}, state.view, v);
      deck.setProps({ viewState: state.view });
      return state.view;
    },
    /* 把经纬度投影成屏幕坐标。墨卡托的 x 只跟经度有关、y 只跟纬度有关，
       所以可以拆开算，和原来百度那套 projector() 的接口保持一致。 */
    projector: function () {
      var vps = deck.getViewports ? deck.getViewports() : null;
      if (!vps || !vps.length) { return null; }
      var vp = vps[0];
      var el = container;
      var clat = vp.latitude || 0, clng = vp.longitude || 0;
      return {
        W: el.clientWidth, H: el.clientHeight,
        cx: clng, cy: clat, zoom: vp.zoom,
        x: function (lng) { var q = vp.project([lng, clat]); return q ? q[0] : 0; },
        y: function (lat) { var q = vp.project([clng, lat]); return q ? q[1] : 0; },
        lngAt: function (px) { var q = vp.unproject([px, vp.height / 2]); return q ? q[0] : 0; },
        latAt: function (py) { var q = vp.unproject([vp.width / 2, py]); return q ? q[1] : 0; }
      };
    },
    getViewport: function () { var v = deck.getViewports ? deck.getViewports() : null; return v && v.length ? v[0] : null; },
    pickAt: function (x, y, opts2) { return deck.pickObject(Object.assign({ x: x, y: y, radius: 4 }, opts2 || {})); },
    pickInBox: function (x, y, width, height, layerIds) {
      return deck.pickObjects({ x: x, y: y, width: width, height: height, layerIds: layerIds });
    },
    /* 导出当前地图为 PNG（对应百度那边的 composeMapImage + toDataURL） */
    toDataURL: function () {
      try {
        var cv = deck.getCanvas();
        return cv && cv.toDataURL ? cv.toDataURL('image/png') : null;
      } catch (e) { return null; }
    },
    destroy: function () { try { deck.finalize(); } catch (e) {} }
  };
}
