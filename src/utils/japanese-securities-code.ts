const ALLOWED_SECURITIES_CODE_LETTERS = 'ACDFGHJKLMNPRSTUWXY';

export const JAPANESE_SECURITIES_CODE_PATTERN = new RegExp(
  `^(?:\\d{4}|[1-9](?:[${ALLOWED_SECURITIES_CODE_LETTERS}]\\d[0-9${ALLOWED_SECURITIES_CODE_LETTERS}]|\\d{2}[${ALLOWED_SECURITIES_CODE_LETTERS}]))$`,
);

/** Normalize a syntactically valid JPX four-character code or its J-Quants five-character form. */
export function normalizeJapaneseSecuritiesCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  const canonical = normalized.length === 5 && normalized.endsWith('0')
    ? normalized.slice(0, -1)
    : normalized;

  if (!JAPANESE_SECURITIES_CODE_PATTERN.test(canonical)) {
    throw new Error(`Unsupported Japanese securities code: ${value}`);
  }
  return canonical;
}

/** Convert a validated canonical code to the five-character form required by J-Quants. */
export function toJQuantsSecuritiesCode(value: string): string {
  return `${normalizeJapaneseSecuritiesCode(value)}0`;
}
