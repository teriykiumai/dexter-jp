import { describe, expect, test } from 'bun:test';
import {
  STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES,
  digestStrategyValidationCampaignManifestV1,
  digestStrategyValidationInputV1,
  parseStrategyValidationCampaignJsonV1,
  validateStrategyValidationCampaignManifestV1,
  validateStrategyValidationInputV1,
} from './index.js';

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function manifest(anchorCount = 1, referenceCount = 0) {
  return {
    schemaVersion: 'strategy_validation_campaign_v1',
    name: '検証キャンペーン',
    anchors: Array.from({ length: anchorCount }, (_, index) => ({
      ticker: String(7203 + index).padStart(4, '0'),
      anchorDate: '2025-03-31',
      resistanceEvidence: Array.from({ length: referenceCount }, (_, reference) => ({
        kind: 'analysis_snapshot',
        snapshotId: `2025-01-${String(reference + 1).padStart(2, '0')}T00-00-00-000Z`,
      })),
    })),
  };
}

describe('Strategy-validation campaign manifest V1', () => {
  test('accepts the exact 1/500-anchor and 0/8-reference boundaries', () => {
    expect(validateStrategyValidationCampaignManifestV1(manifest(1, 0), {}).anchors).toHaveLength(1);
    const maximum = validateStrategyValidationCampaignManifestV1(manifest(500, 8), {});
    expect(maximum.anchors).toHaveLength(500);
    expect(maximum.anchors[0]?.resistanceEvidence).toHaveLength(8);
    expect(() => validateStrategyValidationCampaignManifestV1(manifest(501), {}))
      .toThrow('strict schema');
    expect(() => validateStrategyValidationCampaignManifestV1(manifest(1, 9), {}))
      .toThrow('strict schema');
  });

  test('normalizes the name to NFC and rejects unsafe names and unknown fields', () => {
    const decomposed = { ...manifest(), name: 'カ\u3099' };
    expect(validateStrategyValidationCampaignManifestV1(decomposed, {}).name).toBe('ガ');
    for (const name of ['', '.', '..', 'C:\\secret', '/private', 'safe\u0000name', 'sk-proj-abcdefghijklmnop']) {
      expect(() => validateStrategyValidationCampaignManifestV1({ ...manifest(), name }, {}))
        .toThrow('unsafe');
    }
    expect(() => validateStrategyValidationCampaignManifestV1({ ...manifest(), extra: true }, {}))
      .toThrow('strict schema');
    expect(() => validateStrategyValidationCampaignManifestV1({
      ...manifest(), anchors: [{ ...manifest().anchors[0], extra: true }],
    }, {})).toThrow('strict schema');
  });

  test('rejects duplicate anchor identities independently of manifest order', () => {
    const first = manifest().anchors[0]!;
    expect(() => validateStrategyValidationCampaignManifestV1({
      ...manifest(), anchors: [first, { ...first }],
    }, {})).toThrow('duplicate ticker');
  });

  test('rejects oversize, BOM, invalid UTF-8, malformed JSON, and decoded duplicate keys', () => {
    const valid = JSON.stringify(manifest());
    const exactLimit = `${valid}${' '.repeat(STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES - encode(valid).length)}`;
    expect(parseStrategyValidationCampaignJsonV1(encode(exactLimit), {}).anchors).toHaveLength(1);
    expect(() => parseStrategyValidationCampaignJsonV1(
      new Uint8Array(STRATEGY_VALIDATION_CAMPAIGN_MAX_BYTES + 1), {},
    )).toThrow('exceeds 1 MiB');
    expect(() => parseStrategyValidationCampaignJsonV1(
      new Uint8Array([0xef, 0xbb, 0xbf, ...encode('{}')]), {},
    )).toThrow('BOM');
    expect(() => parseStrategyValidationCampaignJsonV1(new Uint8Array([0xff]), {}))
      .toThrow('UTF-8');
    expect(() => parseStrategyValidationCampaignJsonV1(encode('{"name":}'), {}))
      .toThrow('malformed');
    expect(() => parseStrategyValidationCampaignJsonV1(encode(
      '{"schemaVersion":"strategy_validation_campaign_v1","name":"a","n\\u0061me":"b","anchors":[]}',
    ), {})).toThrow('duplicate object key');
    expect(() => parseStrategyValidationCampaignJsonV1(encode(
      '{"schemaVersion":"strategy_validation_campaign_v1","name":"a","anchors":[],"__proto__":{}}',
    ), {})).toThrow('strict schema');
  });

  test('produces canonical manifest and normalized-input digests', () => {
    const normalized = validateStrategyValidationCampaignManifestV1(manifest(), {});
    expect(digestStrategyValidationCampaignManifestV1(normalized))
      .toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestStrategyValidationCampaignManifestV1({
      anchors: normalized.anchors,
      name: normalized.name,
      schemaVersion: normalized.schemaVersion,
    })).toBe(digestStrategyValidationCampaignManifestV1(normalized));
    const campaignInput = validateStrategyValidationInputV1({
      mode: 'campaign', manifest: normalized,
    }, {});
    const snapshotInput = validateStrategyValidationInputV1({
      mode: 'snapshot', ticker: '7203', snapshotId: '2025-01-01T00-00-00-000Z',
    }, {});
    expect(digestStrategyValidationInputV1(campaignInput))
      .not.toBe(digestStrategyValidationInputV1(snapshotInput));
    expect(() => validateStrategyValidationInputV1({
      mode: 'snapshot', ticker: '../7203', snapshotId: 'latest',
    }, {})).toThrow('strict schema');
  });
});
