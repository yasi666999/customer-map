/* 外部脚本与调试句柄的类型声明。
   这些全局来自：address-clean.js / geo-data.js / local-geocode.js、
   百度地图 GL、以及本程序自己挂在 window 上的自查句柄。 */

interface Window {
  AddressClean: any;
  GEO_DB: any;
  LocalGeocode: any;
  /** deck.gl 本地打包的经典脚本（vendor/deckgl/deck.gl.min.js） */
  deck: any;
  XLSX: any;
  /** 性能打点（自动化测试用） */
  __phases?: any[];
  __cm?: any;
  __cmMap?: any;
  __cmGeo?: any;
  __cmLayer?: any;
  __cmHeat?: any;
  __cmRegionAgg?: any;
  __cmNameMap?: any;
  __cmEmbedded?: boolean;
  __cmPicks?: any;
  __cmCharts?: any;
  __cmGridDbg?: any;
  __cmMtxDbg?: any;
  __cmViewsDbg?: any;
  /** deck.gl 引擎实例（调试句柄） */
  __cmDeck?: any;
  CN_BOUNDARY_P?: any;
  CN_BOUNDARY_C?: any;
  CN_BOUNDARY_D?: any;
  __cmOpenDetail?: (i: number) => void;
}


/* Vite 的 CSS 副作用导入 */
declare module '*.css';
