use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::{rand_core::OsRng, SaltString};
use rand::{distributions::Alphanumeric, Rng};

pub fn random_string(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

/// Generate an Argon2id password hash with a random salt.
/// The salt is embedded in the returned hash string (modular crypt format).
pub fn hash_password(password: &str) -> String {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .unwrap()
        .to_string()
}

/// Verify a password against an Argon2id hash string.
/// Supports legacy double-MD5 hashes for backward compatibility during migration.
pub fn verify_password(password: &str, hash: &str) -> bool {
    // Try Argon2 first
    if hash.starts_with("$argon2") {
        return argon2::verify_password(password.as_bytes(), hash).is_ok();
    }
    // Fallback: legacy double-MD5 with salt column
    // This path only works if salt is provided separately; see verify_password_legacy
    false
}

/// Legacy verification for double-MD5 hashes (used during migration).
/// `salt` must be stored separately in the users table.
pub fn verify_password_legacy(password: &str, salt: &str, hash: &str) -> bool {
    if hash.starts_with("$argon2") {
        return verify_password(password, hash);
    }
    let first = md5_hex(&format!("{}{}", password, salt));
    let expected = md5_hex(&format!("{}{}", first, salt));
    constant_time_eq(hash, &expected)
}

/// Constant-time string comparison to prevent timing attacks.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let a_bytes = a.as_bytes();
    let b_bytes = b.as_bytes();
    let mut result: u8 = 0;
    for i in 0..a_bytes.len() {
        result |= a_bytes[i] ^ b_bytes[i];
    }
    result == 0
}

// Kept for backward compatibility with existing call sites during migration.
pub fn gen_encrypted_password(password: &str, _salt: &str) -> String {
    hash_password(password)
}

// Re-export md5_hex for legacy verification path
use crate::util::hash::md5_hex;