import { createRoot } from 'react-dom/client';

/* 「我的视图」列表 —— React 岛（Power BI 书签的等价物）
   契约（main.js 的事件委托和端到端测试依赖这些，别改）：
     #viewlist .vitem[data-view-id]      点击 = 回到这个视图
     #viewlist .vdel[data-view-del]      点击 = 删除（main.js 里 stopPropagation）
     #viewlist .vname                    视图名（测试断言用）
     #viewlist .vmeta                    条件摘要
     #viewlist .empty                    空状态
   容器 #viewlist 由 React 独占，业务代码不要再写它的 innerHTML。

   样式走设计令牌（--fill / --accent-soft / --accent…），深浅色自动跟随，
   所以这里只做内联的排版微调，不硬编码颜色。 */

const pill = {
  fontStyle: 'normal', fontSize: 10.5, lineHeight: '17px', padding: '0 7px',
  borderRadius: 980, background: 'var(--accent-soft)', color: 'var(--accent)',
  whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums'
};

/** @param {{ items: Array<{ id: string, name: string, tags: string[] }> }} p */
function Views({ items }) {
  if (!items.length) {
    return <div className="empty">还没有保存的视图。调好筛选条件后，在上面起个名字保存。</div>;
  }
  return items.map(v => (
    <div className="vitem" data-view-id={v.id} key={v.id}>
      <span className="vname">{v.name}</span>
      <span className="vmeta" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {v.tags.map((t, i) => <i key={i} style={pill}>{t}</i>)}
      </span>
      <button type="button" className="vdel" data-view-del={v.id} title="删除">×</button>
    </div>
  ));
}

const roots = new WeakMap();

/** @param {HTMLElement|null} el @param {Array<{ id: string, name: string, tags: string[] }>} items */
export function mountViews(el, items) {
  if (!el) { return; }
  try {
    let r = roots.get(el);
    if (!r) { r = createRoot(el); roots.set(el, r); }
    r.render(<Views items={items} />);
    window.__cmViewsDbg = { count: items.length };
  } catch (e) {
    window.__cmViewsDbg = { error: String(e && e.message || e) };
  }
}
