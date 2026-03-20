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
}

impl ProgramConfig {
    pub const LEN: usize = ANCHOR_DISCRIMINATOR + PUBKEY_SIZE + 1;
}
