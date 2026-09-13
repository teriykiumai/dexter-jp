import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineStyle,
  LineSeries,
  createChart,
  type BusinessDay,
  type CandlestickData,
  type HistogramData,
  type ISeriesApi,
} from 'lightweight-charts';
import type { ChartBar, ChartPriceLine } from './presentation.js';
import type { TechnicalCandle, TechnicalInterval } from './technical.js';
import type { EtfRelativeRangeV1 } from '../../analysis/market-data/etf-series.js';

export const LIGHTWEIGHT_CHARTS_NOTICE = [
  'TradingView Lightweight Charts™',
  'Copyright (с) 2025 TradingView, Inc.',
] as const;

export function EtfRelativeChart({ result, describedBy }: {
  result: Extract<EtfRelativeRangeV1, { state: 'available' }>; describedBy: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const style = getComputedStyle(container), color = (token: string) => style.getPropertyValue(token).trim();
    const chart = createChart(container, { width: container.clientWidth, height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: color('--color-chart-background') }, textColor: color('--color-chart-axis'), fontFamily: color('--font-data'), fontSize: 12, attributionLogo: true },
      grid: { vertLines: { color: color('--color-chart-grid') }, horzLines: { color: color('--color-chart-grid') } },
      crosshair: { vertLine: { color: color('--color-chart-crosshair'), labelBackgroundColor: color('--color-chart-axis') },
        horzLine: { color: color('--color-chart-crosshair'), labelBackgroundColor: color('--color-chart-axis') } },
      rightPriceScale: { borderColor: color('--color-chart-grid') }, timeScale: { borderColor: color('--color-chart-grid') },
    });
    for (const ticker of ['1321', '2633'] as const) {
      const line = chart.addSeries(LineSeries, { title: ticker, color: color(ticker === '1321' ? '--color-chart-price' : '--color-chart-rsi'),
        lineStyle: ticker === '1321' ? LineStyle.Solid : LineStyle.Dashed, priceLineVisible: false,
        priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
      line.setData(result.commonDates.map((time, index) => ({ time, value: result[`normalized${ticker}`][index]! })));
    }
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.resize(container.clientWidth, container.clientHeight));
    observer.observe(container);
    return () => { observer.disconnect(); chart.remove(); };
  }, [result]);
  return <div ref={ref} className="price-chart" role="img" aria-label="1321と2633の正規化価格チャート" aria-describedby={describedBy} />;
}

export type ChartOverlay = Pick<ChartPriceLine, 'price' | 'label'> & { colorToken: ChartPriceLine['colorToken'] | '--color-chart-price' };
interface PriceChartProps {
  bars: ChartBar[];
  priceLines: ChartOverlay[];
  describedBy: string;
  technical?: { candles: readonly TechnicalCandle[]; interval: TechnicalInterval;
    unavailableDates: readonly string[];
    sma20?: readonly { date: string; value: number | null }[];
    collapsed: readonly string[]; selectedDate: string | null; onSelect: (date: string) => void };
}

export const CHART_PANE_STRETCH = {
  price: 0.7,
  volume: 0.3,
} as const;

function toBusinessDay(date: string): BusinessDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}
function chronological<T extends { time: BusinessDay }>(rows: T[]): T[] {
  const key = (day: BusinessDay) => day.year * 10000 + day.month * 100 + day.day;
  return rows.sort((a, b) => key(a.time) - key(b.time));
}

export function PriceChart({ bars, priceLines, describedBy, technical }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const selectRef = useRef(technical?.onSelect);
  selectRef.current = technical?.onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    const style = getComputedStyle(container);
    const color = (token: string) => style.getPropertyValue(token).trim();
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 480,
      layout: {
        background: { type: ColorType.Solid, color: color('--color-chart-background') },
        textColor: color('--color-chart-axis'),
        attributionLogo: true,
        fontFamily: color('--font-data'),
        fontSize: 12,
        panes: {
          enableResize: false,
          separatorColor: color('--color-chart-grid'),
          separatorHoverColor: color('--color-chart-grid'),
        },
      },
      grid: {
        vertLines: { color: color('--color-chart-grid') },
        horzLines: { color: color('--color-chart-grid') },
      },
      crosshair: {
        vertLine: { color: color('--color-chart-crosshair'), labelBackgroundColor: color('--color-chart-axis') },
        horzLine: { color: color('--color-chart-crosshair'), labelBackgroundColor: color('--color-chart-axis') },
      },
      rightPriceScale: { borderColor: color('--color-chart-grid') },
      timeScale: {
        borderColor: color('--color-chart-grid'),
        timeVisible: false,
        rightOffset: 3,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: color('--color-chart-up'),
      downColor: color('--color-chart-down'),
      borderVisible: false,
      wickUpColor: color('--color-chart-up'),
      wickDownColor: color('--color-chart-down'),
      priceLineVisible: false,
    });
    chartRef.current = chart;
    const volume = !technical?.collapsed.includes('volume') ? chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      title: '出来高',
    }, 1) : null;
    volume?.priceScale().applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.05 },
    });
    candleSeriesRef.current = candles;
    const [pricePane, volumePane] = chart.panes();
    pricePane?.setStretchFactor(CHART_PANE_STRETCH.price);
    volumePane?.setStretchFactor(CHART_PANE_STRETCH.volume);

    const candleData: CandlestickData<BusinessDay>[] = [];
    const volumeData: HistogramData<BusinessDay>[] = [];
    for (const bar of bars) {
      const time = toBusinessDay(bar.date);
      if (!time) continue;
      candleData.push({
        time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
      if (bar.volume !== null) {
        volumeData.push({
          time,
          value: bar.volume,
          color: color('--color-chart-volume'),
        });
      }
    }
    const gaps = technical?.unavailableDates.map(date => ({ time: toBusinessDay(date)! })) ?? [];
    candles.setData(chronological([...candleData, ...gaps]));
    volume?.setData(volumeData);

    if (technical) {
      if (technical.sma20?.length) {
        const sma = chart.addSeries(LineSeries, { color: color('--color-chart-sma20'), title: 'SMA 20', priceLineVisible: false });
        sma.setData(technical.sma20.map(row => ({ time: toBusinessDay(row.date)!, ...(row.value === null ? {} : { value: row.value }) })));
      }
      let pane = volume ? 2 : 1;
      const addIndicator = (field: 'rsi' | 'macd' | 'signal' | 'histogram', paneIndex: number, token: string) => {
        const series = field === 'histogram'
          ? chart.addSeries(HistogramSeries, { color: color(token), title: field, priceLineVisible: false }, paneIndex)
          : chart.addSeries(LineSeries, { color: color(token), title: field, priceLineVisible: false,
            lineStyle: field === 'signal' ? LineStyle.Dashed : LineStyle.Solid }, paneIndex);
        series.setData(chronological([...technical.candles.map(row => ({ time: toBusinessDay(row.displayDate)!,
          ...(row[field].state === 'available' ? { value: row[field].value } : {}) })), ...gaps]));
      };
      if (!technical.collapsed.includes('rsi')) addIndicator('rsi', pane++, '--color-chart-rsi');
      if (!technical.collapsed.includes('macd')) {
        addIndicator('macd', pane, '--color-chart-macd');
        addIndicator('signal', pane, '--color-chart-signal');
        addIndicator('histogram', pane, '--color-chart-volume');
      }
      chart.panes().forEach((item, index) => item.setStretchFactor(index === 0 ? 4 : 1));
      chart.subscribeCrosshairMove(event => {
        if (!event.time) return;
        const time = event.time;
        const date = typeof time === 'object' ? `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}` : String(time);
        selectRef.current?.(date);
      });
    }

    chart.timeScale().fitContent();
    if (technical && bars.length) {
      const end = bars.at(-1)!.date, from = new Date(`${end}T00:00:00Z`);
      from.setUTCFullYear(from.getUTCFullYear() - (technical.interval === 'day' ? 1 : technical.interval === 'week' ? 3 : 5));
      chart.timeScale().setVisibleRange({ from: toBusinessDay(from.toISOString().slice(0, 10))!, to: toBusinessDay(end)! });
    }
    const resizeObserver = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect;
      if (size?.width && size.height) {
        chart.applyOptions({ width: size.width, height: size.height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      candleSeriesRef.current = null;
      chartRef.current = null;
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [bars, technical?.candles, technical?.interval, technical?.collapsed, technical?.unavailableDates, technical?.sma20]);

  useEffect(() => {
    const selected = technical?.candles.find(row => row.displayDate === technical.selectedDate);
    if (selected && candleSeriesRef.current) chartRef.current?.setCrosshairPosition(
      selected.close, toBusinessDay(selected.displayDate)!, candleSeriesRef.current);
  }, [technical?.selectedDate, technical?.candles, technical?.collapsed]);

  useEffect(() => {
    const candles = candleSeriesRef.current;
    const container = containerRef.current;
    if (!candles || !container) return;
    const style = getComputedStyle(container);

    const handles = priceLines.map(line => candles.createPriceLine({
      price: line.price,
      color: style.getPropertyValue(line.colorToken).trim(),
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: line.label,
    }));

    return () => {
      if (candleSeriesRef.current !== candles) return;
      for (const handle of handles) {
        candles.removePriceLine(handle);
      }
    };
  }, [priceLines, bars, technical?.candles, technical?.interval, technical?.collapsed, technical?.unavailableDates, technical?.sma20]);

  if (bars.length === 0) {
    return <div className="empty-state chart-empty">調整済みOHLCVは利用できません。</div>;
  }

  return (
    <div
      aria-describedby={describedBy}
      aria-label={technical ? '調整後OHLCV・RSI・MACDの同期チャート。正確な値は隣接する表で確認できます。' : '調整後日足ローソク足と日次出来高の同期チャート'}
      className="price-chart"
      ref={containerRef}
      role="img"
    />
  );
}
