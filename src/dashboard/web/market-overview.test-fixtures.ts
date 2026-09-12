// Synthetic presentation fixtures only: no provider, credentials, or filesystem reads.
export function overviewBrowserFixture(close = 40000) {
  const available = (value: number) => ({ state: 'available', value });
  const modules = (['etf_1321_eod', 'etf_1321_2633_relative'] as const).map(moduleId => {
    const payload = { schemaVersion: 'market_overview_module_v1', calculationVersion: `${moduleId}_calculation_v1`, moduleId, sourceId: `${moduleId}_v1`,
      state: 'available', reason: null, dataDate: '2026-09-10', fetchedAt: '2026-09-10T08:00:00Z', cadence: 'daily', displayUnit: moduleId === 'etf_1321_eod' ? 'JPY' : 'base_100',
      sourceInputs: [{ role: 'daily_bars_1321', sourceId: 'jquants', kind: 'provider', endpoint: '/v2/equities/bars/daily', sourceContractVersion: 'bars_v1', sourceMappingVersion: 'mapping_v1', sourceRevisionIds: ['official_v1'] }],
      observations: moduleId === 'etf_1321_eod'
        ? [{ identity: '2026-09-10', dataDate: '2026-09-10', observationState: { state: 'available', reason: null }, adjustedCloseYen: available(close), previousCommonDate: '2026-09-09', previousAdjustedCloseYen: available(close), changeYen: available(0), changeRatePercent: available(0) }]
        : ['3m', '6m', '1y', '3y', 'max'].map((range, index) => ({ range, state: 'available', rangeStart: '2026-09-09', rangeEnd: '2026-09-10', commonDates: ['2026-09-09', '2026-09-10'], normalized1321: [100, 102 + index], normalized2633: [100, 101], return1321Percent: 2 + index, return2633Percent: 1, differencePercentagePoints: 1 + index, direction: '1321_leads' })) };
    return { moduleId, state: 'available', checkedAt: '2026-09-10T09:00:00Z', payload,
      artifactIdentity: { scope: 'overview', tickerOrSourceId: `${moduleId}_v1`, dataDate: '2026-09-10', sourcePayloadDigest: `sha256:${'a'.repeat(64)}` }, observationReceiptIdentity: {},
      warnings: [{ code: 'historical_identity_unverified', message: '履歴は現在の銘柄コードに紐づくJ-Quants調整後価格です。表示期間全体が同一銘柄であることは確認していません。' },
        { code: 'history_coverage_clipped', message: '取得できた履歴の開始日は1321が2016-09-12、2633が2021-03-31です。これらの日付は上場日を示しません。' }] };
  });
  return { schemaVersion: 'market_overview_response_v1', modules: [...['tse_margin_quantities', 'market_short_ratio', 'margin_1570', 'foreign_flows'].map(moduleId => ({ moduleId, state: 'not_implemented' })), ...modules] };
}
export const overviewJobId = '22222222-2222-4222-8222-222222222222';
export function overviewBrowserJob(status = 'running') {
  return { schemaVersion: 'market_data_job_view_v1', jobId: overviewJobId, kind: 'overview_refresh', target: { kind: 'overview' }, status,
    progress: { attempts: 5, pages: 5, acceptedRows: 10, responseBytes: 1000, completedModules: status === 'completed' ? 2 : 0, totalModules: 2 }, failure: null, result: null };
}
