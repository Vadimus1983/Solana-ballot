use anchor_lang::prelude::*;
use crate::constants::*;

/// Global program configuration — created once by `initialize`.
/// Stores the program authority that is allowed to manage the VK.
#[account]
pub struct ProgramConfig {
    /// The upgrade authority at initialization time.
    /// Only this key may call `store_vk`.
    pub authority: Pubkey,
    pub bump: u8,
    /// Set to `true` when the program was built with `--features dev`.
    /// Clients and UIs can read this field to warn users that proof
    /// verification is disabled and this binary must not be trusted for
    /// any real election.
    pub is_dev_mode: bool,
}

impl ProgramConfig {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR + PUBKEY_SIZE + 1 + 1;
}
