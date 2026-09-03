import { useId } from 'react';
import { Value } from './primitives.js';
import type { DashboardViewModel, DisplayValue } from './presentation.js';

type PeerRadarView = NonNullable<DashboardViewModel['peer']>;

const SVG_SIZE = 280;
const SVG_CENTER = SVG_SIZE / 2;
const RADAR_RADIUS = 88;
const LABEL_RADIUS = 116;

function point(index: number, value: number, count: number, radius = RADAR_RADIUS): [number, number] {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return [
    SVG_CENTER + Math.cos(angle) * radius * value,
    SVG_CENTER + Math.sin(angle) * radius * value,
  ];
}

function pointList(values: readonly number[], radius = RADAR_RADIUS): string {
  return values.map((value, index) => point(index, value, values.length, radius).join(','))
    .join(' ');
}

function RadarValue({ value }: { value: DisplayValue }) {
  return <Value value={value} kind="data" />;
}

export function PeerRadarPresentation({ peer }: { peer: PeerRadarView }) {
  const titleId = useId();
  const descriptionId = useId();
  const axisCount = peer.rows.length;
  const fullScale = Array.from({ length: axisCount }, () => 1);
  const marketCapLimitation = `時価総額priority: ${peer.marketCapPriority.text}${
    peer.marketCapPriorityReason ? ` — ${peer.marketCapPriorityReason}` : ''
  }`;

  return (
    <>
      <dl aria-label="Peer Radarの選定状態" className="peer-radar-meta">
        <div><dt>選定Peer数</dt><dd><span className="design-data">{peer.selectedPeerCount}</span> 社</dd></div>
        <div><dt>tooFewPeers</dt><dd>{String(peer.tooFewPeers)}</dd></div>
        <div>
          <dt>選定状態</dt>
          <dd className={peer.selectionState === 'available' ? undefined : 'unavailable'}>
            {peer.selectionStateText}
          </dd>
        </div>
        <div><dt>時価総額priority</dt><dd><Value value={peer.marketCapPriority} /></dd></div>
      </dl>

      <figure className="peer-radar-figure">
        <svg
          aria-labelledby={`${titleId} ${descriptionId}`}
          className="peer-radar-chart"
          focusable="false"
          role="img"
          viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        >
          <title id={titleId}>保存済みPeer percentileのRadar</title>
          <desc id={descriptionId}>
            7指標の保存済みdirection-normalized percentileです。正確な値と利用状態は直後の表を確認してください。
          </desc>
          <g aria-hidden="true">
            {[0.25, 0.5, 0.75, 1].map(scale => (
              <polygon
                className="peer-radar-grid"
                key={scale}
                points={pointList(fullScale, RADAR_RADIUS * scale)}
              />
            ))}
            {peer.rows.map((row, index) => {
              const [x, y] = point(index, 1, axisCount);
              return (
                <line
                  className="peer-radar-axis"
                  key={row.metric}
                  x1={SVG_CENTER}
                  x2={x}
                  y1={SVG_CENTER}
                  y2={y}
                />
              );
            })}
            {peer.polygonPercentiles ? (
              <polygon
                className="peer-radar-polygon"
                data-peer-radar-polygon="visible"
                points={pointList(peer.polygonPercentiles)}
              />
            ) : null}
            {peer.rows.map((row, index) => {
              const [x, y] = point(index, 1, axisCount, LABEL_RADIUS);
              return <text key={row.metric} textAnchor="middle" x={x} y={y}>{row.label}</text>;
            })}
          </g>
        </svg>
        {peer.polygonPercentiles ? null : (
          <p className="peer-radar-unavailable" role="status">
            保存済みPeer状態に不足または不整合があるためpolygonを表示しません。正確な状態は表を確認してください。
          </p>
        )}
        <figcaption>
          {marketCapLimitation}。色は良否を表しません。正確な値は下の表を参照してください。
        </figcaption>
      </figure>

      <div
        aria-label="Peer Radarの正確な値"
        className="table-scroll peer-radar-table-region"
        role="region"
        tabIndex={0}
      >
        <p className="peer-radar-table-limitation">{marketCapLimitation}</p>
        <table className="peer-radar-table">
          <caption className="visually-hidden">Peer Radarの保存済み値と検証状態</caption>
          <thead>
            <tr>
              <th>指標</th>
              <th className="numeric-cell">対象企業</th>
              <th className="numeric-cell">同業中央値</th>
              <th className="numeric-cell">順位</th>
              <th className="numeric-cell">パーセンタイル (保存値 / %)</th>
              <th className="numeric-cell">有効Peer数</th>
              <th>方向</th>
              <th>データ基準日</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {peer.rows.map(row => (
              <tr data-radar-state={row.state} key={row.metric}>
                <th>{row.label}</th>
                <td className="numeric-cell"><RadarValue value={row.target} /></td>
                <td className="numeric-cell"><RadarValue value={row.median} /></td>
                <td className="numeric-cell"><RadarValue value={row.rank} /></td>
                <td className="numeric-cell"><RadarValue value={row.percentile} /></td>
                <td className="numeric-cell"><Value value={row.sampleSize} /></td>
                <td>{row.direction}</td>
                <td><RadarValue value={row.dataDate} /></td>
                <td className={row.state === 'available' ? undefined : 'unavailable'}>{row.stateText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
