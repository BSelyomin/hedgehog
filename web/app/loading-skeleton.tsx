import type { ReactNode } from 'react';

export type SkeletonLayout = 'rows' | 'summary' | 'detail' | 'chart' | 'compact';
const Line = ({ className = '' }: { className?: string }) => <div className={`skeleton-line ${className}`}/>;

/** Placeholders describe layout only; they never stand in for sourced numbers. */
export function LoadingSkeleton({ layout = 'rows', label = 'Loading your data' }: { layout?: SkeletonLayout; label?: string }) {
    let content: ReactNode;
    if (layout === 'chart') content = <div className="skeleton-chart"><Line className="skeleton-title"/><div className="skeleton-plot"/><Line className="skeleton-text"/></div>;
    else if (layout === 'compact') content = <div className="skeleton-compact"><Line className="skeleton-title"/><Line/><Line className="skeleton-label"/></div>;
    else content = <>
        {layout === 'summary' && <div className="skeleton-stats">{Array.from({ length: 3 }, (_, i) => <div className="card" key={i}><Line className="skeleton-title"/><Line className="skeleton-score"/></div>)}</div>}
        <div className={`skeleton-rows${layout === 'detail' ? ' skeleton-detail' : ''}`}>{Array.from({ length: layout === 'detail' ? 2 : 4 }, (_, i) => <div className="card skeleton-row" key={i}>
            <div><Line className="skeleton-title"/><Line className="skeleton-text"/><Line className="skeleton-label"/></div>
            <div><Line className="skeleton-score"/><Line className="skeleton-label"/></div>
        </div>)}</div>
    </>;
    return <div className={`loading-skeleton loading-skeleton-${layout}`} role="status" aria-label={label} aria-busy="true">
        <span className="skeleton-accessible-label">{label}…</span><div aria-hidden="true">{content}</div>
    </div>;
}
