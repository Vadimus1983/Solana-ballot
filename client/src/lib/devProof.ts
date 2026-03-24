/**
 * Development-mode ZK proof helpers.
 *
 * The on-chain VK account is not initialized in dev builds, so `cast_vote`
 * skips Groth16 verification entirely. Any 256-byte proof is accepted.
 *
 * `reveal_vote` DOES verify the commit-reveal:
 *   Poseidon(vote_bytes, randomness) == vote_record.vote_commitment
 *
 * Therefore `computeDevCommitment` must produce a value that exactly matches
 * what `poseidon2` returns on-chain (BN254 x5, big-endian, Circom parameters).
 *
 * `register_commitment` requires a valid BN254 field element as the leaf
 * commitment. `generateDevCommitment` produces a safe random value for dev.
 */
import { poseidon2 } from "poseidon-lite";

/** 256-byte dummy proof: proof_a (64) || proof_b (128) || proof_c (64). */
export const DEV_PROOF = new Uint8Array(256);

/** Fixed per-session randomness used in dev mode. */
export const DEV_RANDOMNESS = new Uint8Array(32);

/**
 * Generate a random 32-byte value that is a valid BN254 scalar field element.
 *
 * Strategy: fill bytes [1..31] with random data and leave byte [0] = 0x00.
 * Since BN254_PRIME starts with 0x30, any value whose leading byte is 0x00
 * is strictly less than BN254_PRIME — no rejection sampling needed.
 * Used as the leaf commitment in `register_commitment`.
 */
export function generateDevCommitment(): Uint8Array {
  const result = new Uint8Array(32);
  crypto.getRandomValues(result.subarray(1)); // bytes [1..31] = random
  return result;                              // byte [0] = 0x00 (guaranteed < BN254_PRIME)
}

function bufToBigInt(buf: Uint8Array): bigint {
  return BigInt("0x" + Buffer.from(buf).toString("hex") || "0");
}

function bigIntToBytes(n: bigint): Uint8Array {
  return Buffer.from(n.toString(16).padStart(64, "0"), "hex");
}

/**
 * Compute Poseidon(vote_bytes, randomness) — matches reveal_vote.rs exactly.
 *
 * `vote` is encoded as a 32-byte big-endian field element (last byte = vote,
 * upper 31 bytes = 0). `randomness` is interpreted as a big-endian scalar.
 */
export function computeDevCommitment(vote: 0 | 1, randomness: Uint8Array): Uint8Array {
  const voteField = BigInt(vote);
  const randField = bufToBigInt(randomness);
  const hash = poseidon2([voteField, randField]);
  return bigIntToBytes(hash);
}

/**
 * Generate a random 32-byte nullifier.
 * Must be saved locally so the same nullifier can be used in PDA derivation
 * for reveal_vote (the voter needs the nullifier to find their vote_record PDA).
 */
export function generateDevNullifier(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
