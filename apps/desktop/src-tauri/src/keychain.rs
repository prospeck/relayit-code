use base64::{engine::general_purpose::STANDARD, Engine};

const SERVICE: &str = "app.relayit.desktop";
const ACCOUNT: &str = "master-key";

/// Returns the base64 master key, creating and storing a new random one on first launch.
pub fn master_key() -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(k) if STANDARD.decode(&k).map(|b| b.len() == 32).unwrap_or(false) => Ok(k),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            let mut bytes = [0u8; 32];
            getrandom::fill(&mut bytes).map_err(|e| e.to_string())?;
            let k = STANDARD.encode(bytes);
            entry.set_password(&k).map_err(|e| e.to_string())?;
            Ok(k)
        }
        Err(e) => Err(e.to_string()),
    }
}
