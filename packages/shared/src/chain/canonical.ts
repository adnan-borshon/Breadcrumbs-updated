/**
 * Deterministic JSON serialisation.
 *
 * Hashing is only meaningful if the same logical value always produces the same bytes.
 * `JSON.stringify` does not guarantee that — key order follows insertion order, so a
 * record rebuilt from a database row can serialise differently from the one that was
 * signed, and the hash would break for no real reason.
 *
 * Everything that gets hashed or signed goes through this function. Nothing in the
 * codebase calls JSON.stringify on chain data directly.
 */

export function canonicalJson(value: unknown): string {
  return serialise(value);
}

function serialise(value: unknown): string {
  if (value === null) return 'null';

  const type = typeof value;

  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new TypeError('canonicalJson: non-finite numbers cannot be canonicalised');
    }
    // JSON.stringify uses the shortest round-tripping representation, which is stable.
    return JSON.stringify(value);
  }

  if (type === 'string' || type === 'boolean') {
    return JSON.stringify(value);
  }

  if (type === 'bigint') {
    throw new TypeError('canonicalJson: bigint cannot be canonicalised');
  }

  if (type === 'undefined' || type === 'function' || type === 'symbol') {
    throw new TypeError(`canonicalJson: ${type} cannot be canonicalised`);
  }

  if (Array.isArray(value)) {
    // Array order is meaningful and is preserved. Undefined holes become null,
    // matching JSON.stringify so a round-trip stays stable.
    return `[${value.map((item) => (item === undefined ? 'null' : serialise(item))).join(',')}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  // Plain object: sort keys, drop undefined values (JSON.stringify omits them too,
  // so dropping here keeps `parse(stringify(x))` canonicalising identically).
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const parts: string[] = [];

  for (const key of keys) {
    const entry = record[key];
    if (entry === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${serialise(entry)}`);
  }

  return `{${parts.join(',')}}`;
}

/**
 * Round-trips a value through canonical form. Used when reading chain data back out of
 * the database, so that whatever the storage layer did to key order is normalised away
 * before the value is hashed again.
 */
export function canonicalise<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

/**
 * Structural equality by canonical form.
 *
 * Used by the commit pipeline to confirm that schema validation did not alter the
 * submitted value — if it did, the signature would no longer cover what gets stored.
 */
export function canJsonEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
