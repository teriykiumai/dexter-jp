import { describe, expect, test } from 'bun:test';
import { selectedTechnicalSource, technicalPath, technicalSelection, type TechnicalLatest } from './technical.js';

describe('Technical presentation selection', () => {
  const latest = { artifact: { dataDate: '2026-09-09' } } as TechnicalLatest;
  test('uses exact date precedence and never substitutes in explicit modes', () => {
    expect(selectedTechnicalSource('auto', '2026-09-08', latest, false)).toBe('latest');
    expect(selectedTechnicalSource('auto', '2026-09-09', latest, false)).toBe('latest');
    expect(selectedTechnicalSource('auto', '2026-09-10', latest, false)).toBe('snapshot');
    expect(selectedTechnicalSource('auto', null, latest, false)).toBe('latest');
    expect(selectedTechnicalSource('auto', '2026-09-10', null, false)).toBe('snapshot');
    expect(selectedTechnicalSource('auto', null, null, false)).toBeNull();
    expect(selectedTechnicalSource('latest', '2026-09-10', null, false)).toBeNull();
    expect(selectedTechnicalSource('snapshot', null, latest, false)).toBeNull();
    expect(selectedTechnicalSource('latest', '2026-09-08', latest, true)).toBe('snapshot');
    expect(selectedTechnicalSource('latest', null, latest, true)).toBeNull();
  });
  test('owns only source/interval and preserves unknown repeated values', () => {
    const search = '?ticker=7203&tab=technical&future=one&future=two&base=a&target=b';
    const path = technicalPath(search, 'interval', 'week');
    expect(path).toContain('future=one&future=two&base=a&target=b');
    expect(technicalSelection(path.slice(1))).toEqual({ source: 'auto', interval: 'week' });
    expect(technicalPath(path.slice(1), 'interval', 'day')).not.toContain('interval');
    expect(technicalPath(search, 'chartSource', 'latest')).toContain('chartSource=latest');
  });
});
