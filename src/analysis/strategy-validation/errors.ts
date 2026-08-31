export type PointInTimeErrorCodeV1 =
  | 'invalid_date'
  | 'invalid_cutoff'
  | 'calendar_incomplete'
  | 'source_response_invalid'
  | 'price_history_incomplete'
  | 'source_envelope_invalid';

export class PointInTimeErrorV1 extends Error {
  readonly code: PointInTimeErrorCodeV1;
  readonly causeValue: unknown;

  constructor(code: PointInTimeErrorCodeV1, message: string, causeValue?: unknown) {
    super(message);
    this.name = 'PointInTimeErrorV1';
    this.code = code;
    this.causeValue = causeValue;
  }
}
