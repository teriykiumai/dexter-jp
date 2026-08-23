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
} from 'lightweight-charts';
import type { ChartBar, ChartPriceLine } from './presentation.js';

interface PriceChartProps {
  bars: ChartBar[];
  priceLines: ChartPriceLine[];
}

function toBusinessDay(date: string): BusinessDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function PriceChart({ bars, priceLines }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || bars.length === 0) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 480,
      layout: {
        background: { type: ColorType.Solid, color: '#10151c' },
        textColor: '#8e9baa',
        attributionLogo: true,
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
      priceScaleId: '',
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });

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

    for (const line of priceLines) {
      candles.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.label,
      });
    }

    chart.timeScale().fitContent();
    const resizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width;
      if (width) chart.applyOptions({ width });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [bars, priceLines]);

  if (bars.length === 0) {
    return <div className="empty-state chart-empty">調整済みOHLCVは利用できません。</div>;
  }

  return <div className="price-chart" ref={containerRef} aria-label="調整済み株価チャート" />;
}
