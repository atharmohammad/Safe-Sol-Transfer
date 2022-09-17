import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import { Program } from "@project-serum/anchor";
import { Escrow } from "../target/types/escrow";
import { token } from "@project-serum/anchor/dist/cjs/utils";
import { Account, AccountLayout, RawAccount } from "@solana/spl-token";
import {encode} from "@project-serum/anchor/dist/cjs/utils/bytes/utf8";
import { assert, expect } from "chai";

interface PDAparams{
  idx:anchor.BN,
  escrowWalletKey:anchor.web3.PublicKey,
  stateKey:anchor.web3.PublicKey,
  walletBump:number,
  stateBump:number
}

describe("escrow", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider); // 1st - set provider

  const program = anchor.workspace.Escrow as Program<Escrow>; //2nd - get the program

  // define types for each params
  let mintAddress : anchor.web3.PublicKey;
  let alice : anchor.web3.Keypair;
  let bob: anchor.web3.Keypair;
  let aliceWallet: anchor.web3.PublicKey;
  let pda: PDAparams;
  let bobWallet : anchor.web3.PublicKey;
  let amount : anchor.BN;
  // define helper functions
  const getPdaParams = async(connection: anchor.web3.Connection, alice:anchor.web3.PublicKey, bob:anchor.web3.PublicKey , mint:anchor.web3.PublicKey) : Promise<PDAparams> =>{
    const uid = new anchor.BN(parseInt((Date.now()/1000).toString()));
    const uidBuffer = uid.toBuffer('le',8);

    const [statePubkey,stateBump] = await anchor.web3.PublicKey.findProgramAddress(
      [encode("state"),alice.toBuffer(),bob.toBuffer(),mint.toBuffer(),uidBuffer],
      program.programId);

    const [walletPubkey,walletBump] = await anchor.web3.PublicKey.findProgramAddress(
        [encode("wallet"),alice.toBuffer(),bob.toBuffer(),mint.toBuffer(),uidBuffer],
        program.programId);

    return {
      idx:uid,
      escrowWalletKey:walletPubkey,
      stateKey:statePubkey,
      stateBump,
      walletBump
    }
  }

  const createMint = async(connection:anchor.web3.Connection) : Promise<anchor.web3.PublicKey> =>{
    const tokenMint = new anchor.web3.Keypair();
    const lamportsForMint = await provider.connection.getMinimumBalanceForRentExemption(spl.MintLayout.span);
    let tx = new anchor.web3.Transaction();
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        programId:spl.TOKEN_PROGRAM_ID,
        lamports:lamportsForMint,
        fromPubkey:provider.wallet.publicKey,
        newAccountPubkey:tokenMint.publicKey,
        space:spl.MintLayout.span,
      })
    );
    tx.add(
      spl.createInitializeMintInstruction(
        tokenMint.publicKey,
        6,
        provider.wallet.publicKey,
        provider.wallet.publicKey,
        spl.TOKEN_PROGRAM_ID
      )
    )
    const signature = await provider.sendAndConfirm(tx,[tokenMint]);
    console.log(`[${tokenMint.publicKey}] has created a new mint account at ${signature}`);
    return tokenMint.publicKey;
  }

  const createAssociatedTokenAccount = async(connection:anchor.web3.Connection,payer:anchor.web3.Keypair,mint?:anchor.web3.PublicKey) : Promise<anchor.web3.PublicKey> =>{
    let tx = new anchor.web3.Transaction();
    tx.add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey:provider.wallet.publicKey,
        toPubkey:payer.publicKey,
        lamports:5*anchor.web3.LAMPORTS_PER_SOL
      })
    )
    await provider.sendAndConfirm(tx);
    let account : anchor.web3.PublicKey = undefined;
    const newTx = new anchor.web3.Transaction();
    account = await spl.getAssociatedTokenAddress(mint,payer.publicKey,undefined,spl.TOKEN_PROGRAM_ID,spl.ASSOCIATED_TOKEN_PROGRAM_ID);
    newTx.add(spl.createAssociatedTokenAccountInstruction(payer.publicKey,account,payer.publicKey,mint,spl.TOKEN_PROGRAM_ID,spl.ASSOCIATED_TOKEN_PROGRAM_ID))
    if(payer == alice){
      newTx.add(spl.createMintToInstruction(mint,account,provider.wallet.publicKey,2,[],spl.TOKEN_PROGRAM_ID));
    }
    await provider.sendAndConfirm(newTx,[payer]);

    return account;
  }
  beforeEach(async()=>{
    alice = new anchor.web3.Keypair();
    bob = new anchor.web3.Keypair();
    mintAddress = await createMint(provider.connection);
    aliceWallet = await createAssociatedTokenAccount(provider.connection,alice,mintAddress);
    bobWallet = await createAssociatedTokenAccount(provider.connection,bob,mintAddress);
    pda = await getPdaParams(provider.connection,alice.publicKey,bob.publicKey,mintAddress);
    amount = new anchor.BN(1);
  })
  const readaccount = async(key:anchor.web3.PublicKey) : Promise<RawAccount> =>{
    const acc = await provider.connection.getAccountInfo(key);
    return AccountLayout.decode(acc.data);
  }
  it("Initialize Payment", async () => {
    // Add your test here.
      const prevAliceState = await readaccount(aliceWallet)
      try{
        const tx = await program.methods.initialize(pda.idx,amount).accounts({
          applicationState:pda.stateKey,
          escrowWalletState:pda.escrowWalletKey,
          userSending:alice.publicKey,
          userReceiver:bob.publicKey,
          mintOfTokenSent:mintAddress,
          walletToWithdrawFrom:aliceWallet,
          tokenProgram:spl.TOKEN_PROGRAM_ID,
          systemProgram:anchor.web3.SystemProgram.programId,
          rent:anchor.web3.SYSVAR_RENT_PUBKEY
        }).signers([alice]).rpc();
        const applicationStateAcc = await program.account.state.fetch(pda.stateKey)
        const aliceState = await readaccount(aliceWallet);
        const escrow = await readaccount(pda.escrowWalletKey);
        expect(aliceState.amount.toString()).to.eql("1");
        expect(prevAliceState.amount.toString()).to.eql("2");
        expect(escrow.amount.toString()).to.eql("1");
        expect(applicationStateAcc.stage).to.eql({ fundsDeposited: {} });
      }catch(e){
        console.log(e);
      }
  });
  it("Compelete Payment",async() => {
      console.log(bobWallet)
      const prevBobState = await readaccount(bobWallet);
      amount = new anchor.BN(1);
      try{
        const tx1 = await program.methods.initialize(pda.idx,amount).accounts({
          applicationState:pda.stateKey,
          escrowWalletState:pda.escrowWalletKey,
          userSending:alice.publicKey,
          userReceiver:bob.publicKey,
          mintOfTokenSent:mintAddress,
          walletToWithdrawFrom:aliceWallet,
          tokenProgram:spl.TOKEN_PROGRAM_ID,
          systemProgram:anchor.web3.SystemProgram.programId,
          rent:anchor.web3.SYSVAR_RENT_PUBKEY
        }).signers([alice]).rpc();
      }catch(e){
        console.log(e);
      }
      try{
        const tx2 = await program.methods.compelete(pda.idx,pda.walletBump).accounts({
          applicationState:pda.stateKey,
          escrowWalletState:pda.escrowWalletKey,
          userSending:alice.publicKey,
          userReceiver:bob.publicKey,
          mintOfTokenSent:mintAddress,
          walletDepositTo:bobWallet,
          tokenProgram:spl.TOKEN_PROGRAM_ID,
          systemProgram:anchor.web3.SystemProgram.programId,
          associatedTokenProgram:spl.ASSOCIATED_TOKEN_PROGRAM_ID,
          rent:anchor.web3.SYSVAR_RENT_PUBKEY
        }).signers([bob]).rpc();
        const bobState = await readaccount(bobWallet);
        try{
          const escrow = await readaccount(pda.escrowWalletKey);
          return assert("Account should be closed");
        }catch(e){
          expect(e,"Cannot read properties of null (reading 'data')")
        }
        expect(bobState.amount.toString()).to.eql("1");
        expect(prevBobState.amount.toString()).to.eql("0");
      }catch(e){
        console.log(e);
      }
  })
});
