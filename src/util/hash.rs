use md5::{Digest, Md5};
use sha2::{Digest, Sha256};

pub fn md5_hex(input: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}

pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let result = hasher.finalize();
    hex::encode(result)
}
