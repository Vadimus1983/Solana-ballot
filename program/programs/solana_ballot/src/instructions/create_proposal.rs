use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};
use crate::state::proposal::{Proposal, ProposalStatus};
use crate::state::program_config::ProgramConfig;
use crate::state::root_history::RootHistoryAccount;
use crate::error::BallotError;
use crate::constants::*;

fn keccak256(data: &[u8]) -> [u8; 32] {
    Keccak256::digest(data).into()
}

pub fn handler(
    ctx: Context<CreateProposal>,
    title: String,
    description: String,
    voting_start: i64,
    voting_end: i64,
) -> Result<()> {
    require!(title.len() <= MAX_TITLE_LEN, BallotError::TitleTooLong);
    require!(description.len() <= MAX_DESCRIPTION_LEN, BallotError::DescriptionTooLong);
    require!(voting_end > voting_start, BallotError::InvalidVotingPeriod);
    let duration = voting_end
        .checked_sub(voting_start)
        .ok_or(error!(BallotError::InvalidVotingPeriod))?;
    // Minimum enforced in production only — dev builds use short windows for testing.
    #[cfg(not(feature = "dev"))]
    require!(duration >= MIN_VOTING_DURATION, BallotError::InvalidVotingPeriod);
    require!(duration <= MAX_VOTING_DURATION, BallotError::InvalidVotingPeriod);

    let clock = Clock::get()?;

    // Reject start times that are more than MAX_VOTING_START_DRIFT seconds in the past.
    // A small drift allowance accommodates transaction latency and clock skew; an
    // arbitrarily stale voting_start (e.g. epoch 0) would be a configuration error.
    require!(
        voting_start >= clock.unix_timestamp - MAX_VOTING_START_DRIFT,
        BallotError::InvalidVotingPeriod
    );

    // Prevent proposals for periods that have already ended.
    require!(voting_end > clock.unix_timestamp, BallotError::InvalidVotingPeriod);

    let title_seed = keccak256(title.as_bytes());

    let proposal_key = ctx.accounts.proposal.key();
    let proposal = &mut ctx.accounts.proposal;

    proposal.id            = proposal_key.to_bytes();
    proposal.admin         = ctx.accounts.admin.key();
    proposal.title         = title;
    proposal.description   = description;
    proposal.title_seed    = title_seed;
    proposal.voting_start  = voting_start;
    proposal.voting_end    = voting_end;
    proposal.status        = ProposalStatus::Registration;
    proposal.merkle_root   = [0u8; HASH_SIZE];
    proposal.merkle_frontier = [[0u8; HASH_SIZE]; MERKLE_DEPTH];
    proposal.voter_count       = 0;
    proposal.vote_count        = 0;
    proposal.yes_count         = 0;
    proposal.no_count          = 0;
    proposal.closed_vote_count       = 0;
    proposal.closed_commitment_count = 0;
    proposal.bump                    = ctx.bumps.proposal;

    // load_init() gives a mutable reference into the zero-copy account's data buffer.
    // root_history and root_history_index are zero-initialised by Anchor's init constraint.
    {
        let mut rh = ctx.accounts.root_history_account.load_init()?;
        rh.root_history_index = 0;
        // root_history is already zeroed; explicit assignment avoids dead_code warnings.
        rh.root_history = [[0u8; HASH_SIZE]; ROOT_HISTORY_SIZE];
        // Store the canonical bump so subsequent instructions can use
        // create_program_address (single syscall) instead of find_program_address.
        rh.bump = ctx.bumps.root_history_account;
    }

    emit!(ProposalCreated {
        proposal_id: proposal.id,
        admin: proposal.admin,
        voting_start: proposal.voting_start,
        voting_end: proposal.voting_end,
    });

    msg!("Proposal created: {:?}", proposal.title);
    Ok(())
}

#[event]
pub struct ProposalCreated {
    pub proposal_id: [u8; 32],
    pub admin: Pubkey,
    pub voting_start: i64,
    pub voting_end: i64,
}

#[derive(Accounts)]
#[instruction(title: String)]
pub struct CreateProposal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    /// Only the program authority may create proposals.
    #[account(
        seeds = [SEED_CONFIG],
        bump = program_config.bump,
        constraint = program_config.authority == admin.key() @ BallotError::Unauthorized,
    )]
    pub program_config: Account<'info, ProgramConfig>,

    #[account(
        init,
        payer = admin,
        space = Proposal::LEN,
        seeds = [
            SEED_PROPOSAL,
            admin.key().as_ref(),
            &keccak256(title.as_bytes()),
        ],
        bump
    )]
    pub proposal: Box<Account<'info, Proposal>>,

    /// Root history ring buffer for this proposal. Created here and closed in
    /// close_proposal. Kept separate from the Proposal account to avoid growing
    /// that struct (which would increase BPF stack usage in try_accounts).
    #[account(
        init,
        payer = admin,
        space = RootHistoryAccount::LEN,
        seeds = [SEED_ROOT_HISTORY, proposal.key().as_ref()],
        bump,
    )]
    pub root_history_account: AccountLoader<'info, RootHistoryAccount>,

    pub system_program: Program<'info, System>,
}
