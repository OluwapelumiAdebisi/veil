use clap::{Parser, Subcommand};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use veil_crypto::{
    create_bid_witness, hexutil, verify_eligibility_proof, EligibilityProof, ToyNote, NONCE_LEN,
};

#[derive(Parser)]
#[command(name = "veil-crypto", about = "Prove and verify Veil eligibility proofs")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Build a proof locally. Secrets stay on stdin; stdout is public proof JSON.
    Prove,
    /// Verify a public eligibility proof from stdin.
    Verify,
}

#[derive(Deserialize)]
struct ProveRequest {
    auction_id: String,
    bid_amount: u64,
    minimum_bid: u64,
    bond_requirement: u64,
    note: ToyNote,
    #[serde(default)]
    bid_nonce: Option<String>,
    #[serde(default)]
    funding_nonce: Option<String>,
}

#[derive(Serialize)]
struct ProveResponse {
    proof: EligibilityProof,
}

#[derive(Serialize)]
struct VerifyResponse {
    valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn main() {
    let cli = Cli::parse();
    let stdin = std::io::read_to_string(std::io::stdin()).expect("read stdin");
    match cli.command {
        Command::Prove => prove(&stdin),
        Command::Verify => verify(&stdin),
    }
}

fn prove(stdin: &str) {
    let req: ProveRequest = serde_json::from_str(stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
    let bid_nonce = parse_or_random_nonce(req.bid_nonce.as_deref());
    let funding_nonce = parse_or_random_nonce(req.funding_nonce.as_deref());
    let witness = create_bid_witness(
        req.note,
        &req.auction_id,
        req.bid_amount,
        bid_nonce,
        funding_nonce,
        req.minimum_bid,
        req.bond_requirement,
    )
    .unwrap_or_else(|e| exit_err(&e.to_string()));
    let body = ProveResponse {
        proof: witness.proof,
    };
    println!("{}", serde_json::to_string_pretty(&body).expect("json"));
}

fn verify(stdin: &str) {
    let proof: EligibilityProof =
        serde_json::from_str(stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
    match verify_eligibility_proof(&proof) {
        Ok(()) => {
            let body = VerifyResponse {
                valid: true,
                error: None,
            };
            println!("{}", serde_json::to_string(&body).expect("json"));
        }
        Err(e) => {
            let body = VerifyResponse {
                valid: false,
                error: Some(e.to_string()),
            };
            println!("{}", serde_json::to_string(&body).expect("json"));
            std::process::exit(2);
        }
    }
}

fn parse_or_random_nonce(value: Option<&str>) -> [u8; NONCE_LEN] {
    match value {
        Some(s) => hexutil::decode32(s).unwrap_or_else(|e| exit_err(&e)),
        None => {
            let mut n = [0u8; NONCE_LEN];
            rand::thread_rng().fill_bytes(&mut n);
            n
        }
    }
}

fn exit_err(msg: &str) -> ! {
    eprintln!("{msg}");
    std::process::exit(1);
}
