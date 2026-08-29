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

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 480,
      layout: {
        background: { type: ColorType.Solid, color: '#10151c' },
        textColor: '#8e9baa',
        attributionLogo: true,
        panes: {
          enableResize: false,
          separatorColor: '#2b3a49',
          separatorHoverColor: '#2b3a49',
        },
      },
      grid: {
        vertLines: { color: '#1c2733' },
        horzLines: { color: '#1c2733' },
      },
      crosshair: {
        vertLine: { color: '#6686a3', labelBackgroundColor: '#24384a' },
        horzLine: { color: '#6686a3', labelBackgroundColor: '#24384a' },
      },
      rightPriceScale: { borderColor: '#2b3a49' },
      timeScale: {
        borderColor: '#2b3a49',
        timeVisible: false,
        rightOffset: 3,
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#34c99a',
      downColor: '#ef6a74',
      borderVisible: false,
      wickUpColor: '#34c99a',
      wickDownColor: '#ef6a74',
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
          color: bar.close >= bar.open ? '#34c99a55' : '#ef6a7455',
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
    if (!candles) return;

    const handles = priceLines.map(line => candles.createPriceLine({
      price: line.price,
      color: line.color,
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
