use clap::{Parser, Subcommand};
use serde::Deserialize;
use veil_crypto::hexutil;
use veil_mpc::{private_argmax, split_bid, ArgmaxBid};

#[derive(Parser)]
#[command(name = "veil-mpc", about = "Share bids and run private argmax")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    Split,
    Argmax,
}

#[derive(Deserialize)]
struct SplitRequest {
    auction_id: String,
    bid_amount: u64,
    bid_nonce: String,
}

#[derive(Deserialize)]
struct ArgmaxRequest {
    bids: Vec<ArgmaxBid>,
}

fn main() {
    let cli = Cli::parse();
    let stdin = std::io::read_to_string(std::io::stdin()).expect("read stdin");
    match cli.command {
        Command::Split => {
            let req: SplitRequest =
                serde_json::from_str(&stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
            let nonce = hexutil::decode32(&req.bid_nonce).unwrap_or_else(|e| exit_err(&e));
            let shares = split_bid(&req.auction_id, req.bid_amount, &nonce)
                .unwrap_or_else(|e| exit_err(&e.to_string()));
            println!("{}", serde_json::to_string(&shares).expect("json"));
        }
        Command::Argmax => {
            let req: ArgmaxRequest =
                serde_json::from_str(&stdin).unwrap_or_else(|e| exit_err(&e.to_string()));
            let out = private_argmax(&req.bids).unwrap_or_else(|e| exit_err(&e.to_string()));
            println!("{}", serde_json::to_string(&out).expect("json"));
        }
    }
}

fn exit_err(msg: &str) -> ! {
    eprintln!("{msg}");
    std::process::exit(1);
}
