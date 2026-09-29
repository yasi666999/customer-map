import { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community';
import './tailwind.css';

ModuleRegistry.registerModules([AllCommunityModule]);

const mtxTheme = themeQuartz.withParams({
  accentColor: '#0071e3',
  backgroundColor: 'transparent',
  borderColor: 'rgba(0,0,0,.06)',
  fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
  fontSize: '11.5px',
  headerHeight: '30px',
  rowHeight: '32px'
});

const short = v => !v ? '·' : v >= 100000000 ? (v / 100000000).toFixed(1) + '亿'
  : v >= 10000 ? Math.round(v / 10000) + '万' : String(v);

/* 格式跟着度量走：比率 → 百分比，人均单量 → 一位小数，金额 → 万/亿，计数 → 千分位。
   以前这里只有 short()，切换到"复购率"时格子里会显示 0.9715… 这种原始小数。 */
function fmtByFormat(v, format) {
  const n = Number(v) || 0;
  if (!n) { return '·'; }
  if (format === 'pct') { return (n * 100).toFixed(1) + '%'; }
  if (format === 'num1') { return n.toFixed(1); }
  if (format === 'money') { return short(n); }
  return Math.round(n).toLocaleString();
}

/** 单元格：背景数据条 + 数值（Power BI 的条件格式） */
function makeBarCell(max, format) {
  return function BarCell(p) {
    const v = p.value || 0;
    const w = max ? Math.round(v / max * 100) : 0;
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex',
        alignItems: 'center', justifyContent: 'center', borderRadius: 5, overflow: 'hidden' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: w + '%', background: 'rgba(0,113,227,.22)' }} />
        <span style={{ position: 'relative', fontVariantNumeric: 'tabular-nums' }}>{fmtByFormat(v, format)}</span>
      </div>
    );
  };
}

function Matrix({ rows, cols, values, rowSum, colSum, total, onPick, format }) {
  const defs = useMemo(() => {
    let max = 0;
    values.forEach(r => r.forEach(v => { if (v > max) { max = v; } }));
    const BarCell = makeBarCell(max, format);
    /** @type {any[]} */
    const out = [{
      headerName: '平台', colId: 'name', field: 'name', pinned: 'left', width: 124,
      cellStyle: { fontWeight: 500 }
    }];
    cols.forEach((c, ci) => {
      out.push({
        headerName: c.label,
        colId: 'c' + ci,                      // 显式指定，点击回调靠它定位
        width: 62,
        valueGetter: p => p.data.v[ci],
        cellRenderer: BarCell,
        cellStyle: { padding: '2px' }
      });
    });
    out.push({
      headerName: '合计', colId: 'rowsum', pinned: 'right', width: 78,
      valueGetter: p => p.data.sum,
      valueFormatter: p => fmtByFormat(p.value, format),
      cellStyle: { fontWeight: 500, textAlign: 'center' }
    });
    return out;
  }, [cols, values, format]);

  const pinnedBottom = useMemo(() => [{
    name: '合计',
    v: cols.map((_, ci) => colSum[ci] || 0),
    sum: total
  }], [cols, colSum, total]);

  return (
    <div style={{ height: Math.min(520, 40 + (rows.length + 1) * 32) + 'px', width: '100%' }}>
      <AgGridReact
        theme={mtxTheme}
        rowData={rows}
        columnDefs={defs}
        pinnedBottomRowData={pinnedBottom}
        defaultColDef={{ sortable: false, resizable: true, suppressHeaderMenuButton: true }}
        headerHeight={30}
        rowHeight={32}
        animateRows={false}
        suppressCellFocus={true}
        onCellClicked={e => {
          const id = e.column.getColId();
          if (!onPick || id === 'name' || id === 'rowsum') { return; }
          const c = cols[Number(id.slice(1))];
          if (c) { onPick(e.data.key, c.key); }
        }}
      />
    </div>
  );
}

const roots = new WeakMap();

export function mountMatrix(el, data, onPick) {
  if (!el) { return; }
  try {
    let r = roots.get(el);
    if (!r) { r = createRoot(el); roots.set(el, r); }
    r.render(<Matrix rows={data.rows} cols={data.cols} values={data.values}
      rowSum={data.rowSum} colSum={data.colSum} total={data.total} onPick={onPick} format={data.format || 'num'} />);
    window.__cmMtxDbg = { rows: data.rows.length, cols: data.cols.length };
  } catch (e) {
    window.__cmMtxDbg = { error: String(e && e.message || e) };
  }
}
