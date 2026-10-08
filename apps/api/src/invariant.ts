/** Fields the Veil database and HTTP API must never accept. */
export const FORBIDDEN_KEYS = [
  "bid_amount",
  "bidAmount",
  "funding_amount",
  "fundingAmount",
  "note_value",
  "noteValue",
  "private_key",
  "privateKey",
  "seed",
  "note_plaintext",
  "notePlaintext",
  "nullifier",
  "real_zcash_nullifier",
  "nk",
  "rho",
  "bid_nonce",
  "bidNonce",
  "funding_nonce",
  "fundingNonce",
] as const;

export function findForbiddenKeys(value: unknown, path = ""): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findForbiddenKeys(item, `${path}[${i}]`));
  }
  if (typeof value !== "object") {
    return [];
  }
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) {
      hits.push(here);
    }
    hits.push(...findForbiddenKeys(child, here));
  }
  return hits;
}
