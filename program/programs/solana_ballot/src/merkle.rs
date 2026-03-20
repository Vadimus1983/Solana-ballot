/// On-chain incremental Merkle tree with Poseidon hashing.
///
/// # Poseidon dispatch
///
/// `poseidon2` dispatches based on compilation target:
///
/// - **BPF (`target_os = "solana"`)**: calls the `sol_poseidon` syscall directly
///   via `solana-define-syscall`. The syscall executes inside the Solana runtime,
///   contributing zero bytes to the BPF stack frame.
///
/// - **Native (tests)**: uses `light-poseidon` with the BN254 x5 Circom parameters.
///   No BPF stack limit applies on the host, so the 6 KB parameter initialisation
///   inside `new_circom` is fine.
///
/// Both paths produce identical output because they share the same parameters
/// (BN254 x5, big-endian).
///
/// # Incremental Merkle tree algorithm
///
/// When inserting the n-th leaf:
/// - At each level i, check if the current node is a left child (`n` is even)
///   or a right child (`n` is odd):
///   - Left child: store `current` in `frontier[i]`, then pair with `zeros[i]`
///     to continue computing the root upward.
///   - Right child: pair `frontier[i]` (the stored left sibling) with `current`.
/// - After DEPTH levels, `current` is the new Merkle root.
use anchor_lang::prelude::*;

use crate::constants::{HASH_SIZE, MERKLE_DEPTH};
use crate::error::BallotError;

/// Compute `Poseidon(left, right)` — BN254 x5, big-endian.
///
/// On BPF: invokes the `sol_poseidon` syscall (zero stack allocation).
/// On native: uses `light-poseidon` for compatibility in unit tests.
pub fn poseidon2(left: &[u8; HASH_SIZE], right: &[u8; HASH_SIZE]) -> Result<[u8; HASH_SIZE]> {
    #[cfg(target_os = "solana")]
    {
        use solana_define_syscall::definitions::sol_poseidon;

        let mut hash_result = [0u8; HASH_SIZE];
        // The syscall receives a pointer to a slice of byte-slice fat-pointers.
        // Each fat-pointer is (data_ptr: u64, len: u64) — identical layout to &[u8].
        let vals: &[&[u8]] = &[left.as_ref(), right.as_ref()];
        let rc = unsafe {
            sol_poseidon(
                0,                              // Parameters::Bn254X5
                0,                              // Endianness::BigEndian
                vals as *const _ as *const u8,
                vals.len() as u64,
                hash_result.as_mut_ptr(),
            )
        };
        require!(rc == 0, BallotError::HashError);
        Ok(hash_result)
    }

    #[cfg(not(target_os = "solana"))]
    {
        use ark_bn254::Fr;
        use light_poseidon::{Poseidon, PoseidonBytesHasher};

        let mut hasher = Poseidon::<Fr>::new_circom(2)
            .map_err(|_| error!(BallotError::HashError))?;
        let hash = hasher
            .hash_bytes_be(&[left.as_ref(), right.as_ref()])
            .map_err(|_| error!(BallotError::HashError))?;
        Ok(hash)
    }
}

/// Insert a new leaf into the incremental Merkle tree.
///
/// Updates `frontier` in-place and returns the new Merkle root.
///
/// # Parameters
///
/// - `frontier`   — Rightmost filled node at each level. Stored in `proposal.merkle_frontier`.
/// - `leaf`       — The new leaf hash (voter's commitment).
/// - `leaf_index` — Index of the new leaf = `proposal.voter_count` before incrementing.
///
/// # Errors
///
/// - [`BallotError::TreeFull`] if `leaf_index >= 2^MERKLE_DEPTH`
/// - [`BallotError::HashError`] if a Poseidon invocation fails
pub fn insert_leaf(
    frontier: &mut [[u8; HASH_SIZE]; MERKLE_DEPTH],
    leaf: [u8; HASH_SIZE],
    leaf_index: u64,
) -> Result<[u8; HASH_SIZE]> {
    require!(
        leaf_index < (1u64 << MERKLE_DEPTH),
        BallotError::TreeFull
    );

    let mut current = leaf;
    let mut index = leaf_index;
    // zeros[i] = Poseidon(zeros[i-1], zeros[i-1]); computed lazily level by level.
    // zeros[0] = [0u8; 32] (empty leaf).
    let mut zero = [0u8; HASH_SIZE];

    for i in 0..MERKLE_DEPTH {
        if index % 2 == 0 {
            // Left child: pair current with the zero subtree at this level.
            frontier[i] = current;
            current = poseidon2(&current, &zero)?;
        } else {
            // Right child: pair with the stored left sibling.
            current = poseidon2(&frontier[i], &current)?;
        }
        // Advance zero to the next level: zeros[i+1] = Poseidon(zeros[i], zeros[i]).
        // Skipped on the last iteration — no level i+1 exists.
        if i + 1 < MERKLE_DEPTH {
            zero = poseidon2(&zero, &zero)?;
        }
        index >>= 1;
    }

    Ok(current)
}
