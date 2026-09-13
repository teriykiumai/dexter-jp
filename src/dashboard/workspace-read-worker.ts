import { WorkspaceDatabase } from '../analysis/workspace/database.js';
import { resolveReference, type VerifiedObject } from '../analysis/workspace/references.js';
import { workspaceDataCodecs, validateDataObjectLinks } from '../analysis/workspace/data-objects.js';
import { objectKey, fail, type ObjectRef } from '../analysis/workspace/contracts.js';
import type { TechnicalArtifactV2 } from '../analysis/workspace/technical-artifact.js';
import type { WorkspaceChart } from './workspace-contracts.js';

self.onmessage = (event: MessageEvent<{ root: string; artifact: ObjectRef; receipt: ObjectRef; instrumentId: string }>) => {
  let db: WorkspaceDatabase | undefined;
  let result: { ok: true; chart: WorkspaceChart } | { ok: false };
  try {
    const request = event.data;
    db = new WorkspaceDatabase(request.root, { readonly: true });
    const objects = new Map<string, VerifiedObject>();
    const visit = (ref: ObjectRef, depth = 0) => {
      if (depth > 100 || objects.size > 1000) fail('reference_conflict');
      if (objects.has(objectKey(ref))) return;
      const object = resolveReference(db!, ref, workspaceDataCodecs);
      objects.set(objectKey(ref), object);
      for (const child of object.metadata.dependencies) visit(child, depth + 1);
    };
    visit(request.receipt); visit(request.artifact);
    validateDataObjectLinks([...objects.values()]);
    const object = objects.get(objectKey(request.artifact))!;
    const receipt = objects.get(objectKey(request.receipt))!;
    if (request.artifact.codec !== 'workspace_technical_v2' || request.receipt.codec !== 'workspace_receipt_v1'
      || object.metadata.scope.kind !== 'instrument-owned' || object.metadata.scope.instrumentId !== request.instrumentId
      || !receipt.metadata.dependencies.some(ref => objectKey(ref) === objectKey(request.artifact))) fail('reference_conflict');
    const artifact = JSON.parse(new TextDecoder().decode(object.bytes)) as TechnicalArtifactV2;
    const rows = (interval: 'day' | 'week' | 'month') => artifact.result.intervals[interval].map(row => ({
      sourceGaps: artifact.input.daily.filter(inputRow => inputRow.Date >= row.periodStart && inputRow.Date <= row.periodEnd
        && inputRow.O === null && inputRow.H === null && inputRow.L === null && inputRow.C === null && inputRow.Vo === null).map(inputRow => inputRow.Date),
      interval: row.interval, identity: row.identity, periodStart: row.periodStart, periodEnd: row.periodEnd,
      displayDate: row.displayDate, firstSessionDate: row.firstSessionDate, lastSessionDate: row.lastSessionDate,
      partial: row.partial, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
      rsi: row.rsi, macd: row.macd, signal: row.signal, histogram: row.histogram, cross: row.cross, sma20: row.sma20,
      completion: row.completion, coverage: row.coverage,
    }));
    const projectedUnavailable = [...artifact.result.unavailablePeriods.map(({ interval, identity, periodStart, periodEnd, reason }) =>
      ({ interval, identity, periodStart, periodEnd, reason }))];
    for (const interval of ['week', 'month'] as const) for (const row of artifact.result.intervals[interval]) {
      const gaps = artifact.input.daily.filter(inputRow => inputRow.Date >= row.periodStart && inputRow.Date <= row.periodEnd
        && inputRow.O === null && inputRow.H === null && inputRow.L === null && inputRow.C === null && inputRow.Vo === null);
      if (gaps.length && !projectedUnavailable.some(item => item.interval === interval && item.identity === row.identity))
        projectedUnavailable.push({ interval, identity: row.identity, periodStart: row.periodStart, periodEnd: row.periodEnd, reason: 'source_gap' });
    }
    const chart: WorkspaceChart = { schemaVersion: 'workspace_chart_v1', dataDate: artifact.dataDate, eligibilityFrom: artifact.input.eligibilityFrom,
      artifactDigest: artifact.artifactDigest, intervals: { day: rows('day'), week: rows('week'), month: rows('month') },
      unavailablePeriods: projectedUnavailable as WorkspaceChart['unavailablePeriods'] };
    result = { ok: true, chart };
  } catch { result = { ok: false }; }
  finally { db?.close(); }
  // Completion must follow connection release; callers may immediately stop/backup.
  self.postMessage(result);
};
