/// Build script — runs on the host during every `anchor build` / `cargo build-sbf`.
///
/// - When the `dev` feature is active: emits a reminder that the proof-verification
///   bypass is enabled and must not be used for production deployments.
/// - When building for production (no `dev`): emits a warning if PROGRAM_AUTHORITY
///   in constants.rs is still the all-zeros placeholder (front-running protection off).
fn main() {
    let has_dev_feature = std::env::var("CARGO_FEATURE_DEV").is_ok();

    if has_dev_feature {
        println!(
            "cargo:warning=\
             DEV BUILD: proof-verification bypass is ACTIVE. \
             Run `anchor build` (no --features dev) for production."
        );
    } else {
        // Production build — check if PROGRAM_AUTHORITY is still the placeholder.
        let src = std::fs::read_to_string("src/constants.rs").unwrap_or_default();
        if src.contains("pub const PROGRAM_AUTHORITY: [u8; 32] = [0u8; 32];") {
            println!(
                "cargo:warning=\
                 *** PRODUCTION BUILD: PROGRAM_AUTHORITY in constants.rs is all-zeros. \
                 Front-running protection for `initialize` is DISABLED. \
                 Set PROGRAM_AUTHORITY to your deployment wallet's pubkey before mainnet deploy. ***"
            );
        }
    }
}
