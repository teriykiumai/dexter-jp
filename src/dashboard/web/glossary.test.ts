import { describe, expect, test } from 'bun:test';
import {
  DASHBOARD_GLOSSARY,
  DASHBOARD_GLOSSARY_ENTRIES,
  DASHBOARD_GLOSSARY_TERM_IDS,
} from './glossary.js';

describe('Dashboard glossary', () => {
  test('defines every prioritized term exactly once', () => {
    expect(DASHBOARD_GLOSSARY_ENTRIES.map(entry => entry.id))
      .toEqual([...DASHBOARD_GLOSSARY_TERM_IDS]);
    expect(new Set(DASHBOARD_GLOSSARY_ENTRIES.map(entry => entry.id)).size)
      .toBe(DASHBOARD_GLOSSARY_TERM_IDS.length);
  });

  test('keeps the four approved explanation categories as static prose', () => {
    for (const id of DASHBOARD_GLOSSARY_TERM_IDS) {
      const entry = DASHBOARD_GLOSSARY[id];
      expect(entry.id).toBe(id);
      expect(Object.keys(entry)).toEqual([
        'id',
        'label',
        'measures',
        'unitAndReading',
        'limitation',
        'decisionBoundary',
      ]);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.measures.length).toBeGreaterThan(0);
      expect(entry.unitAndReading.length).toBeGreaterThan(0);
      expect(entry.limitation.length).toBeGreaterThan(0);
      expect(entry.decisionBoundary).toBe(
        'この指標だけで買い・売りを判断するものではありません。',
      );
    }
  });
});
