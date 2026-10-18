use clap::{Parser, Subcommand};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use veil_crypto::{
    classify_address, create_bid_witness_for, hexutil, verify_eligibility_proof, EligibilityProof,
    FundingNote, NullifierAccumulator, OrchardMembership, OrchardMerklePath, OrchardNoteTree,
    NONCE_LEN,
};

#[derive(Parser)]
#[command(name = "veil-crypto", about = "Prove and verify Veil eligibility proofs")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Prove,
    Verify,
    Nullifier,
    AccRoot,
    Address,
}

#[derive(Deserialize)]
struct ProveRequest {
    auction_id: String,
    bid_amount: u64,
    minimum_bid: u64,
    bond_requirement: u64,
    note: FundingNote,
    #[serde(default)]
    spent_nullifiers: Vec<String>,
    #[serde(default)]
    bid_nonce: Option<String>,
    #[serde(default)]
    funding_nonce: Option<String>,
    #[serde(default)]
    nf_nonce: Option<String>,
    orchard_path: Option<OrchardMerklePath>,
    orchard_anchor: Option<String>,
    #[serde(default)]
    extra_commitments: Vec<String>,
}

#[derive(Serialize)]
struct ProveResponse {
    proof: EligibilityProof,
    bid_nonce: String,
}

#[derive(Serialize)]
struct VerifyResponse {
    valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Deserialize)]
struct NoteRequest {
    note: FundingNote,
}

#[derive(Deserialize)]
struct AccRequest {
    #[serde(default)]
    nullifiers: Vec<String>,
}

fn main() {
    let cli = Cli::parse();
    let stdin = std::io::read_to_string(std::io::stdin()).expect("read stdin");
    match cli.command {
        Command::Prove => prove(&stdin),
        Command::Verify => verify(&stdin),
        Command::Nullifier => nullifier(&stdin),
        Command::AccRoot => acc_root(&stdin),
        Command::Address => classify(&stdin),
    }
}

fn prove(stdin: &str) {
    let req: ProveRequest = serde_json::from_str(stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
    let bid_nonce = parse_or_random_nonce(req.bid_nonce.as_deref());
    let funding_nonce = parse_or_random_nonce(req.funding_nonce.as_deref());
    let nf_nonce = parse_or_random_nonce(req.nf_nonce.as_deref());
    let spent = parse_u64s(&req.spent_nullifiers);
    let acc = NullifierAccumulator::from_observed(&spent)
        .unwrap_or_else(|e| exit_err(&e.to_string()));
    let membership = membership_from_request(&req).unwrap_or_else(|e| exit_err(&e.to_string()));
    let witness = create_bid_witness_for(
        req.note,
        &req.auction_id,
        req.bid_amount,
        bid_nonce,
        funding_nonce,
        nf_nonce,
        req.minimum_bid,
        req.bond_requirement,
        &acc,
        membership,
    )
    .unwrap_or_else(|e| exit_err(&e.to_string()));
    let body = ProveResponse {
        proof: witness.proof,
        bid_nonce: hex::encode(bid_nonce),
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

fn nullifier(stdin: &str) {
    let req: NoteRequest = serde_json::from_str(stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
    println!(
        "{}",
        serde_json::json!({ "nullifier": req.note.toy_nullifier().unwrap_or_else(|e| exit_err(&e.to_string())).to_string() })
    );
}

fn acc_root(stdin: &str) {
    let req: AccRequest = serde_json::from_str(stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
    let nfs = parse_u64s(&req.nullifiers);
    let acc = NullifierAccumulator::from_observed(&nfs)
        .unwrap_or_else(|e| exit_err(&e.to_string()));
    let observed: Vec<String> = acc.observed().into_iter().map(|n| n.to_string()).collect();
    println!(
        "{}",
        serde_json::json!({ "root": hex::encode(acc.root()), "nullifiers": observed })
    );
}

fn classify(stdin: &str) {
    let req: serde_json::Value = serde_json::from_str(stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
    let address = req
        .get("address")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| exit_err("address is required"));
    match classify_address(address) {
        Ok(info) => println!("{}", serde_json::to_string(&info).expect("json")),
        Err(e) => {
            println!("{}", serde_json::json!({ "error": e.to_string() }));
            std::process::exit(2);
        }
    }
}

fn membership_from_request(req: &ProveRequest) -> Result<Option<OrchardMembership>, String> {
    if let (Some(path), Some(anchor)) = (&req.orchard_path, req.orchard_anchor.as_deref()) {
        let anchor = hexutil::decode32(anchor)?;
        return Ok(Some(OrchardMembership {
            anchor,
            path: path.clone(),
        }));
    }
    if req.extra_commitments.is_empty() {
        return Ok(None);
    }
    let mut tree = OrchardNoteTree::new();
    for cmx in &req.extra_commitments {
        tree.append(hexutil::decode32(cmx)?).map_err(|e| e.to_string())?;
    }
    let position = tree
        .append(req.note.commitment().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    Ok(Some(tree.membership(position).map_err(|e| e.to_string())?))
}

fn parse_u64s(values: &[String]) -> Vec<u64> {
    values
        .iter()
        .map(|s| s.parse::<u64>().unwrap_or_else(|e| exit_err(&e.to_string())))
        .collect()
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
