import {
  AvailabilityBadges,
  Button,
  Card,
  DashboardDesign,
  MetricGrid,
  StatusBadge,
  StatusNotice,
  TableScroll,
  Value,
  type MetricGridItem,
  type StatusTone,
} from './primitives.js';

export const PRIMITIVE_METRICS: MetricGridItem[] = [
  { label: '出来高', value: { text: '0', available: true }, valueKind: 'data', note: 'データ基準日 2026-08-21 / 合成fixture / 株' },
  { label: 'PER', value: { text: '利用不可', available: false }, valueKind: 'data', note: '保存された値が利用できません。' },
  { label: '未収集の指標', value: { text: '未収集', available: false } },
  { label: '長い識別子', value: { text: 'snapshot_20260821T010203000Z_very_long_identity_for_wrapping', available: true }, valueKind: 'data' },
  { label: 'データ基準日', value: { text: '2026-08-21', available: true }, valueKind: 'data' },
  { label: '状態', value: { text: '保存済み', available: true } },
];

export const PRIMITIVE_STATUSES: ReadonlyArray<{ tone: StatusTone; label: string }> = [
  { tone: 'neutral', label: '保存済み' },
  { tone: 'success', label: '読込完了' },
  { tone: 'warning', label: '一部利用不可' },
  { tone: 'error', label: '読込エラー' },
  { tone: 'unavailable', label: '未収集' },
];

// Test-only composition: no public route, API, external asset, or data calculation.
export function PrimitivesFixture() {
  return (
    <DashboardDesign>
      <main className="design-content design-stack">
        <header className="design-stack">
          <p className="eyebrow">デザイントークンと共通部品</p>
          <h1>保存済み分析の基本部品</h1>
          <p>合成データで表示を確認しています。外部通信や金融計算は行いません。</p>
          <p className="design-metadata">
            データ基準日 <time className="design-metadata" data-kind="data" dateTime="2026-08-21">2026-08-21</time>
          </p>
        </header>
        <Card title="指標と利用状況" eyebrow="Snapshot" guidanceTerm="rsi" onOpenGuidance={() => {}}>
          <div className="design-stack">
            <MetricGrid metrics={PRIMITIVE_METRICS} />
            <AvailabilityBadges counts={{ unavailable: 1, uncollected: 2 }} />
            <AvailabilityBadges compact counts={{ unavailable: 1, uncollected: 2 }} />
            <div className="design-actions">
              {PRIMITIVE_STATUSES.map(status => <StatusBadge key={status.tone} {...status} />)}
            </div>
          </div>
        </Card>
        <Card title="操作の基本形">
          <div className="design-stack">
            <form className="design-actions" aria-label="操作の確認">
              <Button variant="primary">保存済みデータを読む</Button>
              <Button>閉じる</Button>
              <Button variant="quiet">詳細</Button>
              <Button variant="destructive">実行を中止</Button>
              <Button disabled variant="primary">実行できません</Button>
              <Button compact>コンパクト</Button>
            </form>
            <StatusNotice title="再読込に失敗しました" tone="warning" role="status">
              <p>前回の保存値を表示しています。ローカルの保存状態を確認してください。</p>
            </StatusNotice>
            <a href="#exact-values">正確な保存値へ</a>
          </div>
        </Card>
        <Card title="入力の基本形">
          <div className="design-stack">
            <div className="design-field">
              <label htmlFor="fixture-name">識別子</label>
              <input id="fixture-name" defaultValue="7203" aria-describedby="fixture-name-help" />
              <p id="fixture-name-help" className="field-help">これは入力表示の確認用です。</p>
            </div>
            <div className="design-field">
              <label htmlFor="fixture-invalid">選択対象</label>
              <input id="fixture-invalid" type="text" aria-invalid="true" aria-describedby="fixture-invalid-error" />
              <p id="fixture-invalid-error" className="field-error">入力エラー: 対象が指定されていません。</p>
            </div>
            <div className="design-field">
              <label htmlFor="fixture-select">表示対象</label>
              <select id="fixture-select" defaultValue="saved"><option value="saved">保存済み</option></select>
            </div>
            <div className="design-field">
              <label htmlFor="fixture-notes">注記</label>
              <textarea id="fixture-notes" defaultValue="保存された説明文を表示します。" />
            </div>
          </div>
        </Card>
        <Card title="正確な保存値">
          <TableScroll label="保存値の表を横スクロール">
            <table id="exact-values">
              <caption>合成データ / 2026-08-21 / 数値・利用不可・未収集を区別</caption>
              <thead><tr><th scope="col" className="identity-cell">識別子</th><th scope="col" className="numeric-cell">値</th><th scope="col">状態</th></tr></thead>
              <tbody>
                <tr>
                  <th scope="row"><Value value={{ text: '7203', available: true }} kind="data" /></th>
                  <td className="numeric-cell"><Value value={{ text: '0', available: true }} kind="data" /></td>
                  <td>保存済み</td>
                </tr>
                <tr>
                  <th scope="row">未取得項目</th>
                  <td className="numeric-cell"><Value value={{ text: '利用不可', available: false }} kind="data" /></td>
                  <td>未収集</td>
                </tr>
                <tr><th scope="row">長い正確値</th><td className="numeric-cell"><code>12345678901234567890123456789012345678901234567890</code></td><td>保存済み</td></tr>
              </tbody>
            </table>
          </TableScroll>
        </Card>
      </main>
    </DashboardDesign>
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string): number => {
    const rgb = /^#[0-9a-f]{6}$/i.test(color)
      ? [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16))
      : /^rgb\(\d+, \d+, \d+\)$/.test(color)
        ? color.match(/\d+/g)!.map(Number)
        : null;
    if (!rgb) throw new Error(`Expected an opaque RGB color, got ${color}.`);
    const [r, g, b] = rgb.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const left = luminance(foreground);
  const right = luminance(background);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
}
