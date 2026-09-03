import type { ComponentPropsWithRef, ReactNode } from 'react';
import {
  DASHBOARD_GLOSSARY,
  type DashboardGlossaryTermId,
} from './glossary.js';
import type {
  DashboardAvailabilityCount,
  DashboardMetric,
  DisplayValue,
} from './presentation.js';

/** Opt-in migration boundary, not a user-selectable theme. */
export function DashboardDesign({ children }: { children: ReactNode }) {
  return <div className="dashboard-design">{children}</div>;
}

export type ValueKind = 'text' | 'data';
export type MetricGridItem = DashboardMetric & { valueKind?: ValueKind };

export function Value({ value, kind = 'text' }: { value: DisplayValue; kind?: ValueKind }) {
  return (
    <span
      className={value.available ? 'design-value' : 'design-value unavailable'}
      data-kind={value.available ? kind : 'text'}
    >
      {value.text}
    </span>
  );
}

export type OpenGlossary = (
  term: DashboardGlossaryTermId,
  invoker: HTMLButtonElement,
) => void;

export function GuidanceButton({ term, onOpen }: {
  term: DashboardGlossaryTermId;
  onOpen: OpenGlossary;
}) {
  const entry = DASHBOARD_GLOSSARY[term];
  return (
    <button
      aria-label={`${entry.label}の説明を開く`}
      className="guidance-button"
      onClick={event => onOpen(term, event.currentTarget)}
      type="button"
    >
      ?
    </button>
  );
}

export function Card({
  title,
  eyebrow,
  children,
  className = '',
  guidanceTerm,
  onOpenGuidance,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  guidanceTerm?: DashboardGlossaryTermId;
  onOpenGuidance?: OpenGlossary;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <div className="panel-title-line">
          <h2>{title}</h2>
          {guidanceTerm && onOpenGuidance
            ? <GuidanceButton term={guidanceTerm} onOpen={onOpenGuidance} />
            : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export function MetricGrid({ metrics, guidance = {}, onOpenGuidance }: {
  metrics: MetricGridItem[];
  guidance?: Readonly<Record<string, DashboardGlossaryTermId>>;
  onOpenGuidance?: OpenGlossary;
}) {
  return (
    <dl className="metric-grid">
      {metrics.map(metric => {
        const term = guidance[metric.label];
        return (
          <div className="metric-row" key={metric.label}>
            <dt>
              <span>{metric.label}</span>
              {term && onOpenGuidance
                ? <GuidanceButton term={term} onOpen={onOpenGuidance} />
                : null}
            </dt>
            <dd><Value value={metric.value} kind={metric.valueKind} /></dd>
            {metric.note ? <small>{metric.note}</small> : null}
          </div>
        );
      })}
    </dl>
  );
}

export function AvailabilityBadges({ counts, compact = false }: {
  counts: DashboardAvailabilityCount;
  compact?: boolean;
}) {
  if (counts.unavailable === 0 && counts.uncollected === 0) return null;
  return (
    <span className={compact ? 'availability-badges compact' : 'availability-badges'}>
      {counts.unavailable > 0 ? (
        <span className="availability-badge unavailable-count">
          利用不可 {counts.unavailable}
        </span>
      ) : null}
      {counts.uncollected > 0 ? (
        <span className="availability-badge uncollected-count">
          未収集 {counts.uncollected}
        </span>
      ) : null}
    </span>
  );
}

export function Button({
  variant = 'secondary',
  compact = false,
  className = '',
  type = 'button',
  ...props
}: ComponentPropsWithRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'destructive';
  compact?: boolean;
}) {
  return (
    <button
      {...props}
      className={`design-button ${className}`.trim()}
      data-variant={variant}
      data-compact={compact ? 'true' : undefined}
      type={type}
    />
  );
}

export type StatusTone = 'neutral' | 'success' | 'warning' | 'error' | 'unavailable';

export function StatusBadge({ label, tone = 'neutral' }: {
  label: string;
  tone?: StatusTone;
}) {
  return <span className="design-badge" data-tone={tone}>{label}</span>;
}

export function StatusNotice({ title, tone, children, role }: {
  title: string;
  tone: StatusTone;
  children: ReactNode;
  role?: 'status' | 'alert';
}) {
  return (
    <div className="design-notice" data-tone={tone} role={role}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function TableScroll({ label, children }: {
  label: string;
  children: ReactNode;
}) {
  return <div aria-label={label} className="table-scroll" role="region" tabIndex={0}>{children}</div>;
}
