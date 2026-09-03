import { dirname } from 'node:path';
import { link } from 'node:fs/promises';
import { dexterPath } from '../../utils/paths.js';
import { canonicalJsonV1, sha256CanonicalJsonV1, type CanonicalJsonValue } from '../snapshot/canonical-json.js';
import { CreateOnlyFilePublicationError, publishCreateOnlyFile, type CreateOnlyLinkFile } from '../snapshot/create-only-file.js';
import { StrategyValidationUuidV4Schema } from '../strategy-validation/artifacts.js';
import { MarketDataArtifactCodecV1, type MarketDataArtifactFieldsV1 } from './artifact-codec.js';
import { MarketDataFilesV1, MarketDataRecoveryBudgetV1, MARKET_DATA_RECOVERY_LIMITS_V1 } from './repository-files.js';
import {
  MarketDataArtifactIdentityV1Schema, MarketDataInstantV1Schema, MarketDataRepositoryErrorV1,
  MarketDataObservationReceiptIdentityV1Schema,
  failMarketData, marketDataTargetKeyV1, receiptIdentityV1, validateReceiptV1,
  type MarketDataArtifactIdentityV1, type MarketDataObservationReceiptIdentityV1,
  type MarketDataObservationReceiptV1,
  type MarketDataModuleIdV1,
} from './contracts.js';

function json(value: unknown): CanonicalJsonValue { return value as CanonicalJsonValue; }
function same(left: unknown, right: unknown): boolean {
  return canonicalJsonV1(json(left)) === canonicalJsonV1(json(right));
}
function recoverable(error: unknown): boolean {
  return error instanceof MarketDataRepositoryErrorV1
    && ['artifact_not_found', 'artifact_corrupt', 'invalid_artifact'].includes(error.code);
}
export interface MarketDataRepositoryOptionsV1 {
  linkFile?: CreateOnlyLinkFile;
  monotonicNow?: () => number;
  writeCache?: (path: string, payload: string) => Promise<void>;
}
export type ObservedMarketDataV1<T> = {
  artifact: T; artifactIdentity: MarketDataArtifactIdentityV1;
  receipt: MarketDataObservationReceiptV1;
  observationReceiptIdentity: MarketDataObservationReceiptIdentityV1; checkedAt: string;
};
export type LatestMarketDataV1<T> = ObservedMarketDataV1<T> & {
  state: 'available' | 'fallback';
  warnings: { code: 'artifact_corrupt_fallback'; message: string;
    moduleId: MarketDataModuleIdV1 | null; artifactIdentity: MarketDataArtifactIdentityV1 }[];
  diagnostics: { enumeratedReceipts: number; inspectedReceipts: number; bytesRead: number; enumerationMilliseconds: number };
};

/** One target and its required strict codec. No default codec, source fetch,
 * job store or production module registration is introduced here.
 */
export class MarketDataRepositoryV1<T extends MarketDataArtifactFieldsV1> {
  private readonly files: MarketDataFilesV1;
  private readonly now: () => number;
  private readonly prefix: string;
  constructor(readonly codec: MarketDataArtifactCodecV1<T>, root = dexterPath('market-data'),
    private readonly options: MarketDataRepositoryOptionsV1 = {}) {
    this.files = new MarketDataFilesV1(root);
    this.now = options.monotonicNow ?? (() => performance.now());
    this.prefix = `${codec.target.kind}/${marketDataTargetKeyV1(codec.target)}`;
  }

  private async readArtifact(identity: MarketDataArtifactIdentityV1, budget?: MarketDataRecoveryBudgetV1): Promise<T> {
    const parsed = MarketDataArtifactIdentityV1Schema.safeParse(identity);
    if (!parsed.success || parsed.data.scope !== this.codec.target.kind
      || parsed.data.tickerOrSourceId !== marketDataTargetKeyV1(this.codec.target)) return failMarketData('artifact_corrupt');
    const raw = await this.files.read(this.files.path(identity.rootRelativeIdentity), budget);
    const artifact = this.codec.parse(raw);
    if (!same(this.codec.identity(artifact), identity)) return failMarketData('artifact_corrupt');
    budget?.check();
    return artifact;
  }

  async loadExact(identity: MarketDataArtifactIdentityV1): Promise<T> {
    try { return await this.readArtifact(identity); }
    catch (error) { if (recoverable(error)) return failMarketData('artifact_corrupt'); throw error; }
  }

  /** Exact committed association for the later native job-recovery adapter. This
   * never consults latest and never substitutes a fallback observation.
   */
  async loadObservation(identity: MarketDataObservationReceiptIdentityV1): Promise<ObservedMarketDataV1<T>> {
    const parsed = MarketDataObservationReceiptIdentityV1Schema.safeParse(identity);
    if (!parsed.success || parsed.data.scope !== this.codec.target.kind
      || parsed.data.tickerOrSourceId !== marketDataTargetKeyV1(this.codec.target)) return failMarketData('artifact_corrupt');
    try {
      const receipt = validateReceiptV1(await this.files.read(this.files.path(parsed.data.rootRelativeIdentity)));
      if (!same(receiptIdentityV1(receipt), parsed.data) || !same(receipt.target, this.codec.target)) return failMarketData('artifact_corrupt');
      const artifact = await this.readArtifact(receipt.artifactIdentity);
      return { receipt, artifact, artifactIdentity: receipt.artifactIdentity,
        observationReceiptIdentity: parsed.data, checkedAt: receipt.checkedAt };
    } catch (error) { if (recoverable(error)) return failMarketData('artifact_corrupt'); throw error; }
  }

  private async create(path: string, payload: unknown, validate: (raw: unknown) => void,
    existing: (raw: unknown) => void): Promise<'created' | 'existing'> {
    const canonicalPayload = canonicalJsonV1(json(payload));
    if (Buffer.byteLength(canonicalPayload, 'utf8') > MARKET_DATA_RECOVERY_LIMITS_V1.bytes) return failMarketData('invalid_artifact');
    await this.files.directory(dirname(path), true);
    return publishCreateOnlyFile({ finalPath: path, canonicalPayload,
      assertTemporaryPath: temporary => this.files.contained(temporary),
      writeTemporary: (temporary, content) => this.files.writeTemporary(temporary, content),
      validateTemporary: async temporary => validate(await this.files.read(temporary)),
      resolveExisting: async final => { existing(await this.files.read(final)); return 'existing' as const; },
      linkFile: async (source, destination) => {
        if (!await this.files.directory(dirname(destination))) return failMarketData('repository_unsafe');
        await (this.options.linkFile ?? link)(source, destination);
      },
    });
  }

  async publish(rawArtifact: unknown, observation: { jobId: string; acceptedAt: string; checkedAt: string })
    : Promise<ObservedMarketDataV1<T> & { state: 'published' | 'idempotent_reuse' }> {
    // Freeze input before the first await; caller mutation cannot change a publication.
    const candidate = this.codec.parse(rawArtifact);
    const job = StrategyValidationUuidV4Schema.safeParse(observation.jobId);
    const accepted = MarketDataInstantV1Schema.safeParse(observation.acceptedAt);
    const checked = MarketDataInstantV1Schema.safeParse(observation.checkedAt);
    if (!job.success || !accepted.success || !checked.success || checked.data < accepted.data
      || accepted.data !== candidate.asOfCutoff || checked.data < candidate.fetchedAt) return failMarketData('invalid_artifact');
    const candidateIdentity = this.codec.identity(candidate);
    const path = this.files.path(candidateIdentity.rootRelativeIdentity);
    let artifact: T = candidate;
    let state: 'published' | 'idempotent_reuse' = 'published';
    const validateExisting = (raw: unknown) => {
      const winner = this.codec.parse(raw);
      const winnerIdentity = this.codec.identity(winner);
      if (winnerIdentity.rootRelativeIdentity !== candidateIdentity.rootRelativeIdentity
        || !this.codec.equivalent(winner, candidate)) return failMarketData('artifact_collision');
      artifact = winner;
    };
    try {
      const outcome = await this.create(path, candidate, raw => {
        const value = this.codec.parse(raw);
        if (!same(value, candidate)) return failMarketData('artifact_collision');
      }, validateExisting);
      if (outcome === 'existing') state = 'idempotent_reuse';
      validateExisting(await this.files.read(path));
    } catch (error) {
      if (error instanceof MarketDataRepositoryErrorV1 && error.code === 'artifact_collision') throw error;
      if (recoverable(error)) return failMarketData('artifact_corrupt');
      if (error instanceof CreateOnlyFilePublicationError && error.kind === 'publish_unsupported') {
        return failMarketData('create_only_publish_unsupported');
      }
      // A promotion exception is not proof of absence. Only a complete matching
      // reopened winner permits advancing to the receipt commit point.
      try { validateExisting(await this.files.read(path)); state = 'idempotent_reuse'; }
      catch (reopen) {
        if (reopen instanceof MarketDataRepositoryErrorV1 && reopen.code === 'artifact_collision') throw reopen;
        return failMarketData('artifact_write_failed');
      }
    }
    const artifactIdentity = this.codec.identity(artifact);
    const preimage = { schemaVersion: 'market_data_observation_receipt_v1' as const,
      jobId: job.data, target: this.codec.target, acceptedAt: accepted.data,
      checkedAt: checked.data, artifactIdentity };
    const receipt = validateReceiptV1({ ...preimage, receiptDigest: sha256CanonicalJsonV1(preimage) });
    const observationReceiptIdentity = receiptIdentityV1(receipt);
    const receiptPath = this.files.path(observationReceiptIdentity.rootRelativeIdentity);
    const exactReceipt = (raw: unknown) => {
      if (!same(validateReceiptV1(raw), receipt)) return failMarketData('artifact_collision');
    };
    try {
      await this.create(receiptPath, receipt, exactReceipt, exactReceipt);
      exactReceipt(await this.files.read(receiptPath));
    } catch (error) {
      if (error instanceof MarketDataRepositoryErrorV1 && error.code === 'artifact_collision') throw error;
      try { exactReceipt(await this.files.read(receiptPath)); }
      catch (reopen) {
        if (reopen instanceof MarketDataRepositoryErrorV1 && reopen.code === 'artifact_collision') throw reopen;
        if (error instanceof CreateOnlyFilePublicationError && error.kind === 'publish_unsupported') {
          return failMarketData('create_only_publish_unsupported');
        }
        return failMarketData('artifact_write_failed');
      }
    }
    // Receipt is committed. A cache failure or an older publisher's delayed
    // completion cannot erase it. Resolution, not this candidate, owns latest.
    try { await this.latest(); } catch { /* disposable cache is best effort */ }
    return { state, artifact, artifactIdentity, receipt, observationReceiptIdentity, checkedAt: receipt.checkedAt };
  }

  async latest(): Promise<LatestMarketDataV1<T>> {
    const enumerationStart = this.now();
    const names = await this.files.filenames(this.files.path(`observations/${this.prefix}`));
    const entries = names.map(name => {
      const match = /^(0|[1-9][0-9]*)_([0-9a-f-]+)\.json$/.exec(name);
      if (!match || !Number.isSafeInteger(Number(match[1])) || !StrategyValidationUuidV4Schema.safeParse(match[2]).success
        || !Number.isFinite(new Date(Number(match[1])).getTime())) return failMarketData('repository_unsafe');
      return { name, epoch: Number(match[1]), jobId: match[2]! };
    }).sort((a, b) => b.epoch - a.epoch || (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
    const enumerationMilliseconds = this.now() - enumerationStart;
    if (!Number.isFinite(enumerationMilliseconds) || enumerationMilliseconds < 0) return failMarketData('repository_unavailable');
    if (!entries.length) return failMarketData('artifact_not_found');
    const budget = new MarketDataRecoveryBudgetV1(this.now);
    let fallback = false;
    for (let i = 0; i < entries.length;) {
      const epoch = entries[i]!.epoch;
      let selected: ObservedMarketDataV1<T> | null = null;
      let groupIdentity: MarketDataArtifactIdentityV1 | null = null;
      let groupCorrupt = false;
      while (i < entries.length && entries[i]!.epoch === epoch) {
        const entry = entries[i++]!;
        budget.inspect();
        try {
          const relativeIdentity = `observations/${this.prefix}/${entry.name}`;
          const receipt = validateReceiptV1(await this.files.read(this.files.path(relativeIdentity), budget));
          const observationReceiptIdentity = receiptIdentityV1(receipt);
          if (observationReceiptIdentity.rootRelativeIdentity !== relativeIdentity || !same(receipt.target, this.codec.target)) {
            return failMarketData('artifact_corrupt');
          }
          // A valid receipt already proves the identity it observed, even when
          // its content is now corrupt. Never use fallback to hide a tie conflict.
          if (groupIdentity && !same(groupIdentity, receipt.artifactIdentity)) return failMarketData('latest_resolution_failed');
          groupIdentity ??= receipt.artifactIdentity;
          const artifact = await this.readArtifact(receipt.artifactIdentity, budget);
          selected ??= { artifact, artifactIdentity: receipt.artifactIdentity, receipt,
            observationReceiptIdentity, checkedAt: receipt.checkedAt };
        } catch (error) {
          if (!recoverable(error)) throw error;
          groupCorrupt = true;
        }
      }
      budget.check();
      if (selected && !groupCorrupt) {
        const cache = { schemaVersion: 'market_data_latest_cache_v1',
          observationReceiptIdentity: selected.observationReceiptIdentity, artifactIdentity: selected.artifactIdentity };
        const path = this.files.path(`${this.prefix}/latest.json`);
        try { await (this.options.writeCache ?? ((p, body) => this.files.cache(p, body)))(path, canonicalJsonV1(cache)); }
        catch { /* Never use this cache as evidence of latest. */ }
        return { ...selected, state: fallback ? 'fallback' : 'available',
          warnings: fallback ? [{ code: 'artifact_corrupt_fallback',
            message: '保存済みデータの破損により、直前の検証済み取得履歴を表示しています。',
            moduleId: this.codec.target.kind === 'overview' ? this.codec.target.moduleId : null,
            artifactIdentity: selected.artifactIdentity }] : [],
          diagnostics: { enumeratedReceipts: entries.length, inspectedReceipts: budget.receipts,
            bytesRead: budget.bytes, enumerationMilliseconds } };
      }
      fallback = true;
    }
    return failMarketData('artifact_corrupt');
  }
}
