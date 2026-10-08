pub mod u64_string {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<u64, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = StringOrNumber::deserialize(deserializer)?;
        match raw {
            StringOrNumber::String(s) => s.parse().map_err(serde::de::Error::custom),
            StringOrNumber::Number(n) => Ok(n),
        }
    }

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrNumber {
        String(String),
        Number(u64),
    }
}

pub fn decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).map_err(|e| e.to_string())
}

pub fn decode32(s: &str) -> Result<[u8; 32], String> {
    let bytes = decode(s)?;
    bytes
        .try_into()
        .map_err(|_| "expected 32 bytes".to_string())
}

pub mod hex32_serde {
    use super::decode32;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&hex::encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        decode32(&s).map_err(serde::de::Error::custom)
    }
}

pub mod hex32_list_serde {
    use super::decode32;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(items: &[[u8; 32]], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let encoded: Vec<String> = items.iter().map(|b| hex::encode(b)).collect();
        encoded.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<[u8; 32]>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let encoded = Vec::<String>::deserialize(deserializer)?;
        encoded
            .into_iter()
            .map(|s| decode32(&s).map_err(serde::de::Error::custom))
            .collect()
    }
}

pub mod hex_vec_serde {
    use super::decode;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&hex::encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        decode(&s).map_err(serde::de::Error::custom)
    }
}
