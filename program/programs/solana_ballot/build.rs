/// Build script — runs on the host during every `anchor build` / `cargo build-sbf`.
///
/// - When the `dev` feature is active: emits a reminder that the proof-verification
///   bypass is enabled and must not be used for production deployments.
/// - When building for production (no `dev`): emits a hard error if PROGRAM_AUTHORITY
///   in constants.rs is still the all-zeros placeholder (front-running protection off).
fn main() {
    let has_dev_feature = std::env::var("CARGO_FEATURE_DEV").is_ok();

    if has_dev_feature {
        println!(
            "cargo:warning=\
             DEV BUILD: proof-verification bypass is ACTIVE. \
             Build without --features dev for production."
        );
    } else {
        // Production build — hard-fail if PROGRAM_AUTHORITY is still the all-zeros placeholder.
        // An all-zeros authority means anyone can call `initialize` and claim the program,
        // which would let them install a malicious VK and accept forged proofs.
        let src = std::fs::read_to_string("src/constants.rs").unwrap_or_default();
        if src.contains("pub const PROGRAM_AUTHORITY: [u8; 32] = [0u8; 32];") {
            println!(
                "cargo:error=\
                 PRODUCTION BUILD BLOCKED: PROGRAM_AUTHORITY in src/constants.rs is all-zeros. \
                 Set it to your deployment wallet's 32-byte public key before building for production. \
                 For local development use `anchor build --features dev` instead."
            );
        }
    }
}
