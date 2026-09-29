import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { StatCard, cn } from './card.jsx';
import './tailwind.css';

import { PieChart } from 'echarts/charts';
echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const roots = new WeakMap();

/** 已经挂过 React 的容器不重复 createRoot，否则会报错 */
function getRoot(el) {
  let r = roots.get(el);
  if (!r) { r = createRoot(el); roots.set(el, r); }
  return r;
}

/** KPI 行：用 React + Tailwind + shadcn 风格卡片渲染 */
export function KpiRow({ items, className = '' }) {
  // 用 Fragment：卡片直接成为 .kpis 容器的子元素，沿用现有的网格样式
  return (
    <>
      {items.map((it, i) => <StatCard key={i} {...it} />)}
    </>
  );
}

/** 时间趋势：ECharts 渲染（替代手写 SVG） */
function TrendChart({ items, kind, onPick }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) { return; }
    if (!inst.current) { inst.current = echarts.init(ref.current, null, { renderer: 'canvas' }); }
    const chart = inst.current;
    window.__cmCharts = window.__cmCharts || {};
    window.__cmCharts['trend-' + kind] = chart;
    chart.setOption({
      animation: false,
      grid: { left: 52, right: 14, top: 16, bottom: 30 },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: v => Number(v).toLocaleString() },
      xAxis: {
        type: 'category',
        data: items.map(d => d.label),
        axisLine: { lineStyle: { color: 'rgba(128,128,128,.35)' } },
        axisLabel: { color: '#8e8e93', fontSize: 11 }
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } },
        axisLabel: { color: '#8e8e93', fontSize: 11, formatter: v => v >= 10000 ? (v / 10000) + '万' : v }
      },
      series: [{
        type: kind === 'line' || kind === 'area' ? 'line' : 'bar',
        data: items.map(d => d.v),
        areaStyle: kind === 'area' ? { opacity: 0.16 } : undefined,
        smooth: false,
        symbolSize: 6,
        itemStyle: { color: '#0071e3', borderRadius: kind === 'bar' ? [3, 3, 0, 0] : 0 },
        barMaxWidth: 26
      }]
    }, true);
    chart.off('click');
    chart.on('click', p => {
      const it = items[p.dataIndex];
      if (it && it.click != null && it.click !== '' && onPick) { onPick(it.click); }
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [items, kind, onPick]);
  return <div ref={ref} className="h-[220px] w-full" />;
}

/** 通用图表：柱状 / 横向条形 / 折线 / 面积 / 饼图 / 环形，都走 ECharts */
function Chart({ items, kind, height, onPick, name }) {
  const ref = useRef(null);
  const inst = useRef(null);
  useEffect(() => {
    if (!ref.current) { return; }
    if (!inst.current) { inst.current = echarts.init(ref.current, null, { renderer: 'canvas' }); }
    const chart = inst.current;
    /* 排障/自动化用：把每张卡的 ECharts 实例按卡片 id 挂出来（图表是 canvas，DOM 里读不到数据） */
    window.__cmCharts = window.__cmCharts || {};
    if (name) { window.__cmCharts[name] = chart; }
    const labels = items.map(d => d.label);
    const values = items.map(d => d.v);
    const isPie = kind === 'pie' || kind === 'donut';
    const isH = kind === 'hbar';
    const isLine = kind === 'line' || kind === 'area';
    const isPareto = kind === 'pareto';     // 帕累托：柱子 + 累计占比线（找头部那几家）
    const isCum = kind === 'cumulative';    // 累计：把趋势累加起来看总量什么时候到齐
    const short = v => v >= 100000000 ? (v / 100000000).toFixed(1) + '亿'
      : v >= 10000 ? Math.round(v / 10000) + '万' : String(v);
    const opt = isPie ? {
      animation: false,
      tooltip: { trigger: 'item', confine: true, valueFormatter: v => Number(v).toLocaleString() },
      legend: {
        type: 'scroll', orient: 'vertical', right: 4, top: 'middle', itemWidth: 9, itemHeight: 9,
        textStyle: { fontSize: 11, color: '#8e8e93' },
        formatter: n => n.length > 8 ? n.slice(0, 7) + '…' : n
      },
      series: [{
        type: 'pie', radius: kind === 'donut' ? ['45%', '72%'] : '72%', center: ['38%', '50%'],
        data: items.map((d, i) => ({ name: d.label, value: d.v })),
        label: { show: false }, labelLine: { show: false },
        itemStyle: { borderWidth: 1, borderColor: 'rgba(255,255,255,.6)' }
      }]
    } : {
      animation: false,
      grid: isH ? { left: 96, right: 64, top: 10, bottom: 10 }
        : { left: 56, right: 14, top: 16, bottom: 34, containLabel: false },
      tooltip: { trigger: 'axis', confine: true, valueFormatter: v => Number(v).toLocaleString() },
      xAxis: isH ? { type: 'value', splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } },
        axisLabel: { color: '#8e8e93', fontSize: 11, formatter: short } }
        : { type: 'category', data: labels, axisLine: { lineStyle: { color: 'rgba(128,128,128,.35)' } },
            axisLabel: { color: '#8e8e93', fontSize: 11, interval: 0,
              formatter: n => n.length > 6 ? n.slice(0, 5) + '…' : n } },
      /* 帕累托要双轴：左轴数量、右轴累计占比 */
      yAxis: isPareto ? [
        { type: 'value', splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } },
          axisLabel: { color: '#8e8e93', fontSize: 11, formatter: short } },
        { type: 'value', max: 100, splitLine: { show: false },
          axisLabel: { color: '#8e8e93', fontSize: 11, formatter: '{value}%' } }
      ] : (isH ? { type: 'category', data: labels, inverse: true,
        axisLine: { lineStyle: { color: 'rgba(128,128,128,.35)' } },
        axisLabel: { color: '#8e8e93', fontSize: 11,
          formatter: n => n.length > 9 ? n.slice(0, 8) + '…' : n } }
        : { type: 'value', splitLine: { lineStyle: { color: 'rgba(128,128,128,.16)' } },
            axisLabel: { color: '#8e8e93', fontSize: 11, formatter: short } }),
      series: isPareto ? (() => {
        const total = values.reduce((a, b) => a + b, 0) || 1;
        let acc = 0;
        const cum = values.map(v => { acc += v; return +(acc / total * 100).toFixed(1); });
        return [
          { type: 'bar', data: values, barMaxWidth: 26,
            itemStyle: { color: '#0071e3', borderRadius: [3, 3, 0, 0] } },
          { type: 'line', yAxisIndex: 1, data: cum, symbolSize: 5, smooth: false,
            lineStyle: { color: '#ff9500', width: 2 }, itemStyle: { color: '#ff9500' },
            tooltip: { valueFormatter: v => v + '%' } }
        ];
      })() : [{
        type: isLine || isCum ? 'line' : 'bar',
        data: isCum ? (() => { let a = 0; return values.map(v => (a += v)); })() : values,
        areaStyle: (kind === 'area' || isCum) ? { opacity: 0.16 } : undefined,
        symbolSize: 6,
        itemStyle: { color: '#0071e3', borderRadius: (isLine || isH || isCum) ? 0 : [3, 3, 0, 0] },
        barMaxWidth: 26,
        label: isH ? { show: true, position: 'right', fontSize: 11, color: '#8e8e93', formatter: p => short(p.value) } : undefined
      }]
    };
    chart.setOption(opt, true);
    // 点图形回传出去，恢复"点一下筛选"的联动
    chart.off('click');
    chart.on('click', p => {
      const idx = isPie ? items.findIndex(d => d.label === p.name) : p.dataIndex;
      const it = items[idx];
      if (it && it.click != null && it.click !== '' && onPick) { onPick(it.click); }
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [items, kind]);
  return <div ref={ref} style={{ height: (height || 220) + 'px', width: '100%' }} />;
}

export function mountChart(el, items, kind, height, onPick, name) {
  if (!el) { return; }
  getRoot(el).render(<Chart items={items} kind={kind} height={height} onPick={onPick} name={name} />);
}

/** 对外：把 React 岛挂到指定 DOM 节点 */
export function mountKpi(el, items) {
  if (!el) { return; }
  getRoot(el).render(<KpiRow items={items} />);
}
export function mountTrend(el, items, kind, onPick) {
  if (!el) { return; }
  getRoot(el).render(<TrendChart items={items} kind={kind} onPick={onPick} />);
}
/* 最小复现（诊断用）：验证"React 渲染完，容器被 innerHTML 清空，再渲染"会发生什么 */
export function reproWipe(hostSel) {
  const host = document.querySelector(hostSel);
  if (!host) { return { err: 'no host' }; }
  const d = document.createElement('div');
  host.appendChild(d);
  const r = createRoot(d);
  r.render(<span id="repro-a">A</span>);
  const afterFirst = host.innerHTML.length;
  host.innerHTML = '';           // 模拟现有代码：每次重绘都清空容器
  r.render(<span id="repro-b">B</span>);
  return { afterFirst, afterWipe: host.innerHTML.length, hasB: !!host.querySelector('#repro-b') };
}

export function unmountIsland(el) {
  const r = roots.get(el);
  if (r) { r.unmount(); roots.delete(el); }
}
