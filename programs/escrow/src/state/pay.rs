use anchor_lang::prelude::*;
use anchor_spl::token::*;
use anchor_spl::associated_token::*;

#[derive(AnchorSerialize,AnchorDeserialize,Clone,PartialEq,Copy)]
pub enum Stage{
    FundsDeposited = 1,
    TransactionCompelete=2,
}

#[error_code]
pub enum PayError {
    InvalidStage
}

#[account]
pub struct State{
    pub idx:u64,//8
    pub user_sending:Pubkey, // 32
    pub user_receiver:Pubkey, // 32
    pub mint_of_token_sent: Pubkey, //32
    pub escrow_wallet: Pubkey,// 32
    pub amount_token: u64,//8
    pub stage: Stage,//1,
    pub state_bump:u8, //1
}

#[derive(Accounts)]
#[instruction(application_idx:u64)]
pub struct InitializePayment<'info>{
    #[account(
        init, 
        payer=user_sending,
        seeds=[b"state".as_ref(),user_sending.key().as_ref(),user_receiver.key().as_ref(),mint_of_token_sent.key().as_ref(),application_idx.to_le_bytes().as_ref()],
        bump,
        space=(4*32)+(8*3)+1+1,
    )]
    pub application_state: Account<'info,State>,
    #[account(
        init,
        payer=user_sending,
        seeds=[b"wallet".as_ref(),user_sending.key().as_ref(),user_receiver.key().as_ref(),mint_of_token_sent.key().as_ref(),application_idx.to_le_bytes().as_ref()],
        bump,
        token::mint=mint_of_token_sent,
        token::authority=application_state
    )]
    pub escrow_wallet_state:Account<'info,TokenAccount>,
    #[account(mut)]
    pub user_sending:Signer<'info>,
    /// CHECK
    pub user_receiver:AccountInfo<'info>,
    pub mint_of_token_sent:Account<'info,Mint>,
    #[account(
        mut,
        constraint=wallet_to_withdraw_from.owner == user_sending.key(),
        constraint=wallet_to_withdraw_from.mint == mint_of_token_sent.key(),
    )]
    pub wallet_to_withdraw_from:Account<'info,TokenAccount>,
    pub token_program:Program<'info,Token>,
    pub system_program:Program<'info,System>,
    pub rent:Sysvar<'info,Rent>
}

#[derive(Accounts)]
#[instruction(application_idx:u64,wallet_bump:u8)]
pub struct CompeletePayment<'info>{
    #[account(
        mut,
        seeds=[b"state".as_ref(),user_sending.key().as_ref(),user_receiver.key().as_ref(),mint_of_token_sent.key().as_ref(),application_idx.to_le_bytes().as_ref()],
        bump=application_state.state_bump,
        has_one=user_sending,
        has_one=user_receiver,
        has_one=mint_of_token_sent
    )]
    pub application_state: Account<'info,State>,
    #[account(
        mut,
        seeds=[b"wallet".as_ref(),user_sending.key().as_ref(),user_receiver.key().as_ref(),mint_of_token_sent.key().as_ref(),application_idx.to_le_bytes().as_ref()],
        bump=wallet_bump,
    )]
    pub escrow_wallet_state: Account<'info,TokenAccount>,
    #[account(
        init_if_needed,
        payer=user_receiver,
        associated_token::mint=mint_of_token_sent,
        associated_token::authority=user_receiver
    )]
    pub wallet_deposit_to: Account<'info,TokenAccount>,
    #[account(mut)]
    /// CHECK
    pub user_sending:AccountInfo<'info>,
    #[account(mut)]
    pub user_receiver:Signer<'info>,
    pub mint_of_token_sent:Account<'info,Mint>,
    pub system_program:Program<'info,System>,
    pub rent : Sysvar<'info,Rent>,
    pub token_program:Program<'info,Token>,
    pub associated_token_program:Program<'info,AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(application_idx:u64,wallet_bump:u8)]
pub struct PullBack<'info>{
    #[account(
        mut,
        seeds=[b"state".as_ref(),user_sending.key().as_ref(),user_receiver.key().as_ref(),mint_of_token_sent.key().as_ref(),application_idx.to_le_bytes().as_ref()],
        bump=application_state.state_bump,
        has_one=user_sending,
        has_one=user_receiver,
        has_one=mint_of_token_sent
    )]
    pub application_state:Account<'info,State>,
    #[account(
        mut,
        seeds=[b"wallet".as_ref(),user_sending.key().as_ref(),user_receiver.key().as_ref(),mint_of_token_sent.key().as_ref(),application_idx.to_le_bytes().as_ref()],
        bump=wallet_bump,
    )]
    pub escrow_wallet_state: Account<'info,TokenAccount>,
    //user and accounts in system
    #[account(mut)]
    pub user_sending:Signer<'info>,
    /// CHECK
    pub user_receiver:AccountInfo<'info>,
    pub mint_of_token_sent:Account<'info,Mint>,
    //programs and rent
    pub system_program:Program<'info,System>,
    pub rent : Sysvar<'info,Rent>,
    pub token_program:Program<'info,Token>,
    //wallet to deposit to
    #[account(
        mut,
        constraint=refund_wallet.owner == user_sending.key(),
        constraint=refund_wallet.mint == mint_of_token_sent.key()
    )]
    pub refund_wallet: Account<'info, TokenAccount>,
}