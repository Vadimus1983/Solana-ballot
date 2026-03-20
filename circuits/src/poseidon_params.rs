/// Shared Poseidon configuration for all circuits in this crate.
///
/// All circuits that use Poseidon (Nullifier, VoteCommitment) must use this
/// same configuration so that proofs generated off-chain match the constraints
/// checked in the circuit. Using different parameters would make the hash values
/// differ, causing all proofs to fail verification.
///
/// # Parameters chosen
///
/// These follow the Poseidon paper recommendations for 128-bit security over BN254:
///
/// | Parameter      | Value | Reason                                               |
/// |----------------|-------|------------------------------------------------------|
/// | alpha          | 5     | Smallest x^alpha with gcd(alpha, p-1) = 1 on BN254  |
/// | rate           | 2     | Absorbs 2 field elements per permutation             |
/// | capacity       | 1     | Standard for 128-bit security                        |
/// | full_rounds    | 8     | 4 before + 4 after partial rounds                    |
/// | partial_rounds | 57    | Standard for rate=2 on BN254 (matches Circom/zkSync) |
///
/// Round constants (ark) and MDS matrix are generated deterministically by
/// `find_poseidon_ark_and_mds` using the Grain LFSR — the same algorithm used
/// by the Poseidon reference implementation and Circom's Poseidon hash.
use ark_crypto_primitives::sponge::poseidon::{find_poseidon_ark_and_mds, PoseidonConfig};
use ark_ff::PrimeField;

/// Returns a `PoseidonConfig` suitable for hashing 2 field elements (rate = 2).
///
/// Call this once per circuit instantiation. The config is inexpensive to
/// create — round constants are computed on the fly from the Grain LFSR.
///
/// # Type parameter
///
/// `F` — the prime field. In production this is `ark_bn254::Fr`.
/// Passing a different field will generate the correct parameters for that field,
/// making the function reusable in tests or on other curves.
pub fn poseidon_config<F: PrimeField>() -> PoseidonConfig<F> {
    let full_rounds: usize = 8;
    let partial_rounds: usize = 57;
    let alpha = 5u64;
    let rate: usize = 2;
    let capacity: usize = 1;

    // find_poseidon_ark_and_mds takes u64 for rounds; PoseidonConfig uses usize.
    let (ark, mds) = find_poseidon_ark_and_mds::<F>(
        F::MODULUS_BIT_SIZE as u64,
        rate,               // usize
        full_rounds as u64,
        partial_rounds as u64,
        0u64,
    );

    PoseidonConfig {
        full_rounds,
        partial_rounds,
        alpha,
        ark,
        mds,
        rate,
        capacity,
    }
}
