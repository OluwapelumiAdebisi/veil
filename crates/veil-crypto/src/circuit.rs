use std::fs::File;
use std::path::PathBuf;
use std::sync::OnceLock;

use ff::{Field, FromUniformBytes};
use halo2_proofs::{
    circuit::{AssignedCell, Layouter, SimpleFloorPlanner, Value},
    plonk::{
        create_proof, keygen_pk, keygen_vk, verify_proof, Advice, Circuit, Column, ConstraintSystem,
        Error, Expression, Fixed, Instance, ProvingKey, Selector, SingleVerifier,
    },
    poly::{commitment::Params, Rotation},
    transcript::{Blake2bRead, Blake2bWrite, Challenge255},
};
use pasta_curves::{pallas, vesta};
use rand::rngs::OsRng;

use crate::error::VeilCryptoError;

type Fp = pallas::Base;
type EqAffine = vesta::Affine;

pub const K: u32 = 9;
const RANGE_BITS: usize = 64;

#[derive(Clone, Debug)]
struct EligibilityConfig {
    bit: Column<Advice>,
    acc: Column<Advice>,
    val: Column<Advice>,
    pow: Column<Fixed>,
    instance: Column<Instance>,
    q_bit: Selector,
    q_acc: Selector,
    q_first: Selector,
    q_sub: Selector,
}

#[derive(Clone, Default)]
struct EligibilityCircuit {
    bid_minus_min: Value<u64>,
    funding_minus_bid: Value<u64>,
    funding_minus_bond: Value<u64>,
    nf_gap_left: Value<u64>,
    nf_gap_right: Value<u64>,
    bid: Value<u64>,
    funding: Value<u64>,
    nf: Value<u64>,
}

impl Circuit<Fp> for EligibilityCircuit {
    type Config = EligibilityConfig;
    type FloorPlanner = SimpleFloorPlanner;

    fn without_witnesses(&self) -> Self {
        Self::default()
    }

    fn configure(meta: &mut ConstraintSystem<Fp>) -> Self::Config {
        let bit = meta.advice_column();
        let acc = meta.advice_column();
        let val = meta.advice_column();
        let pow = meta.fixed_column();
        let instance = meta.instance_column();
        let q_bit = meta.selector();
        let q_acc = meta.selector();
        let q_first = meta.selector();
        let q_sub = meta.selector();

        meta.enable_equality(acc);
        meta.enable_equality(val);
        meta.enable_equality(instance);

        meta.create_gate("bit", |meta| {
            let q = meta.query_selector(q_bit);
            let bit = meta.query_advice(bit, Rotation::cur());
            vec![q * bit.clone() * (bit - Expression::Constant(Fp::ONE))]
        });

        meta.create_gate("acc-first", |meta| {
            let q = meta.query_selector(q_first);
            let bit = meta.query_advice(bit, Rotation::cur());
            let acc = meta.query_advice(acc, Rotation::cur());
            vec![q * (acc - bit)]
        });

        meta.create_gate("acc", |meta| {
            let q = meta.query_selector(q_acc);
            let bit = meta.query_advice(bit, Rotation::cur());
            let acc_prev = meta.query_advice(acc, Rotation::prev());
            let acc = meta.query_advice(acc, Rotation::cur());
            let pow = meta.query_fixed(pow);
            vec![q * (acc - acc_prev - bit * pow)]
        });

        meta.create_gate("sub", |meta| {
            let q = meta.query_selector(q_sub);
            let left = meta.query_advice(val, Rotation::cur());
            let right = meta.query_advice(val, Rotation::next());
            let diff = meta.query_advice(acc, Rotation::cur());
            vec![q * (left - right - diff)]
        });

        EligibilityConfig {
            bit,
            acc,
            val,
            pow,
            instance,
            q_bit,
            q_acc,
            q_first,
            q_sub,
        }
    }

    fn synthesize(
        &self,
        config: Self::Config,
        mut layouter: impl Layouter<Fp>,
    ) -> Result<(), Error> {
        let bid_minus_min = assign_range(&config, &mut layouter, self.bid_minus_min)?;
        let funding_minus_bid = assign_range(&config, &mut layouter, self.funding_minus_bid)?;
        let funding_minus_bond = assign_range(&config, &mut layouter, self.funding_minus_bond)?;
        let nf_gap_left = assign_range(&config, &mut layouter, self.nf_gap_left)?;
        let nf_gap_right = assign_range(&config, &mut layouter, self.nf_gap_right)?;

        let bid = assign_value(&config, &mut layouter, self.bid)?;
        let funding = assign_value(&config, &mut layouter, self.funding)?;
        let nf = assign_value(&config, &mut layouter, self.nf)?;

        let _statement = constrain_instance(&config, &mut layouter, 0)?;
        let min = constrain_instance(&config, &mut layouter, 1)?;
        let bond = constrain_instance(&config, &mut layouter, 2)?;
        let left = constrain_instance(&config, &mut layouter, 3)?;
        let right = constrain_instance(&config, &mut layouter, 4)?;

        constrain_sub(&config, &mut layouter, &bid, &min, &bid_minus_min)?;
        constrain_sub(&config, &mut layouter, &funding, &bid, &funding_minus_bid)?;
        constrain_sub(&config, &mut layouter, &funding, &bond, &funding_minus_bond)?;

        let tmp_nf_left = assign_sub_result(&config, &mut layouter, &nf, &left)?;
        let one = assign_literal(&config, &mut layouter, Fp::ONE)?;
        constrain_sub(&config, &mut layouter, &tmp_nf_left, &nf_gap_left, &one)?;

        let tmp_right_nf = assign_sub_result(&config, &mut layouter, &right, &nf)?;
        constrain_sub(&config, &mut layouter, &tmp_right_nf, &nf_gap_right, &one)?;

        Ok(())
    }
}

fn assign_range(
    config: &EligibilityConfig,
    layouter: &mut impl Layouter<Fp>,
    value: Value<u64>,
) -> Result<AssignedCell<Fp, Fp>, Error> {
    layouter.assign_region(
        || "range",
        |mut region| {
            let mut acc_cell = None;
            let mut running = Value::known(Fp::ZERO);
            for i in 0..RANGE_BITS {
                let bit_val = value.map(|v| Fp::from((v >> i) & 1));
                config.q_bit.enable(&mut region, i)?;
                if i == 0 {
                    config.q_first.enable(&mut region, i)?;
                } else {
                    config.q_acc.enable(&mut region, i)?;
                }
                region.assign_advice(|| "bit", config.bit, i, || bit_val)?;
                let pow = Fp::from(1u64 << i);
                region.assign_fixed(|| "pow", config.pow, i, || Value::known(pow))?;
                running = running + bit_val * Value::known(pow);
                acc_cell = Some(region.assign_advice(|| "acc", config.acc, i, || running)?);
            }
            Ok(acc_cell.unwrap())
        },
    )
}

fn assign_value(
    config: &EligibilityConfig,
    layouter: &mut impl Layouter<Fp>,
    value: Value<u64>,
) -> Result<AssignedCell<Fp, Fp>, Error> {
    layouter.assign_region(
        || "value",
        |mut region| region.assign_advice(|| "v", config.val, 0, || value.map(Fp::from)),
    )
}

fn assign_literal(
    config: &EligibilityConfig,
    layouter: &mut impl Layouter<Fp>,
    value: Fp,
) -> Result<AssignedCell<Fp, Fp>, Error> {
    layouter.assign_region(
        || "lit",
        |mut region| region.assign_advice(|| "v", config.val, 0, || Value::known(value)),
    )
}

fn constrain_instance(
    config: &EligibilityConfig,
    layouter: &mut impl Layouter<Fp>,
    row: usize,
) -> Result<AssignedCell<Fp, Fp>, Error> {
    layouter.assign_region(
        || "instance",
        |mut region| {
            region.assign_advice_from_instance(|| "pub", config.instance, row, config.val, 0)
        },
    )
}

fn constrain_sub(
    config: &EligibilityConfig,
    layouter: &mut impl Layouter<Fp>,
    left: &AssignedCell<Fp, Fp>,
    right: &AssignedCell<Fp, Fp>,
    diff: &AssignedCell<Fp, Fp>,
) -> Result<(), Error> {
    layouter.assign_region(
        || "sub",
        |mut region| {
            config.q_sub.enable(&mut region, 0)?;
            left.copy_advice(|| "left", &mut region, config.val, 0)?;
            right.copy_advice(|| "right", &mut region, config.val, 1)?;
            diff.copy_advice(|| "diff", &mut region, config.acc, 0)?;
            Ok(())
        },
    )
}

fn assign_sub_result(
    config: &EligibilityConfig,
    layouter: &mut impl Layouter<Fp>,
    left: &AssignedCell<Fp, Fp>,
    right: &AssignedCell<Fp, Fp>,
) -> Result<AssignedCell<Fp, Fp>, Error> {
    layouter.assign_region(
        || "sub-result",
        |mut region| {
            config.q_sub.enable(&mut region, 0)?;
            left.copy_advice(|| "left", &mut region, config.val, 0)?;
            right.copy_advice(|| "right", &mut region, config.val, 1)?;
            let l = left.value().copied();
            let r = right.value().copied();
            region.assign_advice(|| "diff", config.acc, 0, || l - r)
        },
    )
}

struct Keys {
    params: Params<EqAffine>,
    pk: ProvingKey<EqAffine>,
}

fn params_path() -> PathBuf {
    let dir = std::env::var("VEIL_HALO2_DIR")
        .or_else(|_| std::env::var("CARGO_TARGET_DIR"))
        .unwrap_or_else(|_| "target".into());
    PathBuf::from(dir).join(format!("veil-halo2-k{K}.params"))
}

fn load_params() -> Params<EqAffine> {
    let path = params_path();
    if let Ok(mut file) = File::open(&path) {
        if let Ok(params) = Params::read(&mut file) {
            if params.k() == K {
                return params;
            }
        }
    }
    let params = Params::new(K);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
        if let Ok(mut file) = File::create(&path) {
            let _ = params.write(&mut file);
        }
    }
    params
}

fn keys() -> &'static Keys {
    static KEYS: OnceLock<Keys> = OnceLock::new();
    KEYS.get_or_init(|| {
        let params = load_params();
        let empty = EligibilityCircuit::default();
        let vk = keygen_vk(&params, &empty).expect("vk");
        let pk = keygen_pk(&params, vk, &empty).expect("pk");
        Keys { params, pk }
    })
}

pub fn statement_fp(preimage: &[u8]) -> Fp {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"VEIL-HALO2-V1");
    hasher.update(preimage);
    let hash = hasher.finalize();
    let mut wide = [0u8; 64];
    wide[..32].copy_from_slice(hash.as_bytes());
    Fp::from_uniform_bytes(&wide)
}

fn instance_values(
    statement: Fp,
    minimum_bid: u64,
    bond_requirement: u64,
    interval_left: u64,
    interval_right: u64,
) -> [Fp; 5] {
    [
        statement,
        Fp::from(minimum_bid),
        Fp::from(bond_requirement),
        Fp::from(interval_left),
        Fp::from(interval_right),
    ]
}

pub fn prove_eligibility(
    statement: Fp,
    minimum_bid: u64,
    bond_requirement: u64,
    interval_left: u64,
    interval_right: u64,
    bid_amount: u64,
    funding: u64,
    nf: u64,
) -> Result<Vec<u8>, VeilCryptoError> {
    if bid_amount < minimum_bid {
        return Err(VeilCryptoError::BidBelowMinimum);
    }
    if funding < bid_amount {
        return Err(VeilCryptoError::InsufficientFunds);
    }
    if funding < bond_requirement {
        return Err(VeilCryptoError::BondRequirement);
    }
    if nf <= interval_left || nf >= interval_right {
        return Err(VeilCryptoError::InvalidAccumulator);
    }

    let circuit = EligibilityCircuit {
        bid_minus_min: Value::known(bid_amount - minimum_bid),
        funding_minus_bid: Value::known(funding - bid_amount),
        funding_minus_bond: Value::known(funding - bond_requirement),
        nf_gap_left: Value::known(nf - interval_left - 1),
        nf_gap_right: Value::known(interval_right - 1 - nf),
        bid: Value::known(bid_amount),
        funding: Value::known(funding),
        nf: Value::known(nf),
    };
    let keys = keys();
    let inst = instance_values(
        statement,
        minimum_bid,
        bond_requirement,
        interval_left,
        interval_right,
    );
    let mut transcript = Blake2bWrite::<Vec<u8>, EqAffine, Challenge255<EqAffine>>::init(vec![]);
    create_proof(
        &keys.params,
        &keys.pk,
        &[circuit],
        &[&[&inst[..]]],
        OsRng,
        &mut transcript,
    )
    .map_err(|_| VeilCryptoError::InvalidRangeProof)?;
    Ok(transcript.finalize())
}

pub fn verify_eligibility(
    statement: Fp,
    minimum_bid: u64,
    bond_requirement: u64,
    interval_left: u64,
    interval_right: u64,
    proof: &[u8],
) -> Result<(), VeilCryptoError> {
    let keys = keys();
    let inst = instance_values(
        statement,
        minimum_bid,
        bond_requirement,
        interval_left,
        interval_right,
    );
    let strategy = SingleVerifier::new(&keys.params);
    let mut transcript = Blake2bRead::<&[u8], EqAffine, Challenge255<EqAffine>>::init(proof);
    verify_proof(
        &keys.params,
        keys.pk.get_vk(),
        strategy,
        &[&[&inst[..]]],
        &mut transcript,
    )
    .map_err(|_| VeilCryptoError::InvalidRangeProof)
}
