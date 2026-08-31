export type StrictJsonErrorKindV1 =
  | 'input_too_large'
  | 'invalid_utf8'
  | 'bom_not_allowed'
  | 'malformed_json'
  | 'duplicate_object_key';

export class StrictJsonErrorV1 extends Error {
  constructor(public readonly kind: StrictJsonErrorKindV1) {
    const messages: Readonly<Record<StrictJsonErrorKindV1, string>> = {
      input_too_large: 'The JSON input exceeds its byte limit.',
      invalid_utf8: 'The JSON input is not valid UTF-8.',
      bom_not_allowed: 'A UTF-8 BOM is not allowed.',
      malformed_json: 'The JSON input is malformed.',
      duplicate_object_key: 'The JSON input contains a duplicate object key.',
    };
    super(messages[kind]);
    this.name = 'StrictJsonErrorV1';
  }
}

class StrictJsonParserV1 {
  #offset = 0;

  constructor(private readonly input: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.#offset !== this.input.length) this.fail('malformed_json');
    return value;
  }

  private parseValue(depth: number): unknown {
    if (depth > 128) this.fail('malformed_json');
    const character = this.input[this.#offset];
    if (character === '"') return this.parseString();
    if (character === '{') return this.parseObject(depth + 1);
    if (character === '[') return this.parseArray(depth + 1);
    if (character === 't') return this.parseLiteral('true', true);
    if (character === 'f') return this.parseLiteral('false', false);
    if (character === 'n') return this.parseLiteral('null', null);
    return this.parseNumber();
  }

  private parseObject(depth: number): Readonly<Record<string, unknown>> {
    this.#offset += 1;
    this.skipWhitespace();
    const value: Record<string, unknown> = {};
    const keys = new Set<string>();
    if (this.input[this.#offset] === '}') {
      this.#offset += 1;
      return value;
    }
    while (this.#offset < this.input.length) {
      if (this.input[this.#offset] !== '"') this.fail('malformed_json');
      const key = this.parseString();
      if (keys.has(key)) this.fail('duplicate_object_key');
      keys.add(key);
      this.skipWhitespace();
      if (this.input[this.#offset] !== ':') this.fail('malformed_json');
      this.#offset += 1;
      this.skipWhitespace();
      Object.defineProperty(value, key, {
        value: this.parseValue(depth),
        configurable: true,
        enumerable: true,
        writable: true,
      });
      this.skipWhitespace();
      const separator = this.input[this.#offset];
      if (separator === '}') {
        this.#offset += 1;
        return value;
      }
      if (separator !== ',') this.fail('malformed_json');
      this.#offset += 1;
      this.skipWhitespace();
    }
    return this.fail('malformed_json');
  }

  private parseArray(depth: number): readonly unknown[] {
    this.#offset += 1;
    this.skipWhitespace();
    const value: unknown[] = [];
    if (this.input[this.#offset] === ']') {
      this.#offset += 1;
      return value;
    }
    while (this.#offset < this.input.length) {
      value.push(this.parseValue(depth));
      this.skipWhitespace();
      const separator = this.input[this.#offset];
      if (separator === ']') {
        this.#offset += 1;
        return value;
      }
      if (separator !== ',') this.fail('malformed_json');
      this.#offset += 1;
      this.skipWhitespace();
    }
    return this.fail('malformed_json');
  }

  private parseString(): string {
    const start = this.#offset;
    this.#offset += 1;
    while (this.#offset < this.input.length) {
      const character = this.input[this.#offset]!;
      if (character === '"') {
        this.#offset += 1;
        try {
          return JSON.parse(this.input.slice(start, this.#offset)) as string;
        } catch {
          return this.fail('malformed_json');
        }
      }
      if (character === '\\') {
        this.#offset += 1;
        const escape = this.input[this.#offset];
        if (escape === 'u') {
          const code = this.input.slice(this.#offset + 1, this.#offset + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(code)) this.fail('malformed_json');
          this.#offset += 5;
          continue;
        }
        if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
          this.fail('malformed_json');
        }
      } else {
        if (character.charCodeAt(0) <= 0x1f) this.fail('malformed_json');
      }
      this.#offset += 1;
    }
    return this.fail('malformed_json');
  }

  private parseNumber(): number {
    const remaining = this.input.slice(this.#offset);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(remaining);
    if (match === null) return this.fail('malformed_json');
    this.#offset += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.fail('malformed_json');
    return value;
  }

  private parseLiteral<T>(literal: string, value: T): T {
    if (!this.input.startsWith(literal, this.#offset)) this.fail('malformed_json');
    this.#offset += literal.length;
    return value;
  }

  private skipWhitespace(): void {
    while (' \t\r\n'.includes(this.input[this.#offset] ?? '\0')) this.#offset += 1;
  }

  private fail(kind: StrictJsonErrorKindV1): never {
    throw new StrictJsonErrorV1(kind);
  }
}

export function parseStrictJsonBytesV1(
  input: Uint8Array,
  maximumBytes: number,
): unknown {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError('maximumBytes must be a non-negative safe integer.');
  }
  if (input.byteLength > maximumBytes) throw new StrictJsonErrorV1('input_too_large');
  if (input.byteLength >= 3
    && input[0] === 0xef
    && input[1] === 0xbb
    && input[2] === 0xbf) {
    throw new StrictJsonErrorV1('bom_not_allowed');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new StrictJsonErrorV1('invalid_utf8');
  }
  return new StrictJsonParserV1(text).parse();
}
