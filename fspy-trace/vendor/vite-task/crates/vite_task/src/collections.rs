#[expect(clippy::disallowed_types, reason = "std HashMap needed for bincode/serde compatibility")]
pub type HashMap<K, V> = std::collections::HashMap<K, V>;
