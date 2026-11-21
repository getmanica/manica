//! Build-time inputs from the rest of the repo:
//! - the agent's version, from package.json, which release-please bumps (and
//!   the release workflow sets for previews), so Cargo.toml's stays 0.0.0;
//! - the plane's agent API types, generated from the OpenAPI spec the
//!   plane's tests keep (apps/plane/openapi/agent.json): a change to the API
//!   that no longer fits the agent fails its build, as Eden's types did.
use std::{env, error::Error, fs, path::Path};

const SPEC: &str = "../plane/openapi/agent.json";

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=package.json");
    println!("cargo:rerun-if-changed={SPEC}");

    let package: serde_json::Value = serde_json::from_str(&fs::read_to_string("package.json")?)?;
    let version = package
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or("package.json has no version")?;
    println!("cargo:rustc-env=MANICA_AGENT_VERSION={version}");

    // The spec's schemas, referring to each other as JSON Schema
    // definitions, which is what typify resolves.
    let spec = fs::read_to_string(SPEC)
        .map_err(|error| format!("reading {SPEC}: {error}"))?
        .replace("#/components/schemas/", "#/definitions/");
    let spec: serde_json::Value = serde_json::from_str(&spec)?;
    let schemas = spec
        .pointer("/components/schemas")
        .and_then(serde_json::Value::as_object)
        .ok_or("the agent API spec has no schemas")?
        .iter()
        .map(|(name, schema)| {
            serde_json::from_value::<schemars::schema::Schema>(schema.clone())
                .map(|schema| (name.clone(), schema))
                .map_err(|error| format!("schema {name}: {error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut types = typify::TypeSpace::new(&typify::TypeSpaceSettings::default());
    types.add_ref_types(schemas)?;
    let file: syn::File = syn::parse2(types.to_stream()?)?;
    let out = Path::new(&env::var("OUT_DIR")?).join("api.rs");
    fs::write(out, prettyplease::unparse(&file))?;
    Ok(())
}
