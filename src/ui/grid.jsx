import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community';
import './tailwind.css';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  accentColor: '#0071e3',
  backgroundColor: 'transparent',
  borderColor: 'rgba(0,0,0,.08)',
  fontFamily: '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
  fontSize: '12.5px',
  headerHeight: '34px',
  rowHeight: '46px'
});

const QUALITY_COLOR = {
  custom: '#1a9c63', town: '#2f6fed', district: '#f59e0b',
  city: '#94a3b8', province: '#cbd5e1', unknown: '#9aa3af'
};

function QualityCell(p) {
  const color = QUALITY_COLOR[p.data.q] || QUALITY_COLOR.unknown;
  const ring = ['district', 'city', 'province'].indexOf(p.data.q) >= 0;
  return (
    <span style={{
      display: 'inline-block', fontSize: 11, padding: '1px 8px', borderRadius: 980,
      color: ring ? color : '#fff', border: ring ? '1.5px solid ' + color : '0',
      background: ring ? 'transparent' : color, whiteSpace: 'nowrap'
    }}>{p.data.badge}</span>
  );
}

function NameCell(p) {
  return (
    <div style={{ lineHeight: 1.35, overflow: 'hidden' }}>
      <div style={{ fontWeight: 500, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.data.name}</div>
      <div style={{ fontSize: 11, color: '#8e8e93', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{p.data.addr}</div>
    </div>
  );
}

const COLS = [
  { headerName: '地址', field: 'name', cellRenderer: NameCell, flex: 3, minWidth: 240, sortable: true, filter: true },
  { headerName: '精度', field: 'badge', cellRenderer: QualityCell, width: 116, sortable: true, filter: true },
  { headerName: '客户数', field: 'count', width: 96, sortable: true, type: 'numericColumn',
    valueFormatter: p => p.value ? Number(p.value).toLocaleString() : '—' },
  { headerName: '平台', field: 'plat', width: 120, sortable: true, filter: true },
  { headerName: '时间', field: 'time', width: 104, sortable: true },
  { headerName: '距离', field: 'dist', width: 96, sortable: true, type: 'numericColumn',
    valueFormatter: p => p.value == null ? '—' : p.value.toFixed(1) + ' km' },
  { headerName: '编号', field: 'id', width: 120, sortable: true }
];

function Grid({ rows, onPick, apiRef, total }) {
  const [quick, setQuick] = useState('');
  const shown = useMemo(() => {
    if (!quick.trim()) { return rows; }
    const q = quick.trim().toLowerCase();
    return rows.filter(r => (r.name + ' ' + r.addr + ' ' + r.plat + ' ' + r.id).toLowerCase().indexOf(q) >= 0);
  }, [rows, quick]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(0,0,0,.08)', flex: 'none' }}>
        <input value={quick} onChange={e => setQuick(e.target.value)}
          placeholder="在结果里搜地址 / 平台 / 编号"
          style={{ height: 28, flex: 1, minWidth: 200, borderRadius: 980, border: '1px solid rgba(0,0,0,.12)',
            background: '#fff', padding: '0 12px', fontSize: 12, outline: 'none' }} />
        <span style={{ fontSize: 11, color: '#8e8e93', fontVariantNumeric: 'tabular-nums' }}>
          {shown.length.toLocaleString()} 行{total > rows.length ? '（共 ' + total.toLocaleString() + ' 条，表格只载入前 ' + rows.length.toLocaleString() + ' 条）' : ''}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgGridReact ref={apiRef} theme={gridTheme} rowData={shown} columnDefs={COLS}
          defaultColDef={{ resizable: true, suppressHeaderMenuButton: true }}
          rowHeight={46} headerHeight={34} animateRows={false} rowBuffer={8}
          onRowClicked={e => { if (e.data && onPick) { onPick(e.data.idx); } }}
          getRowId={p => String(p.data.idx)} />
      </div>
    </div>
  );
}

const roots = new WeakMap();
let apiHolder = null;

export function mountGrid(el, rows, onPick, total) {
  try {
    if (!el) { return; }
    if (!apiHolder) { apiHolder = { current: null }; }
    let r = roots.get(el);
    if (!r) { r = createRoot(el); roots.set(el, r); }
    r.render(<Grid rows={rows} onPick={onPick} apiRef={apiHolder} total={total} />);
    window.__cmGridDbg = { rows: rows.length, total: total };
  } catch (e) {
    window.__cmGridDbg = { error: String(e && e.message || e) };
  }
}

export function gridSelectRow(idx) {
  const api = apiHolder && apiHolder.current;
  if (!api) { return false; }
  try {
    const node = api.getRowNode(String(idx));
    if (!node) { return false; }
    api.ensureNodeVisible(node, 'middle');
    api.deselectAll();
    node.setSelected(true);
    return true;
  } catch (e) { return false; }
}
