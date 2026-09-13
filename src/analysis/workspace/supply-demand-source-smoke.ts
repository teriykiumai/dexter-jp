import { z } from 'zod';
import { canonicalJsonV1, sha256CanonicalJsonV1 } from '../snapshot/canonical-json.js';
import { isStrictGregorianDate } from '../strategy-validation/date.js';
import { DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1, resolveJQuantsRequestsPerMinuteV1,
  type JQuantsExecutionEnvironmentV1 } from '../strategy-validation/jquants-execution.js';
import { createMarketDataReaderV1, TechnicalSourceFailureV1,
  type TechnicalCollectionContextV1 } from '../market-data/technical-source.js';
import { sector33CodeSchema } from '../../tools/finance/sector-index.js';

/** Fixed diagnostic sample, not a production collector or historical identity proof. */
export const SUPPLY_DEMAND_SMOKE_SAMPLE = Object.freeze({
  code: '72030', from: '2026-08-01', through: '2026-09-11',
  specificationExpiresAt: '2026-09-27T15:00:00.000Z',
});
export const SUPPLY_DEMAND_SMOKE_LIMITS = Object.freeze({
  logicalQueries: 4, attempts: 20, pages: 20, rows: 8000, responseBytes: 32 * 1024 * 1024,
  requestTimeoutMs: 30_000, deadlineMs: 180_000, retries: 0, maximumRequestsPerMinute: 5,
});
export class SupplyDemandSmokeError extends Error {
  constructor(readonly code: 'cancelled' | 'invalid_configuration' | 'specification_gate_expired'
    | 'execution_timeout' | 'attempt_limit_exceeded' | 'retry_disabled' | 'source_response_invalid',
    readonly fields: readonly string[] = [], readonly shapes: Readonly<Record<string, string>> = {}) {
    super(code);
  }
}
const fail = (code: SupplyDemandSmokeError['code']): never => { throw new SupplyDemandSmokeError(code); };
const date = z.string().refine(isStrictGregorianDate);
const amount = z.number().finite().nonnegative().nullable();
const name = z.string().max(4096).nullable();
const masterSchema = z.object({ Date: date, Code: z.literal('72030'), Mkt: z.enum(['0105', '0111', '0112', '0113']),
  ProdCat: z.literal('011'), S33: sector33CodeSchema, S33Nm: z.string().min(1).max(256) });
const marginSchema = z.object({ Date: date, Code: z.literal('72030'), IssType: z.enum(['1', '2', '3']),
  ShrtVol: amount, LongVol: amount, ShrtNegVol: amount, LongNegVol: amount, ShrtStdVol: amount, LongStdVol: amount });
const reportSchema = z.object({ DiscDate: date, CalcDate: date, Code: z.string().regex(/^[0-9A-Z]{5}$/),
  SSName: name, DICName: name, FundName: name, ShrtPosToSO: amount, ShrtPosShares: amount,
  PrevRptDate: z.union([date, z.literal(''), z.literal('-'), z.null()]), PrevRptRatio: amount });
const sectorSchema = z.object({ Date: date, S33: sector33CodeSchema,
  SellExShortVa: amount, ShrtWithResVa: amount, ShrtNoResVa: amount });

function parsed<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  // Only schema-owned field names; never include issue messages or received values.
  const allowed = new Set(['Date', 'Code', 'Mkt', 'ProdCat', 'S33', 'S33Nm', 'IssType',
    'ShrtVol', 'LongVol', 'ShrtNegVol', 'LongNegVol', 'ShrtStdVol', 'LongStdVol',
    'DiscDate', 'CalcDate', 'SSName', 'DICName', 'FundName', 'ShrtPosToSO', 'ShrtPosShares',
    'PrevRptDate', 'PrevRptRatio', 'SellExShortVa', 'ShrtWithResVa', 'ShrtNoResVa']);
  const fields = [...new Set(result.error.issues
    .map(issue => String(issue.path[0] ?? '')).filter(field => allowed.has(field)))].sort();
  const shapes = Object.fromEntries(fields.map(field => {
    const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[field] : undefined;
    const shape = value === null ? 'null' : typeof value !== 'string' ? typeof value
      : value === '-' ? 'dash' : /^\d{4}\/\d{2}\/\d{2}$/.test(value) ? 'slash_date'
        : /^\d{8}$/.test(value) ? 'compact_date' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'invalid_iso_date'
          : value.trim() === '' ? 'blank' : 'other_string';
    return [field, shape];
  }));
  throw new SupplyDemandSmokeError('source_response_invalid', fields, shapes);
}

type Diagnostic = { stage: 'configuration' | 'membership' | 'margin' | 'reports' | 'sector';
  attempts: number; pages: number; acceptedRows: number; responseBytes: number };

export async function proveSupplyDemandSourceFields(options: {
  confirmed: boolean; environment?: JQuantsExecutionEnvironmentV1; requestsPerMinute?: number;
  observe?: (diagnostic: Diagnostic) => void;
}) {
  if (options.confirmed !== true) return fail('cancelled');
  const env = options.environment ?? DEFAULT_JQUANTS_EXECUTION_ENVIRONMENT_V1;
  const now = env.wallNowMs(), origin = env.monotonicNowMs();
  if (!Number.isFinite(now) || !Number.isFinite(origin)
    || now < Date.parse('2026-09-11T15:00:00.000Z')) return fail('invalid_configuration');
  // The provider has announced a same-endpoint cadence/schema replacement. A clock
  // transition alone must never promote this old weekly probe to a daily contract.
  if (now >= Date.parse(SUPPLY_DEMAND_SMOKE_SAMPLE.specificationExpiresAt)) return fail('specification_gate_expired');
  const configured = options.requestsPerMinute ?? resolveJQuantsRequestsPerMinuteV1();
  if (!Number.isInteger(configured) || configured < 1 || configured > 500) return fail('invalid_configuration');
  const rpm = Math.min(configured, SUPPLY_DEMAND_SMOKE_LIMITS.maximumRequestsPerMinute);
  const spacing = 60_000 / rpm;
  let attempts = 0, lastDispatch = -Infinity;
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), SUPPLY_DEMAND_SMOKE_LIMITS.deadlineMs);
  const check = () => {
    if (env.wallNowMs() >= Date.parse(SUPPLY_DEMAND_SMOKE_SAMPLE.specificationExpiresAt)) {
      return fail('specification_gate_expired');
    }
    if (abort.signal.aborted || env.monotonicNowMs() - origin >= SUPPLY_DEMAND_SMOKE_LIMITS.deadlineMs) {
      abort.abort(); return fail('execution_timeout');
    }
  };
  const context: TechnicalCollectionContextV1 = {
    jobId: 'diagnostic-only', acceptedAt: new Date(now).toISOString(), signal: abort.signal,
    shareSource: (_key, load) => load(), recordProgress: () => {},
    waitBeforeRetry: async () => fail('retry_disabled'),
    dispatch: async start => {
      check();
      if (attempts >= SUPPLY_DEMAND_SMOKE_LIMITS.attempts) return fail('attempt_limit_exceeded');
      const wait = lastDispatch + spacing - env.monotonicNowMs();
      if (wait > 0) await env.sleep(wait, abort.signal);
      check();
      attempts++; lastDispatch = env.monotonicNowMs();
      const request = new AbortController();
      const onAbort = () => request.abort();
      abort.signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(onAbort, SUPPLY_DEMAND_SMOKE_LIMITS.requestTimeoutMs);
      let rejectTimeout!: () => void;
      const timeout = new Promise<never>((_resolve, reject) => {
        rejectTimeout = () => reject(new SupplyDemandSmokeError('execution_timeout'));
        request.signal.addEventListener('abort', rejectTimeout, { once: true });
      });
      try { return await Promise.race([start(request.signal), timeout]); }
      finally {
        clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort);
        request.signal.removeEventListener('abort', rejectTimeout);
      }
    },
  };
  let stage: Diagnostic['stage'] = 'configuration';
  let reader: ReturnType<typeof createMarketDataReaderV1> | undefined;
  try {
    reader = createMarketDataReaderV1(context, env, SUPPLY_DEMAND_SMOKE_LIMITS);
    const { code, from, through } = SUPPLY_DEMAND_SMOKE_SAMPLE;
    stage = 'membership';
    const masterRows = await reader.fetchRows('membership', '/v2/equities/master', { code, date: through });
    if (masterRows.length !== 1) return fail('source_response_invalid');
    const master = parsed(masterSchema, masterRows[0]);
    if (master.Date !== through) return fail('source_response_invalid');
    stage = 'margin';
    const margin = (await reader.fetchRows('margin', '/v2/markets/margin-interest', { code, from, to: through }))
      .map(row => {
        if (row && typeof row === 'object' && ['ShrtVal', 'LongVal', 'ShrtNegVal', 'LongNegVal', 'ShrtStdVal', 'LongStdVal']
          .some(key => Object.hasOwn(row, key))) throw new SupplyDemandSmokeError('source_response_invalid', ['announced_amount_fields']);
        return parsed(marginSchema, row);
      });
    const dates = new Set<string>();
    for (const row of margin) {
      if (row.Date < from || row.Date > through || dates.has(row.Date)) return fail('source_response_invalid');
      dates.add(row.Date);
    }
    // One disclosure day across issuers proves field shape without interpreting an
    // empty response for one company as proof that no short positions exist.
    stage = 'reports';
    const reports = (await reader.fetchRows('reports', '/v2/markets/short-sale-report', { disc_date: through }))
      .map(row => parsed(reportSchema, row));
    if (reports.some(row => row.DiscDate !== through || row.CalcDate > row.DiscDate
      || row.PrevRptDate && row.PrevRptDate !== '-' && row.PrevRptDate > row.CalcDate)) return fail('source_response_invalid');
    stage = 'sector';
    const sector = (await reader.fetchRows('sector', '/v2/markets/short-ratio', { s33: master.S33, date: through }))
      .map(row => parsed(sectorSchema, row));
    if (sector.length > 1 || sector.some(row => row.S33 !== master.S33 || row.Date !== through)) return fail('source_response_invalid');
    check();
    const coverage = {
      margin: margin.some(row => row.LongVol !== null && row.ShrtVol !== null),
      reportedPositions: reports.some(row => row.ShrtPosToSO !== null && row.ShrtPosShares !== null),
      sector: sector.some(row => row.SellExShortVa !== null && row.ShrtWithResVa !== null && row.ShrtNoResVa !== null),
    };
    const evidence = (rows: unknown[]) => ({ rowCount: rows.length,
      digest: sha256CanonicalJsonV1(rows as Parameters<typeof sha256CanonicalJsonV1>[0]) });
    return { schemaVersion: 'workspace_supply_demand_source_field_gate_v1',
      state: Object.values(coverage).every(Boolean) ? 'passed' : 'incomplete',
      acceptedAt: context.acceptedAt, checkedAt: new Date(env.wallNowMs()).toISOString(),
      sample: SUPPLY_DEMAND_SMOKE_SAMPLE, limits: SUPPLY_DEMAND_SMOKE_LIMITS, requestsPerMinute: rpm,
      metrics: reader.metrics(), coverage, membership: evidence([master]), margin: evidence(margin),
      reports: { ...evidence(reports), previousDateDashCount: reports.filter(row => row.PrevRptDate === '-').length },
      sector: { ...evidence(sector), sectorCode: master.S33 },
      scope: 'field_shape_only', historicalIdentity: 'not_verified', historicalSectorMembership: 'not_verified',
      sourceRevision: 'official_specs_retrieved_2026_09_13', marginCadence: 'weekly_before_announced_replacement',
      futureDailyMarginContract: 'not_verified', longHistoryEntitlement: 'not_tested' };
  } finally {
    clearTimeout(deadline); abort.abort();
    options.observe?.({ stage, ...(reader?.metrics() ?? { attempts, pages: 0, acceptedRows: 0, responseBytes: 0 }) });
  }
}

if (import.meta.main) {
  let diagnostic: Diagnostic | undefined;
  void (async () => {
    const confirmed = process.argv.slice(2).join('\0') === '--confirm-external-fetch';
    const result = await proveSupplyDemandSourceFields({ confirmed, observe: value => { diagnostic = value; } });
    console.log(canonicalJsonV1(result));
    if (result.state !== 'passed') process.exitCode = 1;
  })().catch(error => {
    console.error(JSON.stringify({ state: 'unavailable', code: error instanceof SupplyDemandSmokeError
      || error instanceof TechnicalSourceFailureV1 ? error.code : 'source_response_invalid',
      ...(diagnostic ? { diagnostic } : {}),
      ...(error instanceof SupplyDemandSmokeError && error.fields.length ? { fields: error.fields, shapes: error.shapes } : {}) }));
    process.exitCode = 1;
  });
}
