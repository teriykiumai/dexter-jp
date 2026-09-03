import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineStyle,
  createChart,
  type BusinessDay,
  type CandlestickData,
  type HistogramData,
  type ISeriesApi,
} from 'lightweight-charts';
import type { ChartBar, ChartPriceLine } from './presentation.js';

export const LIGHTWEIGHT_CHARTS_NOTICE = [
  'TradingView Lightweight Charts™',
  'Copyright (с) 2025 TradingView, Inc.',
] as const;

interface PriceChartProps {
  bars: ChartBar[];
  priceLines: ChartPriceLine[];
  describedBy: string;
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

export function PriceChart({ bars, priceLines, describedBy }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

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
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'right',
      priceLineVisible: false,
      lastValueVisible: false,
      title: '日次出来高',
    }, 1);
    volume.priceScale().applyOptions({
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
    candles.setData(candleData);
    volume.setData(volumeData);

    chart.timeScale().fitContent();
    const resizeObserver = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect;
      if (size?.width && size.height) {
        chart.applyOptions({ width: size.width, height: size.height });
      }
    });
    resizeObserver.observe(container);

    return () => {
      candleSeriesRef.current = null;
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [bars]);

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
  }, [priceLines]);

  if (bars.length === 0) {
    return <div className="empty-state chart-empty">調整済みOHLCVは利用できません。</div>;
  }

  return (
    <div
      aria-describedby={describedBy}
      aria-label="調整後日足ローソク足と日次出来高の同期チャート"
      className="price-chart"
      ref={containerRef}
      role="img"
    />
  );
}
