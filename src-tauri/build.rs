// Builds the runner's allowlist from the vendored contract: every command in
// vendor/jotted/schema.json, so the app can run nothing the pinned CLI doesn't have.
// Also builds in what CLI updates need (specs/CLI-updates-spec.md): the release signing key
// (vendor/jotted/release-key.pub) and the bundled CLI's version (jotted.lock).
use std::{env, fs, path::Path};

fn main() {
    let schema_path = Path::new("../vendor/jotted/schema.json");
    println!("cargo:rerun-if-changed={}", schema_path.display());
    let schema: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(schema_path).expect("vendor/jotted/schema.json"))
            .expect("schema.json is JSON");
    let names: Vec<String> = schema["commands"]
        .as_array()
        .expect("schema.json has commands")
        .iter()
        .map(|c| format!("{:?}", c["command"].as_str().expect("command name")))
        .collect();
    let out = format!(
        "/// Every command in the vendored schema.json (contract {}).\npub const SCHEMA_COMMANDS: &[&str] = &[{}];\n",
        schema["contract"],
        names.join(", ")
    );
    let out_dir = env::var("OUT_DIR").unwrap();
    fs::write(Path::new(&out_dir).join("schema_commands.rs"), out).unwrap();

    // The key jotted-cli signs release.json with. A release build without it can't be made;
    // a debug build compiles with updates off, until jotted-cli publishes the key.
    let key_path = Path::new("../vendor/jotted/release-key.pub");
    println!("cargo:rerun-if-changed={}", key_path.display());
    let key = match fs::read_to_string(key_path) {
        Ok(k) => format!("Some({:?})", k.trim()),
        Err(_) if env::var("PROFILE").as_deref() == Ok("release") => {
            panic!("vendor/jotted/release-key.pub is missing: a release build can't check CLI updates without it")
        }
        Err(_) => {
            println!("cargo:warning=vendor/jotted/release-key.pub is missing: CLI updates are off in this build");
            "None".into()
        }
    };
    let lock_path = Path::new("../jotted.lock");
    println!("cargo:rerun-if-changed={}", lock_path.display());
    let lock: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(lock_path).expect("jotted.lock")).expect("jotted.lock is JSON");
    let release = format!(
        "/// The release signing key (minisign), or None in a debug build made without it.\n\
         pub const RELEASE_KEY: Option<&str> = {key};\n\
         /// The CLI version bundled in the app (jotted.lock).\n\
         pub const BUNDLED_VERSION: &str = {:?};\n\
         pub const BUNDLED_CONTRACT: u32 = {};\n",
        lock["version"].as_str().expect("jotted.lock version"),
        lock["contract"].as_u64().expect("jotted.lock contract"),
    );
    fs::write(Path::new(&out_dir).join("release.rs"), release).unwrap();
    tauri_build::build()
}
