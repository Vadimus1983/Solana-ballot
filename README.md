# Solana-ballot

ZK-powered private voting system for Solana DAOs. Enables anonymous, verifiable, on-chain governance votes using Groth16 proofs and BN254 curve — no trusted tallier required.

---

## Table of Contents

1. [Program Architecture](#program-architecture)
2. [Voting Ceremony & Round Process](#voting-ceremony--round-process)
3. [Roles & Responsibilities](#roles--responsibilities)
4. [On-Chain Cost Reference](#on-chain-cost-reference)
5. [Known Issues](#known-issues)
6. [Pros & Cons vs. Alternatives](#pros--cons-vs-alternatives)
7. [Development Setup](#development-setup)

---

## Program Architecture

### Repository Layout

```
Solana-ballot/
├── circuits/                     # Arkworks R1CS circuit sketches (BN254 / Groth16)
│   └── src/
│       ├── ballot_validity.rs    # vote ∈ {0,1} binary constraint
│       ├── nullifier.rs          # Poseidon(secret_key, proposal_id) == nullifier
│       ├── vote_commitment.rs    # Poseidon(vote, randomness) == commitment
│       ├── merkle_membership.rs  # depth-20 inclusion path → merkle_root
│       └── poseidon_params.rs    # shared Poseidon config (rate-2, alpha-5, BN254)
├── program/                      # Anchor on-chain program (Rust)
│   ├── Anchor.toml
│   ├── programs/solana_ballot/
│   │   └── src/
│   │       ├── constants.rs      # sizes, seeds, timing limits, BN254 scalar prime
│   │       ├── merkle.rs         # incremental Poseidon-2 Merkle tree (depth 20)
│   │       ├── error/            # BallotError enum (25 variants)
│   │       ├── state/            # on-chain account schemas
│   │       │   ├── program_config.rs   # global PDA (authority)
│   │       │   ├── proposal.rs         # Proposal + ProposalStatus
│   │       │   ├── vote.rs             # VoteRecord, NullifierRecord,
│   │       │   │                       # CommitmentRecord, VoterRecord,
│   │       │   │                       # PendingCommitmentRecord
│   │       │   └── vk.rs               # VerificationKeyAccount (Groth16 VK)
│   │       └── instructions/     # 14 instruction handlers
│   └── tests/program.ts          # Anchor integration tests (~1 500 lines)
└── client/                       # React + Vite frontend (TypeScript / Tailwind)
    └── src/
        ├── panels/               # AdminPanel, VoterPanel, ResultsView
        ├── hooks/                # useProgram, useProposal
        └── lib/                  # anchor.ts, pda.ts, devProof.ts
```

### Account Hierarchy

```
ProgramConfig  [global singleton — 1 per program deploy]
└── Proposal   [1 per election]
    ├── VerificationKeyAccount     [1 per proposal — stores Groth16 VK]
    ├── PendingCommitmentRecord    [1 per (proposal, voter) — temporary during registration]
    ├── CommitmentRecord           [1 per (proposal, commitment) — deduplication guard]
    ├── VoterRecord                [1 per (proposal, voter pubkey) — identity guard]
    ├── NullifierRecord            [1 per (proposal, nullifier) — double-vote guard]
    └── VoteRecord                 [1 per (proposal, nullifier) — stores commitment + vote]
```

### Instruction Reference

| # | Instruction | Signer | Phase | Description |
|---|---|---|---|---|
| 1 | `initialize` | Authority | Setup | Creates `ProgramConfig` global PDA |
| 2 | `create_proposal` | Authority | Setup | Creates `Proposal` PDA in `Registration` status |
| 3 | `store_vk` | Authority | Setup | Writes Groth16 VK to `VerificationKeyAccount`; one-write, immutable after |
| 4 | `register_commitment` | Voter | Registration | Voter deposits `PendingCommitmentRecord` with their ZK commitment |
| 5 | `register_voter` | Admin | Registration | Admin reads pending commitment, inserts leaf into Merkle tree, closes `PendingCommitmentRecord` |
| 6 | `open_voting` | Admin | Voting | Transitions proposal to `Voting`; requires VK set and `voter_count > 0` |
| 7 | `cast_vote` | Voter | Voting | Groth16 proof verified on-chain; mints `NullifierRecord` + `VoteRecord` |
| 8 | `close_voting` | Anyone | Reveal | Permissionless after `voting_end` timestamp |
| 9 | `reveal_vote` | Anyone | Reveal | Opens commitment: verifies `Poseidon(vote, randomness) == stored_commitment` |
| 10 | `finalize_tally` | Anyone | Finalize | Locks `yes_count`/`no_count`; callable when all revealed or 24 h grace expired |
| 11 | `close_vote_accounts` | Anyone | Cleanup | Closes `NullifierRecord` + `VoteRecord`; rent to `refund_to` address |
| 12 | `close_commitment_record` | Anyone | Cleanup | Closes `CommitmentRecord` + `VoterRecord`; terminal status required |
| 13 | `close_proposal` | Admin | Cleanup | Closes `Proposal`; requires all vote/commitment accounts closed first |
| 14 | `expire_proposal` | Anyone | Cleanup | Advances stuck `Registration` proposals to `Expired` after `voting_end` |

### ZK Circuit (combined Groth16, BN254)

The combined circuit proves four statements simultaneously within a single Groth16 proof:

| Statement | Constraint | Private inputs | Public inputs |
|---|---|---|---|
| **Nullifier integrity** | `Poseidon(secret_key, proposal_id) == nullifier` | `secret_key` | `nullifier`, `proposal_id` |
| **Vote commitment** | `Poseidon(vote, randomness) == vote_commitment` | `vote`, `randomness` | `vote_commitment` |
| **Binary vote** | `vote × (vote − 1) == 0` | `vote` | — |
| **Merkle membership** | Inclusion path from `commitment` → `merkle_root` | 20 sibling hashes | `merkle_root` |

**Public inputs order on-chain:** `[nullifier, proposal_id, merkle_root, vote_commitment]`

Proof bytes layout passed to `cast_vote`: `proof_a (64 B) ‖ proof_b (128 B) ‖ proof_c (64 B)` = **256 bytes total**.

### Incremental Merkle Tree

- Hash function: **Poseidon-2** (rate-2, alpha-5, BN254 scalar field)
- Depth: **20** → supports up to **2²⁰ = 1 048 576 registered voters**
- Only the **frontier** (rightmost filled node per level, 20 × 32 = 640 bytes) is stored on-chain
- Full tree can be reconstructed off-chain from `VoterRegistered` events
- On BPF target: `sol_poseidon` syscall (avoids BPF stack allocation)
- On native / test target: `light-poseidon` crate

### Key Constants

| Constant | Value | Notes |
|---|---|---|
| `MERKLE_DEPTH` | 20 | Max 1 048 576 voters |
| `MIN_VOTING_DURATION` | 3 600 s (1 h) | Prevents un-openable proposals |
| `MAX_VOTING_DURATION` | 2 592 000 s (30 d) | Caps rent lock duration |
| `REVEAL_GRACE_PERIOD` | 86 400 s (24 h) | Grace window before forced finalize |
| `MAX_VOTING_START_DRIFT` | 60 s | Tolerance for clock skew on `create_proposal` |
| `NUM_PUBLIC_INPUTS` | 4 | Groth16 verifier input count |
| `MAX_TITLE_LEN` | 128 chars | — |
| `MAX_DESCRIPTION_LEN` | 256 chars | — |

---

## Voting Ceremony & Round Process

### Phase 0 — Off-chain Trusted Setup *(one-time per circuit, authority only)*

1. Merge the four separate circuit sketches from `circuits/` into a single `ConstraintSynthesizer`.
2. Run a **Groth16 phase-2 MPC ceremony** to generate a proving key (PK) and verifying key (VK).
3. Serialize the VK into `groth16-solana` byte format (uncompressed BN254, big-endian).
4. Upload the VK on-chain per proposal via `store_vk` (~0.00631 SOL deposit, immutable after write).

> ⚠️ Groth16 requires a trusted setup. A participant who retains the toxic waste can forge proofs. Use an MPC ceremony with sufficient participants to distribute trust.

### Phase 1 — Program Initialization *(one-time per deploy)*

```
Authority → initialize()
```

Creates the global `ProgramConfig` PDA. `PROGRAM_AUTHORITY` in `constants.rs` must be set to the deployer's 32-byte public key before a production build — a compile-time guard rejects all-zero values when built without `--features dev`.

### Phase 2 — Proposal Creation & Voter Registration

```
Authority  →  create_proposal(title, description, voting_start, voting_end)
Authority  →  store_vk(vk_alpha_g1, vk_beta_g2, vk_gamma_g2, vk_delta_g2, vk_ic)

For each eligible voter:
  Voter(i)  →  register_commitment(commitment_i)
  Admin     →  register_voter(voter_i)
```

- The voter computes `commitment = Poseidon(secret_key, randomness)` **off-chain**; `secret_key` never leaves their device.
- The voter's signature is cryptographically embedded in the `PendingCommitmentRecord` PDA — the admin cannot substitute a different commitment.
- Each `register_voter` call updates the on-chain Merkle root and returns the voter's `PendingCommitmentRecord` deposit.

### Phase 3 — Voting

```
Admin      →  open_voting()
Voter(i)   →  cast_vote(proof, nullifier, vote_commitment, refund_to)
               (repeated for every voter wishing to participate)
Anyone     →  close_voting()    ← permissionless after voting_end
```

**Voter's off-chain proof-generation flow:**
1. Compute `nullifier = Poseidon(secret_key, proposal_id)`.
2. Pick `vote ∈ {0=No, 1=Yes}` and a fresh random `randomness`.
3. Compute `vote_commitment = Poseidon(vote, randomness)`.
4. Fetch the current `merkle_root` from the on-chain `Proposal` account.
5. Build a 20-level Merkle inclusion proof for your commitment.
6. Run the Groth16 prover → 256-byte proof.
7. Submit `cast_vote` (requires `SetComputeUnitLimit ≥ 1 400 000 CU`).

On-chain, the program:
- Validates the 256-byte proof against the stored VK and the current Merkle root.
- Mints a `NullifierRecord` (double-vote guard) and a `VoteRecord` (stores commitment, `refund_to`).

### Phase 4 — Vote Reveal & Tally

```
Voter(i)   →  reveal_vote(vote, randomness)
               (each voter opens their commitment within 24 h of voting_end)
Anyone     →  finalize_tally()
               (when all_votes_revealed OR now >= voting_end + 24 h)
```

- `reveal_vote` checks `Poseidon(vote, randomness) == stored_vote_commitment` on-chain.
- Voters who miss the 24-hour reveal window are not counted in `yes_count` or `no_count`. The tally still finalizes via the grace period.

### Phase 5 — Cleanup & Rent Reclaim

```
Anyone     →  close_vote_accounts(nullifier)        ← NullifierRecord + VoteRecord → refund_to
Anyone     →  close_commitment_record(commitment)   ← CommitmentRecord + VoterRecord → admin
Admin      →  close_proposal()                      ← Proposal → admin
                                                       (blocked until all vote/commitment PDAs closed)
```

All account rent is returned to the original payers. `close_proposal` enforces
`closed_vote_count == vote_count` and `closed_commitment_count == voter_count` so no lamports are permanently stranded.

**Expired-proposal path:** if `open_voting` is never called before `voting_end`, anyone may call `expire_proposal` → `Expired` status → same cleanup path, no tally needed.

---

## Roles & Responsibilities

| Role | Who | Can Call |
|---|---|---|
| **Program Authority** | Deployer wallet (`PROGRAM_AUTHORITY`) | `initialize`, `create_proposal`, `store_vk` |
| **Proposal Admin** | Address set at `create_proposal` time (may equal authority) | `register_voter`, `open_voting`, `close_proposal` |
| **Voter** | Any wallet on the eligibility list | `register_commitment`, `cast_vote`, `reveal_vote` |
| **Anyone (permissionless)** | Any funded account | `close_voting`, `finalize_tally`, `close_vote_accounts`, `close_commitment_record`, `expire_proposal` |

> Authority and Admin can be the same key in small deployments, or separated for additional governance hygiene (e.g., multi-sig admin, single-key authority).

---

## On-Chain Cost Reference

Costs are Solana **rent-exempt deposits** — locked while accounts are live, returned on cleanup — except transaction fees which are consumed immediately.

> **Rent approximation:** `deposit ≈ (128 + account_size_bytes) × 6 960 lamports`  
> Run `solana rent <bytes>` against your target cluster for exact figures.

### Account Sizes & Deposits

| Account | Data size | Deposit (approx.) | Payer | Refundable | Returned via |
|---|---|---|---|---|---|
| `ProgramConfig` | 41 B | **~0.00118 SOL** | Authority | ✅ Program lifetime | — |
| `Proposal` | 1 234 B | **~0.00948 SOL** | Admin | ✅ Yes | `close_proposal` → admin |
| `VerificationKeyAccount` | 778 B | **~0.00631 SOL** | Authority | ⚠️ No close instruction | See Known Issues §4 |
| `PendingCommitmentRecord` | 41 B | **~0.00118 SOL** | Voter | ✅ Yes (quickly) | `register_voter` → voter |
| `CommitmentRecord` | 73 B | **~0.00140 SOL** | Admin | ✅ Yes | `close_commitment_record` → admin |
| `VoterRecord` | 10 B | **~0.00096 SOL** | Admin | ✅ Yes | `close_commitment_record` → admin |
| `NullifierRecord` | 73 B | **~0.00140 SOL** | Voter | ✅ Yes | `close_vote_accounts` → `refund_to` |
| `VoteRecord` | 139 B | **~0.00186 SOL** | Voter | ✅ Yes | `close_vote_accounts` → `refund_to` |

### Per-Round Cost Table

Assumes full participation: every registered voter casts a vote and reveals it.  
`cast_vote` compute fees shown at two priority-fee scenarios.

| Cost item | Per voter | **N = 10** | **N = 100** | **N = 1 048 576 (MAX)** |
|---|---|---|---|---|
| **Fixed per proposal (admin/authority) — refundable** | | | | |
| `Proposal` account | — | 0.00948 SOL | 0.00948 SOL | 0.00948 SOL |
| `VerificationKeyAccount` (⚠️) | — | 0.00631 SOL | 0.00631 SOL | 0.00631 SOL |
| **Per voter — admin pays — fully refundable** | | | | |
| `CommitmentRecord` + `VoterRecord` | 0.00236 SOL | 0.02360 SOL | 0.23600 SOL | ~2 474.6 SOL |
| **Per voter — voter pays — fully refundable** | | | | |
| `NullifierRecord` + `VoteRecord` | 0.00326 SOL | 0.03260 SOL | 0.32600 SOL | ~3 418.6 SOL |
| **Transaction fees — non-refundable** | | | | |
| Base tx fees (~6 txs/voter @ 5 000 L each) | ~0.000030 SOL | ~0.00035 SOL | ~0.00305 SOL | ~31.5 SOL |
| Compute: `cast_vote` @ low priority (1 000 µL/CU) | ~0.00140 SOL | ~0.01400 SOL | ~0.14000 SOL | ~1 468 SOL |
| Compute: `cast_vote` @ high priority (10 000 µL/CU) | ~0.01400 SOL | ~0.14000 SOL | ~1.40000 SOL | ~14 680 SOL |
| **Totals** | | | | |
| Total deposits locked during active round | | ~0.073 SOL | ~0.578 SOL | ~5 894 SOL |
| Net non-refundable (low priority) | | ~0.015 SOL | ~0.143 SOL | ~1 500 SOL |
| Net non-refundable (high priority) | | ~0.141 SOL | ~1.403 SOL | ~14 712 SOL |

**Notes:**
- `PendingCommitmentRecord` (0.00118 SOL/voter, voter-paid) is only locked during registration and is excluded from the "total locked" row.
- `cast_vote` requires `SetComputeUnitLimit ≥ 1 400 000 CU`; the Groth16 alt_bn128 pairing syscall alone consumes ~1 M CU. Callers must include a `ComputeBudget` instruction manually.
- Compute fee = `CU_limit × priority_fee_microlamports / 1 000 000`.  At zero congestion (0 µL/CU) compute fees are free; 1 000 µL/CU is a typical mid-priority setting.
- The MAX voter scenario (1 048 576) is theoretically supported by the Merkle tree depth but is financially impractical — the rent deposits alone exceed 5 800 SOL. Realistic DAO elections will operate in the tens-to-thousands range.

---

## Known Issues

### 1. No Combined ZK Circuit Implementation

`circuits/` contains four **separate** R1CS sketches. A single merged `ConstraintSynthesizer` wiring all constraints into one Groth16 circuit has not been written. The trusted-setup tooling — phase-2 ceremony, proving key export, VK serialization to `groth16-solana` big-endian byte format — is also absent from the repository.

### 2. `PROGRAM_AUTHORITY` Is All-Zeros

`constants.rs` sets `pub const PROGRAM_AUTHORITY: [u8; 32] = [0u8; 32];`. A compile-time `const`-assert blocks production builds with this value, but the constant **must be updated** to the deployer's 32-byte public key before any mainnet deployment. Leaving it all-zeros opens a front-running window between program deploy and `initialize`.

### 3. No `close_vk` Instruction

`VerificationKeyAccount` (~0.00631 SOL per proposal) has no corresponding close instruction. Its rent deposit cannot be recovered after the proposal reaches a terminal state. A `close_vk` instruction gated on `proposal.status.is_terminal()` would recover this deposit.

### 4. `cast_vote` Compute Budget Not Requested by the Program

The program does not prepend a `SetComputeUnitLimit` instruction. Callers who omit it will hit the default 200 000 CU budget and receive a `ComputationalBudgetExceeded` error during Groth16 pairing verification (~1.4 M CU required). Client-side tooling must include this instruction explicitly.

### 5. `register_voter` Is Not Batched

The admin must submit one transaction per voter during registration. For hundreds or thousands of voters this creates a serial bottleneck. A batched variant accepting multiple `(voter, commitment)` pairs per call would significantly reduce wall-clock time and admin transaction fees.

### 6. No Voter Notification Mechanism

Voters must poll the `Proposal` account (or subscribe via WebSocket account-change notifications) to detect the transition to `Voting` status. There is no event indexed by voter identity or push-notification infrastructure.

### 7. Voters Who Miss the Reveal Window Are Silently Excluded

A voter who casts a vote but does not call `reveal_vote` within the 24-hour grace period after `voting_end` is permanently excluded from the tally. The on-chain discrepancy between `vote_count` and `yes_count + no_count` is the only signal. No warning or retry mechanism exists.

### 8. Binary (Yes/No) Votes Only

The circuit enforces `vote ∈ {0, 1}`. Multi-choice, ranked-choice, or token-weighted voting require circuit changes and a new trusted-setup ceremony.

### 9. Merkle Root Is Snapshot-Based at Proof Time

The `merkle_root` in the `Proposal` account reflects the state after the last `register_voter` call. A voter who generates their Groth16 proof before the final batch of registrations is processed will hold a stale root and their proof will fail on-chain. Voters must fetch the root immediately before generating their proof.

### 10. VK Is Immutable After `store_vk`

`store_vk` is a one-write, no-replace instruction. If the wrong VK is uploaded (e.g., a test key, or a key for the wrong circuit), the proposal is unrecoverable — no vote can ever pass verification. The only remedy is to expire the proposal and start a new one.

### 11. Migration Script Is a Stub

`program/migrations/deploy.ts` contains no deployment logic. Production deployment steps (initialize, create_proposal, store_vk) must be performed manually via CLI or a custom script.

---

## Pros & Cons vs. Alternatives

| Criterion | **Solana-ballot** | Snapshot | SPL Realms | Helios (Ethereum) | Semaphore (Ethereum) | **MACI (Ethereum)** |
|---|---|---|---|---|---|---|
| **Vote privacy** | ✅ Full ZK (commitment + nullifier) | ❌ Public | ❌ Public | ✅ Full ZK | ✅ Full ZK | ⚠️ Coordinator-private ‡ |
| **On-chain settlement** | ✅ Fully on-chain | ❌ Off-chain | ✅ On-chain | ✅ On-chain | ✅ On-chain | ✅ Tally + ZK proof on-chain |
| **Trustless tally** | ✅ No tallier needed | ❌ Relies on Snapshot | ✅ No tallier | ✅ No tallier | ✅ No tallier | ⚠️ Coordinator required (can censor, cannot forge) |
| **Anti-collusion / bribery resistance** | ❌ No key-change mechanism | ❌ No | ❌ No | ❌ No | ❌ No | ✅ Core feature — voters can re-key to override sold votes |
| **Trusted setup required** | ⚠️ Yes (Groth16 ceremony) | ❌ None | ❌ None | ⚠️ Yes | ⚠️ Yes | ⚠️ Yes (Groth16, coordinator circuit) |
| **Rent / gas recovery** | ✅ Near 100 % (rent refunded) | N/A | Partial | ❌ Gas burned | ❌ Gas burned | ❌ Gas burned |
| **Tx cost to cast a vote** | ~$0.002–$0.15 † | Free | ~$0.001 | ~$5–$50 | ~$5–$50 | ~$1–$30 (L1); ~$0.01–$1 (L2) |
| **Finality** | ~400 ms | Minutes | ~400 ms | ~12 s | ~12 s | ~12 s (L1); faster on L2 |
| **Double-vote prevention** | ✅ On-chain nullifier | ⚠️ Signature weight | ✅ Token weight | ✅ On-chain nullifier | ✅ On-chain nullifier | ✅ MACI keypair state tree (last vote wins) |
| **Multi-choice voting** | ❌ Binary only | ✅ Multi-choice | ✅ Multi-choice | Depends on circuit | ❌ Binary only | ✅ Yes (incl. quadratic voting) |
| **Admin voter registration** | ⚠️ Required (serial) | ❌ Any token holder | ❌ Token-gated | Depends | Depends | ⚠️ Required (coordinator signs up voters) |
| **Browser proof generation** | ⚠️ Heavy (Groth16 WASM) | ✅ Native | N/A | ⚠️ Heavy | ⚠️ Heavy | ⚠️ Voter tx is lightweight; coordinator handles heavy proving |
| **Audit trail** | ✅ Nullifiers + proofs on-chain | ❌ Off-chain sigs | ✅ On-chain (public votes) | ✅ On-chain | ✅ On-chain | ✅ Encrypted messages + ZK tally proof on-chain |
| **Maturity** | 🚧 Pre-production | ✅ Production | ✅ Production | ✅ Production | ✅ Production | ✅ Production (Gitcoin Grants, clr.fund) |

† At base fees only (~0 priority) the cost approaches $0.0015; at moderate priority fees (~0.001–0.01 SOL) it is $0.15–$1.50 at $150/SOL.

‡ MACI encrypts votes to the coordinator's public key. Individual voters are anonymous to the public, but the coordinator can decrypt and read all plaintext votes. ZK circuits prove the coordinator tallied correctly without manipulation, but voter-level privacy against the coordinator is not guaranteed.

### When to choose Solana-ballot

- Voter anonymity is a hard requirement (board elections, sensitive governance, whistleblower votes).
- You need fully on-chain, trustless tallying with no central operator.
- Solana's throughput (~65 000 TPS) and sub-second finality are important.
- Rent economics matter — nearly all locked SOL is returned after the round.
- Your team can run or participate in a Groth16 trusted-setup ceremony.

### When to choose an alternative

- **Simplicity & voter UX** outweigh privacy → **Snapshot** or **SPL Realms**.
- You need multi-choice or token-weighted voting today → **SPL Realms**, **Snapshot**, or **MACI**.
- You cannot maintain ZK proving infrastructure → **Snapshot**.
- **Bribery or vote-selling resistance** is the primary threat model → **MACI** (its re-keying mechanism is specifically designed for this; Solana-ballot has no equivalent).
- Your protocol is already on Ethereum and gas cost is acceptable → **MACI**, **Helios**, or **Semaphore**.

---

## Development Setup

### Prerequisites

| Tool | Version |
|---|---|
| Rust | `1.89.0` (via `rustup`; see `program/rust-toolchain.toml`) |
| Solana CLI | ≥ 2.x |
| Anchor CLI | `0.32.0` |
| Node.js | ≥ 20 |
| Yarn | any recent |

### Build & Test (dev mode — proof bypass enabled)

```bash
cd program
anchor build --features dev
anchor test --features dev
```

### Run the React Client

```bash
cd client
yarn install
yarn dev
```

### Production Build Checklist

1. Set `PROGRAM_AUTHORITY` in `program/programs/solana_ballot/src/constants.rs` to your 32-byte deployer public key.
2. Complete the trusted-setup ceremony; serialize the VK to `groth16-solana` format.
3. `anchor build` (without `--features dev`) — the compile-time guard will block if step 1 was skipped.
4. Deploy: `anchor deploy`.
5. Call `initialize`, `create_proposal`, and `store_vk` via CLI or a custom migration script.

### Program ID

```
2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ
```

*(localnet / devnet reference; regenerate for mainnet with `anchor keys sync`)*
