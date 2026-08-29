export const DASHBOARD_GLOSSARY_TERM_IDS = [
  'rsi',
  'macd',
  'bollingerBands',
  'atr',
  'beta',
  'alpha',
  'rSquared',
  'marginBalanceRatio',
  'digestionDays',
  'reportedShortPositions',
  'investorTypeFlows',
  'poc',
  'vah',
  'val',
] as const;

export type DashboardGlossaryTermId = typeof DASHBOARD_GLOSSARY_TERM_IDS[number];

export interface DashboardGlossaryEntry {
  readonly id: DashboardGlossaryTermId;
  readonly label: string;
  readonly measures: string;
  readonly unitAndReading: string;
  readonly limitation: string;
  readonly decisionBoundary: string;
}

const NOT_A_SIGNAL = 'この指標だけで買い・売りを判断するものではありません。';

export const DASHBOARD_GLOSSARY: Readonly<Record<
  DashboardGlossaryTermId,
  DashboardGlossaryEntry
>> = {
  rsi: {
    id: 'rsi',
    label: 'RSI',
    measures: '直近の調整後終値について、値上がり幅と値下がり幅のバランスから値動きの勢いを示します。',
    unitAndReading: '0から100の指数です。高いほど直近の値上がり幅が、低いほど値下がり幅が相対的に大きいことを示します。',
    limitation: '保存済みRSI 14の最新値です。価格水準や将来の反転を直接示すものではありません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  macd: {
    id: 'macd',
    label: 'MACD',
    measures: '調整後終値の短期と長期の指数移動平均の差から、トレンドと勢いの変化を示します。',
    unitAndReading: 'MACD・シグナル・ヒストグラムは円単位です。ヒストグラムは保存済みのMACDとシグナルの差です。',
    limitation: '12・26・9期間の保存済み最新値で、移動平均を使うため価格変化に遅れて反応します。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  bollingerBands: {
    id: 'bollingerBands',
    label: 'ボリンジャーバンド（Bollinger Bands）',
    measures: '20期間の調整後終値の平均とばらつきから、中心線・上限線・下限線を示します。',
    unitAndReading: '3本とも円単位です。帯が広いほど、対象期間の価格のばらつきが大きいことを示します。',
    limitation: '保存済みの最新20期間の値です。上限・下限は到達確率や支持線・抵抗線を保証しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  atr: {
    id: 'atr',
    label: 'ATR',
    measures: '当日の高値・安値と前日終値を使い、窓開けを含む値動きの大きさを示します。',
    unitAndReading: '円単位です。値が大きいほど直近の価格変動幅が大きく、方向は示しません。',
    limitation: '保存済みATR 14に基づく変動幅で、将来の変動や上昇・下落方向を予測しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  beta: {
    id: 'beta',
    label: 'Beta',
    measures: '銘柄リターンが比較対象のリターン変化に対してどの程度動いたかを示します。',
    unitAndReading: '比率です。1に近い場合は、対象期間では比較対象と同程度の感応度だったことを示します。',
    limitation: '日付を一致させた保存済み期間の過去リターンに基づき、比較対象や期間によって変わります。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  alpha: {
    id: 'alpha',
    label: 'Alpha',
    measures: '比較対象のリターンとBetaで説明される部分を除いた、銘柄の平均的な超過リターンを示します。',
    unitAndReading: '年率換算した比率を百分率で表示します。正負は対象期間の保存済み計算結果です。',
    limitation: '過去リターンの線形関係に基づくため、将来の超過収益や原因を示すものではありません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  rSquared: {
    id: 'rSquared',
    label: 'R²',
    measures: '銘柄リターンの変動が比較対象との線形関係でどの程度説明されたかを示します。',
    unitAndReading: '0から1の比率です。高いほど、対象期間では比較対象との線形な連動が強かったことを示します。',
    limitation: '方向や収益性ではなく当てはまりの度合いです。因果関係や将来の連動を保証しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  marginBalanceRatio: {
    id: 'marginBalanceRatio',
    label: '信用倍率',
    measures: '信用買残を信用売残で割った、保存済み残高同士の比率を示します。',
    unitAndReading: '比率です。値が大きいほど、同じ基準日の信用売残に対して信用買残が相対的に多い状態です。',
    limitation: '週次の公開残高に基づき、投資家の意図や将来の売買時期を特定できません。売残が0の場合は利用不可です。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  digestionDays: {
    id: 'digestionDays',
    label: '信用消化日数',
    measures: '信用買残が直近の平均日次出来高の何日分に相当するかを示します。',
    unitAndReading: '日数です。値が大きいほど、信用買残が平均出来高に対して大きい状態です。',
    limitation: '平均出来高は将来の売買能力を保証せず、信用買残が実際に売却される日数を予測するものではありません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  reportedShortPositions: {
    id: 'reportedShortPositions',
    label: '公開空売り残高報告',
    measures: 'J-Quantsで取得した、報告者・ファンド単位の公開対象となる空売り残高報告を示します。',
    unitAndReading: '残高比率は百分率、株数は株、増減はポイントで表示します。各行は別の公開報告です。',
    limitation: '0.5%以上の公開報告であり、市場全体の空売り残高ではありません。報告者間を合算せず、データなしを0と解釈しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  investorTypeFlows: {
    id: 'investorTypeFlows',
    label: '投資部門別売買',
    measures: '東京・名古屋市場全体について、公式区分別の週次売買金額を市場環境として示します。',
    unitAndReading: '千円単位です。売り・買い・合計・差引は保存済みの公式区分ごとの値をそのまま表示します。',
    limitation: '個別銘柄の売買ではなく公表の遅れがあります。区分を統合せず、信用需給や空売り報告とも合算しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  poc: {
    id: 'poc',
    label: 'POC',
    measures: '日足OHLCVから推定した出来高価格分布で、配分出来高が最も大きい価格帯を示します。',
    unitAndReading: '価格は円、配分出来高は調整後株です。表示値は保存済みの価格帯と代表価格です。',
    limitation: '日中の実約定分布や保有者の取得単価ではない日足ベースの推定値で、真のしこり玉を示しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  vah: {
    id: 'vah',
    label: 'VAH',
    measures: '保存済みValue Areaに含まれる最も高い価格帯の上端を示します。',
    unitAndReading: '円単位です。VALからVAHまでが、目標出来高比率を含む連続した価格帯です。',
    limitation: '日足OHLCVから推定した分布の境界であり、抵抗線や将来価格の上限を示しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
  val: {
    id: 'val',
    label: 'VAL',
    measures: '保存済みValue Areaに含まれる最も低い価格帯の下端を示します。',
    unitAndReading: '円単位です。VALからVAHまでが、目標出来高比率を含む連続した価格帯です。',
    limitation: '日足OHLCVから推定した分布の境界であり、支持線や将来価格の下限を示しません。',
    decisionBoundary: NOT_A_SIGNAL,
  },
};

export const DASHBOARD_GLOSSARY_ENTRIES = DASHBOARD_GLOSSARY_TERM_IDS.map(
  id => DASHBOARD_GLOSSARY[id],
) as readonly DashboardGlossaryEntry[];
