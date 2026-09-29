import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn 风格的 cn 工具 */
export function cn(...inputs) { return twMerge(clsx(inputs)); }

/** 基础卡片：和 shadcn 的 Card 同构，只是换成 Tailwind 类 */
export function Card({ className, ...props }) {
  return <div className={cn('rounded-[14px] border border-black/[.08] bg-white p-4', className)} {...props} />;
}

/** KPI 卡：数值 + 标签 + 可选涨跌 */
export function StatCard({ value, label, delta, deltaLabel, hint, className }) {
  const up = typeof delta === 'number' && delta >= 0;
  return (
    <Card className={cn('kpi flex flex-col gap-1', className)} title={hint || undefined}>
      <b className="text-[24px] font-semibold tracking-tight tabular-nums">{value}</b>
      <span className="text-[11.5px] text-[var(--color-muted)]">
        {label}
        {hint && <span className="kpi-hint" aria-hidden="true">?</span>}
        {typeof delta === 'number' && (
          <i className={cn('mom-tag ml-1 not-italic font-medium tabular-nums', up ? 'up text-emerald-600' : 'down text-red-500')}>
            {up ? '+' : ''}{delta.toFixed(1)}%
          </i>
        )}
      </span>
      {deltaLabel && <span className="text-[10.5px] text-[var(--color-muted)]">{deltaLabel}</span>}
    </Card>
  );
}
