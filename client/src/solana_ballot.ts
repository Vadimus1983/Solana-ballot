/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/solana_ballot.json`.
 */
export type SolanaBallot = {
  "address": "2h52sCAKhKtBFdyTfa3XamcWXkZB6M3D7XknNNfkQivZ",
  "metadata": {
    "name": "solanaBallot",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "ZK-powered private voting system for Solana DAOs"
  },
  "instructions": [
    {
      "name": "castVote",
      "docs": [
        "Casts a private vote using a ZK proof.",
        "The voter proves eligibility and ballot validity without revealing their identity or vote.",
        "A nullifier is stored on-chain to prevent the same voter from voting twice.",
        "",
        "# Parameters",
        "- `proof`           — Groth16 proof components concatenated:",
        "`proof_a (64 B) || proof_b (128 B) || proof_c (64 B)` = 256 bytes.",
        "Passed as `Vec<u8>` so Borsh heap-allocates the bytes, keeping",
        "the dispatcher's BPF stack frame within Solana's 4096-byte limit.",
        "- `nullifier`       — Public unique value derived from `Poseidon(secret_key, proposal_id)`.",
        "Stored on-chain to prevent double voting.",
        "- `vote_commitment` — `Poseidon(vote, randomness)` — hides the vote until reveal phase.",
        "",
        "Rent recovery: the voter's Solana signing key (`voter` account) is automatically",
        "stored as the refund destination. `close_vote_accounts` will route the",
        "NullifierRecord + VoteRecord rent back to that address — MEV bots cannot",
        "redirect it. Voters who want to avoid linking their Solana identity to their",
        "nullifier should use a fresh ephemeral Solana keypair for this call; the ZK",
        "proof is fully independent of the Solana signing key.",
        "",
        "Note: `merkle_root` is read from `proposal.merkle_root`, not supplied by the client.",
        "A proof generated against a stale root will fail on-chain verification."
      ],
      "discriminator": [
        20,
        212,
        15,
        189,
        69,
        180,
        69,
        151
      ],
      "accounts": [
        {
          "name": "voter",
          "writable": true,
          "signer": true
        },
        {
          "name": "proposal",
          "docs": [
            "Verified to be a program-derived Proposal account via seeds + bump.",
            "Prevents a forged account from being passed as the proposal.",
            "Heap-boxed so the ~1 200-byte Proposal struct is allocated on the heap",
            "rather than the BPF stack, keeping the frame within Solana's 4 096-byte limit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "vkAccount",
          "docs": [
            "Per-proposal Groth16 VK PDA. Scoped to this proposal so a bad key on",
            "one election cannot affect another. Using a typed account with the stored",
            "bump avoids `find_program_address` re-derivation and is consistent with",
            "every other PDA in the program. The `is_initialized` constraint enforces",
            "that `store_vk` was called before any vote is accepted, in both dev and prod."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              }
            ]
          }
        },
        {
          "name": "nullifierRecord",
          "docs": [
            "`init_if_needed` recovers a pre-funded (squatted) PDA transparently.",
            "Genuine double-vote attempts are caught by the handler's",
            "`NullifierAlreadyUsed` guard on `nullifier_record.nullifier`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  117,
                  108,
                  108,
                  105,
                  102,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "arg",
                "path": "nullifier"
              }
            ]
          }
        },
        {
          "name": "voteRecord",
          "docs": [
            "`init_if_needed` recovers a pre-funded (squatted) PDA transparently.",
            "Genuine double-vote attempts are caught by the handler's",
            "`NullifierAlreadyUsed` guard on `vote_record.vote_commitment`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "arg",
                "path": "nullifier"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "proof",
          "type": "bytes"
        },
        {
          "name": "nullifier",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "voteCommitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "refundTo",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "closeCommitmentRecord",
      "docs": [
        "Closes a single CommitmentRecord PDA for a finalized proposal,",
        "returning the rent-exempt lamports to the caller.",
        "Permissionless — any account may reclaim rent after finalization.",
        "The commitment value is read from the account itself; no parameter needed."
      ],
      "discriminator": [
        181,
        93,
        232,
        234,
        76,
        41,
        132,
        181
      ],
      "accounts": [
        {
          "name": "closer",
          "docs": [
            "Pays the transaction fee and receives the reclaimed lamports."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "proposal",
          "docs": [
            "Proposal must be Finalized before commitment records can be reclaimed.",
            "Marked `mut` so the handler can increment `closed_commitment_count`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "commitmentRecord",
          "docs": [
            "Seeds are derived from `commitment_record.commitment` — the value stored",
            "at registration time. Anchor re-derives the expected PDA from those bytes",
            "and compares it to this account's address: a wrong account simply fails",
            "to load, so no additional cross-check constraint is needed."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "commitment_record.commitment",
                "account": "commitmentRecord"
              }
            ]
          }
        },
        {
          "name": "voterRecord",
          "docs": [
            "Identity uniqueness guard for the voter who registered this commitment.",
            "Derived from the voter pubkey stored in `commitment_record.voter` — no",
            "off-chain data needed. Closed atomically so rent is fully reclaimed in",
            "one transaction and no orphaned VoterRecord accounts can remain."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "commitment_record.voter",
                "account": "commitmentRecord"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeProposal",
      "docs": [
        "Closes a finalized Proposal account, returning rent to the admin.",
        "All vote accounts and commitment records must be closed first via",
        "`close_vote_accounts` and `close_commitment_record`."
      ],
      "discriminator": [
        213,
        178,
        139,
        19,
        50,
        191,
        82,
        245
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeVoteAccounts",
      "docs": [
        "Closes one NullifierRecord + VoteRecord pair for a finalized proposal,",
        "returning the rent-exempt lamports to the caller.",
        "Permissionless — any account may reclaim rent after finalization."
      ],
      "discriminator": [
        225,
        140,
        129,
        85,
        123,
        74,
        227,
        35
      ],
      "accounts": [
        {
          "name": "closer",
          "docs": [
            "Pays the transaction fee."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "refundTo",
          "docs": [
            "Receives the reclaimed lamports from both closed accounts.",
            "",
            "If the voter designated a `refund_to` address in their VoteRecord, this",
            "account must match it exactly. If the voter left `refund_to` unset",
            "(`Pubkey::default()`), this must equal `closer` — any caller may then",
            "direct the rent to themselves, preserving permissionless cleanup.",
            ""
          ],
          "writable": true
        },
        {
          "name": "proposal",
          "docs": [
            "Proposal must be Finalized before vote records can be reclaimed.",
            "Marked `mut` so the handler can increment `closed_vote_count`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "nullifierRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  117,
                  108,
                  108,
                  105,
                  102,
                  105,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "nullifier_record.nullifier",
                "account": "nullifierRecord"
              }
            ]
          }
        },
        {
          "name": "voteRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "vote_record.nullifier",
                "account": "voteRecord"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeVoting",
      "docs": [
        "Closes the voting period. No more votes can be cast after this.",
        "Transitions the proposal from Voting → Closed.",
        "",
        "Permissionless — callable by any account once `voting_end` has passed.",
        "This prevents the admin from blocking finalization by disappearing after",
        "the election period ends. The time-lock (`voting_has_ended`) ensures the",
        "window cannot be closed early."
      ],
      "discriminator": [
        148,
        200,
        139,
        134,
        50,
        55,
        60,
        216
      ],
      "accounts": [
        {
          "name": "closer",
          "docs": [
            "Any account may close voting once voting_end has passed."
          ],
          "signer": true
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "createProposal",
      "docs": [
        "Creates a new voting proposal.",
        "Only the admin who calls this can manage the proposal lifecycle.",
        "",
        "# Parameters",
        "- `title`        — Short label for the proposal (max 128 chars). First 32 bytes used as PDA seed.",
        "- `description`  — Full description of what is being voted on (max 256 chars).",
        "- `voting_start` — Unix timestamp when voters can start casting votes.",
        "- `voting_end`   — Unix timestamp after which no more votes are accepted."
      ],
      "discriminator": [
        132,
        116,
        68,
        174,
        216,
        160,
        198,
        22
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "programConfig",
          "docs": [
            "Only the program authority may create proposals."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "proposal",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "votingStart",
          "type": "i64"
        },
        {
          "name": "votingEnd",
          "type": "i64"
        }
      ]
    },
    {
      "name": "expireProposal",
      "docs": [
        "Transitions a Registration proposal to Expired after its voting window",
        "elapses without the admin calling open_voting.",
        "",
        "Permissionless — any account may call this once `voting_end` has passed.",
        "After expiry, `close_commitment_record` and `close_proposal` reclaim all rent."
      ],
      "discriminator": [
        21,
        237,
        43,
        176,
        1,
        202,
        146,
        144
      ],
      "accounts": [
        {
          "name": "caller",
          "docs": [
            "Pays the transaction fee — any account may trigger expiry."
          ],
          "signer": true
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "finalizeTally",
      "docs": [
        "Finalizes the tally and marks the proposal as complete.",
        "Emits a `ProposalFinalized` event with the final yes/no counts.",
        "Transitions the proposal from Closed → Finalized.",
        "",
        "Permissionless — any account may finalize once all votes are revealed",
        "or the reveal grace period has expired. This mirrors the design of",
        "`close_voting`: the admin cannot block finalization by disappearing",
        "after the election ends."
      ],
      "discriminator": [
        72,
        47,
        105,
        182,
        37,
        98,
        194,
        176
      ],
      "accounts": [
        {
          "name": "finalizer",
          "docs": [
            "Any account may finalize once all votes are revealed or the grace period expires."
          ],
          "signer": true
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "One-time program initialization called by the deployer.",
        "No accounts are created — serves as a deployment smoke test."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "programConfig",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openVoting",
      "docs": [
        "Opens voting for a proposal, transitioning it from Registration → Voting.",
        "",
        "After this call, voters can submit ZK proofs via `cast_vote`.",
        "The Merkle root is frozen at this point — no further voter registrations",
        "are accepted, ensuring the eligibility tree is fixed for all proofs.",
        "",
        "# Guards",
        "- Caller must be the proposal admin.",
        "- Proposal must be in `Registration` status.",
        "- Current time must be within the configured voting window.",
        "- At least one voter must be registered."
      ],
      "discriminator": [
        19,
        116,
        149,
        128,
        154,
        243,
        221,
        5
      ],
      "accounts": [
        {
          "name": "admin",
          "docs": [
            "The proposal admin. Must match `proposal.admin`."
          ],
          "signer": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "docs": [
            "The proposal being transitioned to Voting status.",
            "Verified to be owned by `admin` via `has_one`.",
            "Heap-boxed to keep the BPF stack frame within Solana's 4 096-byte limit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "vkAccount",
          "docs": [
            "Per-proposal Groth16 VK PDA. Scoped to this proposal so a bad key on",
            "one election cannot affect another. Using a typed account with the stored",
            "bump avoids the `find_program_address` call that dynamic bump re-derivation",
            "requires, and is consistent with every other PDA in the program.",
            "In production the handler checks `is_initialized`; dev builds skip it."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "registerCommitment",
      "docs": [
        "Step 1 of the two-phase voter registration protocol.",
        "",
        "The voter calls this instruction (signed by their own wallet) to deposit",
        "their Poseidon commitment `C = Poseidon(secret_key, randomness)` into a",
        "`PendingCommitmentRecord` PDA seeded by `(proposal, voter_pubkey)`.",
        "",
        "Because the PDA address is derived from the voter's public key, the admin",
        "cannot substitute a different commitment in step 2 (`register_voter`):",
        "they must pass exactly this PDA, which holds exactly what the voter signed.",
        "",
        "# Parameters",
        "- `commitment` — 32-byte Poseidon hash of the voter's secret key and randomness."
      ],
      "discriminator": [
        255,
        61,
        47,
        193,
        196,
        213,
        24,
        136
      ],
      "accounts": [
        {
          "name": "voter",
          "docs": [
            "The voter submitting their commitment. Must sign so the PDA is",
            "cryptographically bound to this wallet's public key."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "proposal",
          "docs": [
            "Proposal must be in Registration phase.",
            "Heap-boxed to keep the BPF stack frame within Solana's 4 096-byte limit."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "pendingCommitment",
          "docs": [
            "Stores the voter's commitment until the admin calls `register_voter`.",
            "`init_if_needed` recovers squatted PDAs; genuine re-submissions are caught",
            "by the handler's `CommitmentAlreadyRegistered` guard above.",
            "Seeded by `(proposal, voter)` — embeds the voter's identity in the PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "commitment",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "registerVoter",
      "docs": [
        "Step 2 of the two-phase voter registration protocol.",
        "",
        "The admin calls this instruction to insert the voter's commitment (read",
        "from `PendingCommitmentRecord`) into the eligibility Merkle tree.",
        "The `PendingCommitmentRecord` is closed atomically, returning rent to the voter.",
        "",
        "No `commitment` parameter — the commitment is read from the account the voter",
        "created in `register_commitment`. This prevents admin substitution.",
        "",
        "Voters must register before voting opens — they cannot register retroactively."
      ],
      "discriminator": [
        229,
        124,
        185,
        99,
        118,
        51,
        226,
        6
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "voter",
          "docs": [
            "The voter being registered. Not required to sign here — their commitment",
            "was already bound to this pubkey when they called `register_commitment`",
            "(which required their signature). The admin cannot swap in a different",
            "voter pubkey without also producing a different `pending_commitment` PDA,",
            "which must have been created by that voter's signature.",
            "",
            "Marked `mut` so it can receive the `pending_commitment` rent refund."
          ],
          "writable": true
        },
        {
          "name": "proposal",
          "docs": [
            "Heap-boxed so the ~1 200-byte Proposal struct is allocated on the heap",
            "rather than the BPF stack, keeping the frame within Solana's 4 096-byte limit."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "pendingCommitment",
          "docs": [
            "The PendingCommitmentRecord created by the voter in `register_commitment`.",
            "Closed here — rent returned to `voter`. Reading `.commitment` before",
            "closure is the canonical way to hand off voter-controlled data to the admin.",
            "",
            "Must appear BEFORE `commitment_record` in this struct because Anchor",
            "evaluates seeds constraints top-to-bottom: `commitment_record` seeds",
            "reference `pending_commitment.commitment`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "commitmentRecord",
          "docs": [
            "Commitment uniqueness guard. `init_if_needed` recovers a pre-funded (squatted)",
            "PDA transparently; genuine duplicate calls are caught by the handler's",
            "`CommitmentAlreadyRegistered` guard on `commitment_record.commitment`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  109,
                  109,
                  105,
                  116,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "pending_commitment.commitment",
                "account": "pendingCommitmentRecord"
              }
            ]
          }
        },
        {
          "name": "voterRecord",
          "docs": [
            "Identity uniqueness guard. `init_if_needed` recovers a pre-funded (squatted)",
            "PDA transparently; genuine double-registration attempts are caught by the",
            "handler's `VoterAlreadyRegistered` guard on `voter_record.is_initialized`."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "voter"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "revealVote",
      "docs": [
        "Reveals a previously cast vote after voting has closed.",
        "The voter provides their plaintext vote and randomness.",
        "The program verifies `Poseidon(vote, randomness) == stored vote_commitment`.",
        "Once verified, the vote is counted toward the tally.",
        "",
        "# Parameters",
        "- `vote`       — The plaintext vote: 0 (no) or 1 (yes).",
        "- `randomness` — The 32-byte randomness used when computing the vote commitment."
      ],
      "discriminator": [
        100,
        157,
        139,
        17,
        186,
        75,
        185,
        149
      ],
      "accounts": [
        {
          "name": "revealer",
          "docs": [
            "Any account may reveal a vote — anonymity is preserved because no voter",
            "identity is stored on-chain. The commitment check is the authorization."
          ],
          "signer": true
        },
        {
          "name": "proposal",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  112,
                  111,
                  115,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "proposal.admin",
                "account": "proposal"
              },
              {
                "kind": "account",
                "path": "proposal.title_seed",
                "account": "proposal"
              }
            ]
          }
        },
        {
          "name": "voteRecord",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  111,
                  116,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              },
              {
                "kind": "account",
                "path": "vote_record.nullifier",
                "account": "voteRecord"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "vote",
          "type": "u8"
        },
        {
          "name": "randomness",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "storeVk",
      "docs": [
        "Stores the Groth16 verifying key on-chain for a specific proposal.",
        "",
        "Must be called once by the program authority before `open_voting`.",
        "The VK is scoped per-proposal (seeded by the proposal's on-chain address)",
        "so a compromised or incorrectly generated key affects only that one election.",
        "Circuit upgrades are handled by deploying a new proposal with a new VK;",
        "no program redeployment is required.",
        "",
        "# Parameters",
        "",
        "- `vk_alpha_g1` — G1 point: vk.alpha (64 bytes, big-endian uncompressed BN254)",
        "- `vk_beta_g2`  — G2 point: vk.beta  (128 bytes)",
        "- `vk_gamma_g2` — G2 point: vk.gamma (128 bytes)",
        "- `vk_delta_g2` — G2 point: vk.delta (128 bytes)",
        "- `vk_ic`       — IC points: constant term + one per public input (5 × 64 bytes)"
      ],
      "discriminator": [
        91,
        242,
        153,
        102,
        155,
        153,
        128,
        50
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "programConfig",
          "docs": [
            "Program config created by `initialize`.",
            "Verifies the caller is the program authority — prevents first-caller-wins."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "proposal",
          "docs": [
            "The proposal this VK is associated with.",
            "",
            "Heap-boxed so the ~1 200-byte Proposal struct is allocated on the heap",
            "rather than the BPF stack, keeping the frame within Solana's 4 096-byte",
            "limit. Anchor's implicit owner + discriminator checks ensure only a",
            "genuine program-owned Proposal account is accepted — any other address",
            "(random keypair, system account, foreign PDA) is rejected before the",
            "handler runs."
          ]
        },
        {
          "name": "vkAccount",
          "docs": [
            "Per-proposal VK PDA. Scoped to this proposal so a compromised key",
            "cannot affect any other election.",
            "`init_if_needed` recovers a squatted (pre-funded) PDA without error.",
            "The single-write invariant is enforced by the `is_initialized` check",
            "in the handler, preventing mid-election key replacement."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "proposal"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vkAlphaG1",
          "type": {
            "array": [
              "u8",
              64
            ]
          }
        },
        {
          "name": "vkBetaG2",
          "type": {
            "array": [
              "u8",
              128
            ]
          }
        },
        {
          "name": "vkGammaG2",
          "type": {
            "array": [
              "u8",
              128
            ]
          }
        },
        {
          "name": "vkDeltaG2",
          "type": {
            "array": [
              "u8",
              128
            ]
          }
        },
        {
          "name": "vkIc",
          "type": {
            "array": [
              {
                "array": [
                  "u8",
                  64
                ]
              },
              5
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "commitmentRecord",
      "discriminator": [
        216,
        195,
        138,
        99,
        88,
        191,
        32,
        246
      ]
    },
    {
      "name": "nullifierRecord",
      "discriminator": [
        56,
        18,
        57,
        175,
        69,
        202,
        189,
        70
      ]
    },
    {
      "name": "pendingCommitmentRecord",
      "discriminator": [
        243,
        76,
        21,
        63,
        158,
        216,
        232,
        64
      ]
    },
    {
      "name": "programConfig",
      "discriminator": [
        196,
        210,
        90,
        231,
        144,
        149,
        140,
        63
      ]
    },
    {
      "name": "proposal",
      "discriminator": [
        26,
        94,
        189,
        187,
        116,
        136,
        53,
        33
      ]
    },
    {
      "name": "verificationKeyAccount",
      "discriminator": [
        67,
        6,
        141,
        237,
        93,
        54,
        220,
        214
      ]
    },
    {
      "name": "voteRecord",
      "discriminator": [
        112,
        9,
        123,
        165,
        234,
        9,
        157,
        167
      ]
    },
    {
      "name": "voterRecord",
      "discriminator": [
        178,
        96,
        138,
        116,
        143,
        202,
        115,
        33
      ]
    }
  ],
  "events": [
    {
      "name": "proposalFinalized",
      "discriminator": [
        159,
        104,
        210,
        220,
        86,
        209,
        61,
        51
      ]
    },
    {
      "name": "voterRegistered",
      "discriminator": [
        184,
        179,
        209,
        46,
        125,
        60,
        51,
        197
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized",
      "msg": "Only the admin can perform this action"
    },
    {
      "code": 6001,
      "name": "votingNotOpen",
      "msg": "Voting is not open for this proposal"
    },
    {
      "code": 6002,
      "name": "votingStillOpen",
      "msg": "Voting is still open"
    },
    {
      "code": 6003,
      "name": "votingAlreadyClosed",
      "msg": "Voting has already been closed"
    },
    {
      "code": 6004,
      "name": "alreadyFinalized",
      "msg": "Proposal is already finalized"
    },
    {
      "code": 6005,
      "name": "nullifierAlreadyUsed",
      "msg": "This nullifier has already been used"
    },
    {
      "code": 6006,
      "name": "invalidProof",
      "msg": "Invalid ZK proof"
    },
    {
      "code": 6007,
      "name": "merkleRootMismatch",
      "msg": "Merkle root mismatch"
    },
    {
      "code": 6008,
      "name": "alreadyRevealed",
      "msg": "Vote has already been revealed"
    },
    {
      "code": 6009,
      "name": "commitmentMismatch",
      "msg": "Vote commitment does not match"
    },
    {
      "code": 6010,
      "name": "titleTooLong",
      "msg": "Title too long, max 128 characters"
    },
    {
      "code": 6011,
      "name": "descriptionTooLong",
      "msg": "Description too long, max 256 characters"
    },
    {
      "code": 6012,
      "name": "invalidVotingPeriod",
      "msg": "Invalid voting period"
    },
    {
      "code": 6013,
      "name": "notInRegistration",
      "msg": "Proposal is not in Registration phase"
    },
    {
      "code": 6014,
      "name": "hashError",
      "msg": "Poseidon hash computation failed"
    },
    {
      "code": 6015,
      "name": "treeFull",
      "msg": "Merkle tree is full — maximum voters reached"
    },
    {
      "code": 6016,
      "name": "vkNotInitialized",
      "msg": "Verification key not initialized — call store_vk first"
    },
    {
      "code": 6017,
      "name": "vkAlreadyInitialized",
      "msg": "Verification key is already initialized and cannot be replaced"
    },
    {
      "code": 6018,
      "name": "notFinalized",
      "msg": "Proposal is not yet finalized"
    },
    {
      "code": 6019,
      "name": "voteAccountsNotClosed",
      "msg": "All vote accounts must be closed before the proposal can be closed"
    },
    {
      "code": 6020,
      "name": "commitmentAccountsNotClosed",
      "msg": "All commitment accounts must be closed before the proposal can be closed"
    },
    {
      "code": 6021,
      "name": "votingWindowNotExpired",
      "msg": "Voting window has not yet expired — call open_voting or wait for voting_end"
    },
    {
      "code": 6022,
      "name": "invalidCommitment",
      "msg": "Commitment must be a non-zero BN254 field element (0 < commitment < p)"
    },
    {
      "code": 6023,
      "name": "invalidVerificationKey",
      "msg": "Verification key contains an invalid curve point or out-of-range field element"
    },
    {
      "code": 6024,
      "name": "invalidRefundTo",
      "msg": "refund_to must match the address recorded in the VoteRecord, or equal closer when no address was designated"
    },
    {
      "code": 6025,
      "name": "commitmentAlreadyRegistered",
      "msg": "This commitment has already been registered for this proposal"
    },
    {
      "code": 6026,
      "name": "voterAlreadyRegistered",
      "msg": "This voter identity has already been registered for this proposal"
    }
  ],
  "types": [
    {
      "name": "commitmentRecord",
      "docs": [
        "One account per (proposal, commitment) pair — its existence prevents the same",
        "commitment from being inserted into the Merkle tree more than once.",
        "",
        "Stores the commitment value so the account is self-describing: any holder of",
        "an on-chain RPC connection can enumerate all CommitmentRecord accounts for a",
        "proposal and close them via `close_commitment_record` without any off-chain",
        "data (event logs or admin records).",
        "",
        "Also stores the registering voter's Solana pubkey so `close_commitment_record`",
        "can atomically derive and close the corresponding `VoterRecord` PDA."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "commitment",
            "docs": [
              "The voter commitment registered for this proposal.",
              "Stored here (rather than derived from seeds) so the account can be closed",
              "permissionlessly after finalization without requiring the caller to supply",
              "the commitment value from off-chain sources."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "voter",
            "docs": [
              "Solana pubkey of the voter who registered this commitment.",
              "Used by `close_commitment_record` to derive and close the `VoterRecord` PDA."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "nullifierRecord",
      "docs": [
        "One account per nullifier — its existence means the nullifier is spent"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nullifier",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pendingCommitmentRecord",
      "docs": [
        "Temporary holding account created by the voter to bind their commitment to",
        "their Solana identity before the admin inserts it into the Merkle tree.",
        "",
        "Seeded by `(proposal, voter_pubkey)` so:",
        "- One slot per (proposal, voter) — a voter cannot queue two different",
        "commitments simultaneously.",
        "- The voter's signing key is cryptographically embedded in the PDA",
        "derivation, making it impossible for the admin to substitute a different",
        "commitment without invalidating the PDA address.",
        "",
        "Closed by `register_voter` (lamports returned to the voter), which atomically",
        "reads the commitment and inserts it into the Merkle tree."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "programConfig",
      "docs": [
        "Global program configuration — created once by `initialize`.",
        "Stores the program authority that is allowed to manage the VK."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "The upgrade authority at initialization time.",
              "Only this key may call `store_vk`."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "proposal",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "docs": [
              "Unique proposal identifier — set to the PDA pubkey at creation"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "admin",
            "docs": [
              "The admin who created this proposal and controls its lifecycle"
            ],
            "type": "pubkey"
          },
          {
            "name": "title",
            "docs": [
              "Human-readable title shown to voters (max 128 chars)"
            ],
            "type": "string"
          },
          {
            "name": "description",
            "docs": [
              "Full description of what is being voted on (max 256 chars)"
            ],
            "type": "string"
          },
          {
            "name": "titleSeed",
            "docs": [
              "Keccak-256 hash of the full title — used as PDA seed to prevent collisions."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "votingStart",
            "docs": [
              "Unix timestamp when voting opens — voters cannot cast before this"
            ],
            "type": "i64"
          },
          {
            "name": "votingEnd",
            "docs": [
              "Unix timestamp when voting closes — voters cannot cast after this"
            ],
            "type": "i64"
          },
          {
            "name": "status",
            "docs": [
              "Current lifecycle state of the proposal"
            ],
            "type": {
              "defined": {
                "name": "proposalStatus"
              }
            }
          },
          {
            "name": "merkleRoot",
            "docs": [
              "Root of the Merkle tree of registered voter commitments.",
              "Used in ZK proofs to prove a voter is eligible without revealing identity."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "merkleFrontier",
            "docs": [
              "Incremental Merkle tree frontier — the rightmost filled node at each level.",
              "Updated by `register_voter` on each leaf insertion.",
              "Only the frontier needs to be stored (not the full tree) — 20 × 32 = 640 bytes."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    32
                  ]
                },
                20
              ]
            }
          },
          {
            "name": "voterCount",
            "docs": [
              "Total number of registered voters (Merkle tree leaves)"
            ],
            "type": "u64"
          },
          {
            "name": "voteCount",
            "docs": [
              "Total number of votes cast (including unrevealed)"
            ],
            "type": "u64"
          },
          {
            "name": "yesCount",
            "docs": [
              "Number of revealed yes votes (1) after voting closes"
            ],
            "type": "u64"
          },
          {
            "name": "noCount",
            "docs": [
              "Number of revealed no votes (0) after voting closes"
            ],
            "type": "u64"
          },
          {
            "name": "closedVoteCount",
            "docs": [
              "Number of (NullifierRecord, VoteRecord) pairs closed via close_vote_accounts.",
              "close_proposal requires this equals vote_count so no rent is permanently stranded."
            ],
            "type": "u64"
          },
          {
            "name": "closedCommitmentCount",
            "docs": [
              "Number of CommitmentRecord PDAs closed via close_commitment_record.",
              "close_proposal requires this equals voter_count so no registration rent is",
              "permanently stranded in orphaned CommitmentRecord accounts."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump seed for address derivation"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "proposalFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "yesCount",
            "type": "u64"
          },
          {
            "name": "noCount",
            "type": "u64"
          },
          {
            "name": "totalVotes",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "proposalStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "registration"
          },
          {
            "name": "voting"
          },
          {
            "name": "closed"
          },
          {
            "name": "finalized"
          },
          {
            "name": "expired"
          }
        ]
      }
    },
    {
      "name": "verificationKeyAccount",
      "docs": [
        "On-chain storage for the Groth16 prepared verifying key.",
        "",
        "Populated by the admin via the `store_vk` instruction after running the",
        "trusted setup ceremony for the combined ZK circuit. Once stored, `cast_vote`",
        "uses this key to verify every incoming proof.",
        "",
        "# Groth16 prepared verifying key layout",
        "",
        "A Groth16 VK for a circuit with `n` public inputs consists of:",
        "- `vk_alpha_g1`  — G1 point (64 bytes)",
        "- `vk_beta_g2`   — G2 point (128 bytes)",
        "- `vk_gamma_g2`  — G2 point (128 bytes)",
        "- `vk_delta_g2`  — G2 point (128 bytes)",
        "- `vk_ic`        — n+1 G1 points (one constant term + one per public input)",
        "",
        "For our combined circuit [`NUM_PUBLIC_INPUTS`] = 4:",
        "public inputs: nullifier, proposal_id, merkle_root, vote_commitment",
        "vk_ic size: 5 × 64 = 320 bytes",
        "",
        "# Compatibility note",
        "",
        "The byte format expected by `groth16-solana` uses uncompressed BN254 points",
        "in big-endian byte order, matching the output of arkworks when serialized",
        "for Solana. Conversion from arkworks to this format is done off-chain by the",
        "trusted setup tooling."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isInitialized",
            "docs": [
              "Whether the VK has been initialized with real data.",
              "If false, `cast_vote` logs a warning and skips verification",
              "(development mode only — must be true in production)."
            ],
            "type": "bool"
          },
          {
            "name": "vkAlphaG1",
            "docs": [
              "G1 point: vk_alpha"
            ],
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          },
          {
            "name": "vkBetaG2",
            "docs": [
              "G2 point: vk_beta"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "vkGammaG2",
            "docs": [
              "G2 point: vk_gamma"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "vkDeltaG2",
            "docs": [
              "G2 point: vk_delta"
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          },
          {
            "name": "vkIc",
            "docs": [
              "IC points: vk_ic[0] is the constant term, vk_ic[1..=NUM_PUBLIC_INPUTS]",
              "correspond to nullifier, proposal_id, merkle_root, vote_commitment."
            ],
            "type": {
              "array": [
                {
                  "array": [
                    "u8",
                    64
                  ]
                },
                5
              ]
            }
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "voteRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "voteCommitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "nullifier",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "revealed",
            "type": "bool"
          },
          {
            "name": "vote",
            "type": "u8"
          },
          {
            "name": "refundTo",
            "docs": [
              "Optional address that receives the rent when this account is closed.",
              "Set by the voter at cast time via the `refund_to` parameter.",
              "`Pubkey::default()` (all zeros) means \"no preference — route to closer\".",
              "Voters may use a fresh ephemeral key to reclaim rent without linking",
              "their Solana identity to their nullifier on-chain."
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "voterRecord",
      "docs": [
        "One account per (proposal, voter_pubkey) pair — its existence prevents the same",
        "Solana identity from registering more than once per proposal, regardless of",
        "which commitment bytes they supply.",
        "",
        "Closed atomically alongside its corresponding `CommitmentRecord` by",
        "`close_commitment_record`, so no separate cleanup instruction is needed."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isInitialized",
            "docs": [
              "Set to `true` by `register_voter` after all fields are written.",
              "Used as the \"already initialized\" guard when `init_if_needed` is in effect,",
              "allowing the instruction to recover pre-funded (squatted) PDAs while still",
              "rejecting genuine double-registration attempts."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "voterRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "proposalId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "commitment",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "leafIndex",
            "type": "u64"
          }
        ]
      }
    }
  ]
};
