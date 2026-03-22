/// Build script — runs on the host during every `anchor build` / `cargo build-sbf`.
///
/// - When the `dev` feature is active: emits a reminder that the proof-verification
///   bypass is enabled and must not be used for production deployments.
/// - When building for production (no `dev`): the PROGRAM_AUTHORITY all-zeros guard
///   is enforced by a `const` assertion in constants.rs (stronger than a string match).
fn main() {
    let has_dev_feature = std::env::var("CARGO_FEATURE_DEV").is_ok();

    if has_dev_feature {
        println!(
            "cargo:warning=\
             DEV BUILD: proof-verification bypass is ACTIVE. \
             Build without --features dev for production."
        );
    }
    // Production-build safety (PROGRAM_AUTHORITY all-zeros guard) is now
    // enforced by the compile-time `const` assertion in constants.rs.
    // That assertion is immune to comment variations, type suffixes, and
    // whitespace changes that could bypass a string-match guard here.
}
