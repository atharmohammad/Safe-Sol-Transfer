import * as anchor from "@project-serum/anchor";
import * as spl from "@solana/spl-token";
import { Program } from "@project-serum/anchor";
import { Escrow } from "../target/types/escrow";

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

  // define helper functions
  const getPdaParams = async(connection: anchor.web3.Connection, alice:anchor.web3.PublicKey, bob:anchor.web3.PublicKey , mint:anchor.web3.PublicKey) : Promise<PDAparams> =>{
    const uid = new anchor.BN(parseInt((Date.now()/1000).toString()));
    const uidBuffer = uid.toBuffer('le',8);

    const [statePubkey,stateBump] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("state"),alice.toBuffer(),bob.toBuffer(),mint.toBuffer(),uidBuffer],
      program.programId);

    const [walletPubkey,walletBump] = await anchor.web3.PublicKey.findProgramAddress(
        [Buffer.from("wallet"),alice.toBuffer(),bob.toBuffer(),mint.toBuffer(),uidBuffer],
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

  // it("Is initialized!", async () => {
  //   // Add your test here.
  //   const tx = await program.methods.initialize().rpc();
  //   console.log("Your transaction signature", tx);
  // });
});
