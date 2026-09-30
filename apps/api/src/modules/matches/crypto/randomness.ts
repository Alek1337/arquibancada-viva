import { createHmac } from "node:crypto";

export const rngAlgorithmVersion = "hmac-sha256-uint32-rejection-v1";
const domain = "match-action-rng-v1";
const scale = 10_000;
export const rngAcceptanceLimit = Math.floor(2 ** 32 / scale) * scale;
export type ActionRandomnessIdentity = Readonly<{
  userId: string;
  matchId: string;
  actionId: string;
  keyVersion: string;
}>;
export type PrivateKeyring = Readonly<Record<string, string>>;

export class MatchRandomnessError extends Error {
  constructor(readonly code: "RNG_KEY_UNAVAILABLE" | "INVALID_RNG_INPUT" | "RNG_EXHAUSTED") {
    super(code);
    this.name = "MatchRandomnessError";
  }
}

/** Length-prefixed UTF-8 fields plus UInt32 expansion counter: no delimiter ambiguity. */
export function canonicalRngMessage(identity: ActionRandomnessIdentity, counter: number): Buffer {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffff_ffff)
    throw new MatchRandomnessError("INVALID_RNG_INPUT");
  const parts: Buffer[] = [];
  for (const value of [
    domain,
    identity.userId,
    identity.matchId,
    identity.actionId,
    identity.keyVersion,
  ]) {
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 1024 ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
    )
      throw new MatchRandomnessError("INVALID_RNG_INPUT");
    const bytes = Buffer.from(value, "utf8");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  const expansion = Buffer.alloc(4);
  expansion.writeUInt32BE(counter);
  return Buffer.concat([...parts, expansion]);
}

/** Internal primitive exposed for deterministic rejection/expansion boundary tests. */
export function sampleFromDigests(digestAt: (counter: number) => Uint8Array): number {
  for (let counter = 0; counter < 1024; counter++) {
    const digest = digestAt(counter);
    if (digest.length !== 32) throw new MatchRandomnessError("INVALID_RNG_INPUT");
    const buffer = Buffer.from(digest);
    for (let offset = 0; offset < 32; offset += 4) {
      const word = buffer.readUInt32BE(offset);
      if (word < rngAcceptanceLimit) return word % scale;
    }
  }
  throw new MatchRandomnessError("RNG_EXHAUSTED");
}

export function deriveActionSample(
  identity: ActionRandomnessIdentity,
  keyring: PrivateKeyring,
): number {
  const key = Object.hasOwn(keyring, identity.keyVersion)
    ? keyring[identity.keyVersion]
    : undefined;
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/u.test(key))
    throw new MatchRandomnessError("RNG_KEY_UNAVAILABLE");
  return sampleFromDigests((counter) =>
    createHmac("sha256", Buffer.from(key, "hex"))
      .update(canonicalRngMessage(identity, counter))
      .digest(),
  );
}

/** Readiness seam; caller must supply versions from all non-terminal durable matches. */
export function assertRequiredRngKeys(
  keyring: PrivateKeyring,
  requiredVersions: readonly string[],
): void {
  for (const version of requiredVersions) {
    if (!Object.hasOwn(keyring, version) || !/^[a-f0-9]{64}$/u.test(keyring[version] ?? ""))
      throw new MatchRandomnessError("RNG_KEY_UNAVAILABLE");
  }
}
