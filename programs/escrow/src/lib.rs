use anchor_lang::prelude::*;
use anchor_spl::token::*;
pub mod state;
pub use state::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod escrow {
    use super::*;

    pub fn initialize(ctx: Context<InitializePayment>,application_idx:u64,amount:u64) -> Result<()> {
        let curr_state = &mut ctx.accounts.application_state;
        curr_state.idx = application_idx;
        curr_state.user_sending = ctx.accounts.user_sending.key().clone();
        curr_state.user_receiver = ctx.accounts.user_receiver.key().clone();
        curr_state.mint_of_token_sent = ctx.accounts.mint_of_token_sent.key().clone();
        curr_state.escrow_wallet = ctx.accounts.escrow_wallet_state.key().clone();
        curr_state.amount_token = amount;

        let mint_of_token_sent_pk = ctx.accounts.mint_of_token_sent.key().clone();
        let application_idx = application_idx.to_le_bytes();
        let inner_bump_vec = vec![
            b"state".as_ref(),
            ctx.accounts.user_sending.key.as_ref(),
            ctx.accounts.user_receiver.key.as_ref(),
            mint_of_token_sent_pk.as_ref(),
            application_idx.as_ref(),
        ];
        let (_address,state_bump) = Pubkey::find_program_address(inner_bump_vec.as_slice(), ctx.program_id);
        curr_state.state_bump = state_bump;
        let bump_vector = curr_state.state_bump.to_le_bytes();
        let inner = vec![
            b"state".as_ref(),
            ctx.accounts.user_sending.key.as_ref(),
            ctx.accounts.user_receiver.key.as_ref(),
            mint_of_token_sent_pk.as_ref(),
            application_idx.as_ref(),
            bump_vector.as_ref(),
        ];
        let outer = vec![inner.as_slice()];

        let transfer_instruction = Transfer{
            from:ctx.accounts.wallet_to_withdraw_from.to_account_info(),
            to:ctx.accounts.escrow_wallet_state.to_account_info(),
            authority:ctx.accounts.user_sending.to_account_info()
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_instruction, outer.as_slice());
        transfer(cpi_ctx, amount)?;
        curr_state.stage = Stage::FundsDeposited;
        Ok(())
    }

    pub fn compelete(ctx:Context<CompeletePayment>,application_idx:u64,_wallet_bump:u8) -> Result<()> {
        if Stage::from(ctx.accounts.application_state.stage) != Stage::FundsDeposited{
            msg!("Stage is invalid, state stage is not Funds Deposited");
            return Err(PayError::InvalidStage.into());
        }
        let curr = ctx.accounts;
        transfer_escrow_out(curr.user_sending.to_account_info(), curr.user_receiver.to_account_info(),curr.mint_of_token_sent.to_account_info(), &mut curr.escrow_wallet_state,application_idx,curr.application_state.to_account_info(), 
            curr.application_state.state_bump, curr.token_program.to_account_info(), curr.wallet_deposit_to.to_account_info(), curr.application_state.amount_token)?;        
        Ok(())
    }

    pub fn pullback(ctx:Context<PullBack>,application_idx:u64) -> Result<()> {
        let current_stage = Stage::from(ctx.accounts.application_state.stage);
        if current_stage != Stage::FundsDeposited{
            msg!("Funds not available");
            return Err(PayError::InvalidStage.into());
        }
        let curr = ctx.accounts;
        transfer_escrow_out(curr.user_sending.to_account_info(), curr.user_receiver.to_account_info(),curr.mint_of_token_sent.to_account_info(), &mut curr.escrow_wallet_state,application_idx,curr.application_state.to_account_info(), 
            curr.application_state.state_bump, curr.token_program.to_account_info(), curr.refund_wallet.to_account_info(), curr.application_state.amount_token)?;        
        Ok(())
    }
}

fn transfer_escrow_out<'info>(
    user_sending:AccountInfo<'info>,
    user_receiver:AccountInfo<'info>,
    mint_of_token_sent:AccountInfo<'info>,
    escrow_wallet:&mut Account<'info,TokenAccount>,
    application_idx:u64,
    state:AccountInfo<'info>,
    state_bump:u8,
    token_program:AccountInfo<'info>,
    destination_wallet:AccountInfo<'info>,
    amount:u64
) -> Result<()> {
    let bump_vector = state_bump.to_le_bytes();
    let mint_of_token_sent_pk = mint_of_token_sent.key().clone();
    let application_idx = application_idx.to_le_bytes();
    let inner = vec![
        b"state".as_ref(),
        user_sending.key.as_ref(),
        user_receiver.key.as_ref(),
        mint_of_token_sent_pk.as_ref(),
        application_idx.as_ref(),
        bump_vector.as_ref()
    ];
    let outer = [inner.as_slice()];

    let transfer_instruction = Transfer{
        from: escrow_wallet.to_account_info(),
        to: destination_wallet,
        authority:state.to_account_info()
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program.to_account_info(), transfer_instruction, outer.as_slice());
    transfer(cpi_ctx, amount)?;
    let should_close = {
        escrow_wallet.reload()?;
        escrow_wallet.amount == 0
    };
    if should_close {
        let ca = CloseAccount{
            account:escrow_wallet.to_account_info(),
            destination:user_sending.to_account_info(),
            authority:state.to_account_info()
        };
        let cpi_ctx = CpiContext::new_with_signer(token_program.to_account_info(), ca, outer.as_slice());
        close_account(cpi_ctx)?;
    }

    Ok(())
}

