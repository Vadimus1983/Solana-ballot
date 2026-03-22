# Run the full test suite with the dev proof-verification bypass enabled.
# Use this for local development; never deploy the dev build to production.
test:
	anchor test -- --features dev

# Build a production binary (no dev bypass). Requires PROGRAM_AUTHORITY to be
# set to a real pubkey in programs/solana_ballot/src/constants.rs before this
# will succeed.
build:
	anchor build

.PHONY: test build
