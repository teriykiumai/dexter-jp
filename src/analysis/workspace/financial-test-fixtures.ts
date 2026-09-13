import { resolve } from 'node:path';
import { workspaceDataFixture } from './data-test-fixtures.js';
import { readStep2aTechnicalFixture } from './technical-test-fixtures.js';
import { registerReferences } from './references.js';
import { workspaceDataCodecs } from './data-objects.js';
import { writeExclusive } from './files.js';
import { json } from './contracts.js';

export function financialSourceFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { Code: '72030', DiscDate: '2026-05-08', DiscTime: '15:00', DiscNo: '20260508000001',
    DocType: 'FYFinancialStatements_Consolidated_IFRS', CurPerType: 'FY', CurPerSt: '2025-04-01', CurPerEn: '2026-03-31',
    CurFYSt: '2025-04-01', CurFYEn: '2026-03-31', NxtFYEn: '2027-03-31',
    Sales: '1000', OP: '100', OdP: '', NP: '50', EPS: '10', BPS: '100', TA: '2000', Eq: '800', EqAR: '0.4',
    CFO: '100', CFI: '-50', CFF: '-20', ShOutFY: '100', TrShFY: '10',
    DivAnn: '3', PayoutRatioAnn: '0.3', FDivAnn: '', FPayoutRatioAnn: '', NxFDivAnn: '4', NxFPayoutRatioAnn: '0.4', ...overrides };
}
export async function financialFixture(verified = false, checkpoint?: Parameters<typeof workspaceDataFixture>[0]) {
  const f = await workspaceDataFixture(checkpoint);
  if (verified) {
    // Offline synthetic continuity is not live issuer evidence.
    const frozen = readStep2aTechnicalFixture(), input = frozen.artifact.input, sourceRoot = resolve(f.directory, 'inputs');
    for (const object of frozen.objects) writeExclusive(resolve(sourceRoot, object.ref.path), json(object.value));
    await registerReferences(f.db, sourceRoot, frozen.objects.map(object => object.ref), workspaceDataCodecs);
    const catalog = frozen.objects.find(object => object.ref.path === 'catalog-2026-09-11.json')!.ref;
    await f.repository.acceptCatalog(f.repository.requestCatalog(input.queryTo), [{ instrumentId: input.identity.instrumentId,
      assetType: 'stock', provider: 'jquants', code: input.identity.code, label: input.master.CoName,
      mappingRevision: input.identity.mappingRevision, episodeFrom: input.eligibilityFrom, episodeThrough: null, evidence: input.masterEvidence }], catalog);
  } else await f.jobs.wait(await f.jobs.start('catalog'));
  const id = f.repository.search('7203')[0]!.instrumentId; f.repository.openWorkspace(id); f.advance();
  f.setTransform((path, rows) => { if (path.endsWith('/summary')) rows.push(financialSourceFixture()); });
  return { ...f, id };
}
