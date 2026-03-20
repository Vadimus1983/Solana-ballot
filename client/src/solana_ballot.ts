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
          "writable": true
        },
        {
          "name": "vkAccount",
          "docs": [
            "constraint. The account data is parsed manually in the handler:",
            "- If initialized (`store_vk` has been called): real Groth16 verification runs.",
            "- If absent or uninitialized: verification is skipped (development mode)."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  107
                ]
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
                "kind": "arg",
                "path": "nullifier"
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
        }
      ]
    },
    {
      "name": "closeVoting",
      "docs": [
        "Closes the voting period. No more votes can be cast after this.",
        "Transitions the proposal from Voting → Closed.",
        "Can only be called by the admin."
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
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true
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
      "name": "finalizeTally",
      "docs": [
        "Finalizes the tally and marks the proposal as complete.",
        "Emits a `ProposalFinalized` event with the final yes/no counts.",
        "Transitions the proposal from Closed → Finalized.",
        "Can only be called by the admin after voting is closed."
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
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "writable": true
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
          "writable": true,
          "signer": true,
          "relations": [
            "proposal"
          ]
        },
        {
          "name": "proposal",
          "docs": [
            "The proposal being transitioned to Voting status.",
            "Verified to be owned by `admin` via `has_one`."
          ],
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "registerVoter",
      "docs": [
        "Registers an eligible voter by adding their commitment to the Merkle tree.",
        "Must be called by the admin during the Registration phase.",
        "The commitment is `Poseidon(secret_key, randomness)` computed off-chain by the voter.",
        "Voters must register before voting opens — they cannot register retroactively.",
        "",
        "# Parameters",
        "- `commitment` — 32-byte Poseidon hash of the voter's secret key and randomness.",
        "This is the voter's leaf in the eligibility Merkle tree."
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
          "name": "voter",
          "writable": true,
          "signer": true
        },
        {
          "name": "proposal",
          "writable": true
        },
        {
          "name": "voteRecord",
          "writable": true
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
        "Stores the Groth16 verifying key on-chain after the trusted setup ceremony.",
        "",
        "Must be called once by the admin before any votes can be cast with real",
        "ZK proof verification. Until this is called, `cast_vote` runs in",
        "development mode (proof verification skipped).",
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
          "docs": [
            "The admin who deploys this program and runs the trusted setup"
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "vkAccount",
          "docs": [
            "PDA that holds the verifying key — one per program deployment"
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
    }
  ],
  "types": [
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
            "name": "admin",
            "docs": [
              "Admin who uploaded this VK — only they can replace it"
            ],
            "type": "pubkey"
          },
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
            "name": "revealed",
            "type": "bool"
          },
          {
            "name": "vote",
            "type": "u8"
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
