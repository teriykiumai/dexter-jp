import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';

export type TrendOverlay = { id: string; time: string; price: number; endTime: string; endPrice: number };
export type TrendEditor = Omit<TrendOverlay, 'id'> & { label?: 'Trendline' | 'Fibonacci'; dates: readonly string[];
  onChange: (point: 'start' | 'end', time: string, price: number) => void };
type Point = { x: number; y: number };
type Drag = { point: 'start' | 'end'; time: string; price: number; pointer: number };
function dateString(time: Time | null): string | null {
  if (time === null || typeof time === 'number') return null;
  return typeof time === 'string' ? time : `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}
export function TrendEndpoints({ chart, series, editor }: { chart: IChartApi; series: ISeriesApi<'Candlestick'>; editor: TrendEditor }) {
  const [points, setPoints] = useState<{ start: Point | null; end: Point | null; width: number; height: number }>({ start: null, end: null, width: 0, height: 0 });
  const [drag, setDrag] = useState<Drag | null>(null), dragRef = useRef<Drag | null>(null);
  const editorRef = useRef(editor); editorRef.current = editor;
  const changeDrag = (value: Drag | null) => { dragRef.current = value; setDrag(value); };
  useEffect(() => {
    let frame = 0;
    const update = () => {
      const e = editorRef.current, d = dragRef.current;
      const point = (which: 'start' | 'end') => {
        const time = d?.point === which ? d.time : which === 'start' ? e.time : e.endTime;
        const price = d?.point === which ? d.price : which === 'start' ? e.price : e.endPrice;
        if (!e.dates.includes(time) || !Number.isFinite(price) || price <= 0) return null;
        const x = chart.timeScale().timeToCoordinate(time), y = series.priceToCoordinate(price);
        return x === null || y === null ? null : { x: Number(x), y: Number(y) };
      };
      const value = { start: point('start'), end: point('end'), width: chart.timeScale().width(), height: chart.panes()[0]?.getHeight() ?? 0 };
      setPoints(old => JSON.stringify(old) === JSON.stringify(value) ? old : value);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [chart, series]);
  const valid = (point: 'start' | 'end', time: string, price: number) => editor.dates.includes(time) && Number.isFinite(price) && price > 0
    && (point === 'start' ? time < editor.endTime : time > editor.time);
  return <svg className="drawing-endpoints" width={points.width} height={points.height} aria-label={`${editor.label ?? 'Trendline'}端点編集`}>
    {points.start && points.end ? <line className="drawing-segment" x1={points.start.x} y1={points.start.y} x2={points.end.x} y2={points.end.y} /> : null}
    {(['start', 'end'] as const).map(which => {
      const point = points[which]; if (!point) return null;
      return <g key={which}>
        <circle className="drawing-handle-visible" cx={point.x} cy={point.y} r="6" />
        <circle className="drawing-handle" cx={point.x} cy={point.y} r="22" tabIndex={0} role="button"
          aria-label={`${editor.label ?? 'Trendline'}${which === 'start' ? '始点' : '終点'}を移動`}
          onPointerDown={event => { if (event.button !== 0 || dragRef.current) return; event.preventDefault(); event.stopPropagation();
            event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
            changeDrag({ point: which, time: which === 'start' ? editor.time : editor.endTime,
              price: which === 'start' ? editor.price : editor.endPrice, pointer: event.pointerId }); }}
          onPointerMove={event => {
            const current = dragRef.current; if (!current || current.pointer !== event.pointerId) return;
            const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
            if (x < 0 || x > points.width || y < 0 || y > points.height) return;
            const time = dateString(chart.timeScale().coordinateToTime(x)), price = series.coordinateToPrice(y);
            if (time && price !== null && valid(which, time, price)) changeDrag({ ...current, time, price: Math.round(price * 1e8) / 1e8 });
          }}
          onPointerUp={event => { const current = dragRef.current; if (!current || current.pointer !== event.pointerId) return;
            changeDrag(null); event.currentTarget.releasePointerCapture(event.pointerId);
            if (valid(which, current.time, current.price)) editor.onChange(which, current.time, current.price); }}
          onPointerCancel={() => changeDrag(null)} onLostPointerCapture={() => changeDrag(null)}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); changeDrag(null); return; }
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || drag) return;
            event.preventDefault(); const time = which === 'start' ? editor.time : editor.endTime, price = which === 'start' ? editor.price : editor.endPrice;
            const nextTime = editor.dates[editor.dates.indexOf(time) + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0)];
            const nextPrice = price + (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0) * (event.shiftKey ? 10 : 1);
            if (nextTime && valid(which, nextTime, nextPrice)) editor.onChange(which, nextTime, nextPrice);
          }} />
      </g>;
    })}
  </svg>;
}
