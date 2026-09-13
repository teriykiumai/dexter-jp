import { createTechnicalSourceRequestWindowV1 } from '../market-data/technical-source-gate.js';
import type { TechnicalFetchedInputsV1 } from '../market-data/technical-source.js';
import type { TechnicalInput } from './technical-input.js';

/** Synthetic calendar/history only; no entitlement or historical identity evidence. */
export function workspaceTechnicalHistory(gapDates: readonly string[] = []) {
  const acceptedAt = '2026-09-11T08:00:00.000Z';
  const window = createTechnicalSourceRequestWindowV1(acceptedAt);
  const calendar: Array<TechnicalFetchedInputsV1['calendarRows'][number]> = [], daily: TechnicalInput['daily'] = [];
  for (let time = Date.parse(window.calendarCoverageFrom), index = 0;
    time <= Date.parse(window.calendarCoverageTo); time += 86_400_000, index++) {
    const day = new Date(time), DateValue = day.toISOString().slice(0, 10);
    const session = ![0, 6].includes(day.getUTCDay());
    calendar.push({ Date: DateValue, HolDiv: session ? '1' : '0' });
    if (!session || DateValue < '2022-01-03' || DateValue > window.calculationDate) continue;
    const gap = gapDates.includes(DateValue), close = gap ? null : 100 + index % 43;
    daily.push({ Date: DateValue, Code: '72030', O: close, H: gap ? null : 150, L: gap ? null : 90, C: close, Vo: gap ? null : 1000,
      AdjO: close, AdjH: gap ? null : 150, AdjL: gap ? null : 90, AdjC: close, AdjVo: gap ? null : 1000, AdjFactor: 1, ExRT: null });
  }
  const input: TechnicalInput = { version: 'workspace_technical_input_v1',
    identity: { instrumentId: '00000000-0000-4000-8000-000000000001', provider: 'jquants', code: '72030', mappingRevision: 1, catalogGeneration: 1 },
    masterEvidence: { path: 'master.json', digest: `sha256:${'a'.repeat(64)}`, codec: 'workspace_episode_v1' },
    eligibilityFrom: '2022-01-03', master: { Date: window.calculationDate, Code: '72030', CoName: 'Synthetic', Mkt: '0111', ProdCat: '011' },
    queryFrom: window.queryFrom, queryTo: window.calculationDate, calculationDate: window.calculationDate,
    calendarFrom: window.calendarCoverageFrom, calendarThrough: window.calendarCoverageTo, calendar, daily,
    adjustmentMethod: 'jquants_adjusted_ohlcv_not_total_return', factorSemantics: 'provider_daily_event_factor_not_cumulative', historicalIdentity: 'not_verified' };
  const fetched: TechnicalFetchedInputsV1 = { ticker: '7203', acceptedAt, window, eligibleThrough: input.queryTo, code: input.identity.code,
    master: input.master, calendarRows: calendar, barRows: daily,
    fetched: new Map(['daily_bars', 'security_master', 'trading_calendar'].map(role => [role, {
      fetchedAt: acceptedAt, pageCount: 1, rowCount: role === 'daily_bars' ? daily.length : role === 'security_master' ? 1 : calendar.length,
    }])), metrics: { attempts: 3, pages: 3, acceptedRows: daily.length + calendar.length + 1, responseBytes: 0 } };
  return { input, fetched };
}
