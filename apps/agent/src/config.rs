use std::{
    env, fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

use toml::{Table, Value};
use url::Url;

use crate::{
    errors::AgentError,
    lines::error,
    vm::{backend::VM_PREFIX, backends::BackendName},
};

/// Seconds between polls: how soon a queued job is picked up. Runner leases
/// last a minute, so polls stay well within that.
const POLL_INTERVAL: Limits = Limits {
    min: 1,
    max: 20,
    default: 5,
};

/// Seconds between metrics readings, when reported. The plane keeps one
/// reading per agent every 15 seconds at most.
const METRICS_INTERVAL: Limits = Limits {
    min: 15,
    max: 600,
    default: 30,
};

/// The seconds a setting takes, and what it is if not set.
#[derive(Debug, Clone, Copy)]
struct Limits {
    min: u16,
    max: u16,
    default: u16,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub plane: PlaneConfig,
    /// Where runner builds are kept and runners run.
    pub data_dir: PathBuf,
    /// Between metrics readings, or none if they aren't reported.
    pub metrics_interval: Option<Duration>,
    /// Run each job in a fresh VM of its own instead of on this machine.
    pub vm: Option<VmConfig>,
}

#[derive(Clone)]
pub struct PlaneConfig {
    /// Where the plane is reachable: its origin.
    pub url: Url,
    pub token: String,
    pub poll_interval: Duration,
}

/// Without the token, which isn't for logs.
impl std::fmt::Debug for PlaneConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlaneConfig")
            .field("url", &self.url.as_str())
            .field("poll_interval", &self.poll_interval)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VmConfig {
    pub backend: BackendName,
    /// The stopped VM jobs are cloned from, as the backend names it.
    pub image: String,
}

fn home() -> PathBuf {
    env::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

fn env_dir(name: &str) -> Option<PathBuf> {
    env::var_os(name)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// $`XDG_CONFIG_HOME/manica`, falling back to ~/.config/manica (also on macOS).
#[must_use]
pub fn default_config_dir() -> PathBuf {
    env_dir("XDG_CONFIG_HOME")
        .unwrap_or_else(|| home().join(".config"))
        .join("manica")
}

/// $`XDG_DATA_HOME/manica`, falling back to ~/.local/share/manica (also on
/// macOS).
#[must_use]
pub fn default_data_dir() -> PathBuf {
    env_dir("XDG_DATA_HOME")
        .unwrap_or_else(|| home().join(".local").join("share"))
        .join("manica")
}

/// Loads `<dir>/config.toml`. `MANICA_AGENT_TOKEN` takes precedence over the
/// token in the file.
///
/// # Errors
///
/// `ConfigNotFound` if there's no config, `InvalidConfig` if it's wrong.
pub fn load_config(dir: &Path) -> Result<Config, AgentError> {
    load_config_with(dir, env::var("MANICA_AGENT_TOKEN").ok())
}

/// Loads `<dir>/config.toml`, with `env_token` as `MANICA_AGENT_TOKEN`.
///
/// # Errors
///
/// As `load_config`.
pub fn load_config_with(dir: &Path, env_token: Option<String>) -> Result<Config, AgentError> {
    let path = dir.join("config.toml");
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(AgentError::ConfigNotFound(path));
        }
        Err(error) => {
            return Err(AgentError::InvalidConfig {
                path,
                reason: error.to_string(),
            });
        }
    };
    warn_if_readable_by_others(&path);

    let invalid = |reason: String| AgentError::InvalidConfig {
        path: path.clone(),
        reason,
    };
    let raw: Table = text.parse().map_err(|error: toml::de::Error| {
        let line = error
            .span()
            .and_then(|span| text.get(..span.start))
            .map(|before| before.matches('\n').count() + 1);
        invalid(line.map_or_else(
            || error.message().to_owned(),
            |line| format!("line {line}: {}", error.message()),
        ))
    })?;
    let env_token = env_token.filter(|token| !token.is_empty());
    let mut issues = Issues::default();
    let config = parse(&raw, env_token, &mut issues);
    match config {
        Some(config) if issues.0.is_empty() => Ok(config),
        _ => Err(invalid(issues.0.join("; "))),
    }
}

/// The config holds the agent token, so it shouldn't be readable by others.
fn warn_if_readable_by_others(path: &Path) {
    if let Ok(metadata) = fs::metadata(path)
        && metadata.permissions().mode() & 0o077 != 0
    {
        let path = path.display();
        error(&format!(
            "warning: {path} is accessible by other users; run: chmod 600 {path}"
        ));
    }
}

/// What's wrong with the config, as `<dotted path>: <reason>`: all of it,
/// not only the first.
#[derive(Default)]
struct Issues(Vec<String>);

impl Issues {
    fn add(&mut self, path: &str, reason: impl AsRef<str>) {
        self.0.push(format!("{path}: {}", reason.as_ref()));
    }
}

fn join(prefix: &str, key: &str) -> String {
    if prefix.is_empty() {
        key.to_owned()
    } else {
        format!("{prefix}.{key}")
    }
}

/// Strict tables, so a misspelled key is reported instead of ignored.
fn check_keys(table: &Table, prefix: &str, known: &[&str], issues: &mut Issues) {
    for key in table.keys() {
        if !known.contains(&key.as_str()) {
            issues.add(&join(prefix, key), "unknown key");
        }
    }
}

/// The table at `key`, an empty one if it's missing (optional sections), or
/// None if it isn't a table.
fn section<'a>(table: &'a Table, key: &str, issues: &mut Issues) -> Option<&'a Table> {
    static EMPTY: std::sync::LazyLock<Table> = std::sync::LazyLock::new(Table::new);
    match table.get(key) {
        None => Some(&EMPTY),
        Some(Value::Table(table)) => Some(table),
        Some(_) => {
            issues.add(key, "must be a table");
            None
        }
    }
}

fn string<'a>(table: &'a Table, path: &str, key: &str, issues: &mut Issues) -> Option<&'a str> {
    if let Value::String(value) = table.get(key)? {
        Some(value)
    } else {
        issues.add(&join(path, key), "must be a string");
        None
    }
}

/// A number of seconds within `limits`, or their default if missing (or
/// wrong, which is reported).
fn seconds(table: &Table, path: &str, key: &str, limits: Limits, issues: &mut Issues) -> Duration {
    let path = join(path, key);
    let (min, max) = (f64::from(limits.min), f64::from(limits.max));
    let value = match table.get(key) {
        None => f64::from(limits.default),
        Some(Value::Integer(value)) => match i32::try_from(*value) {
            Ok(value) => f64::from(value),
            Err(_) if *value < 0 => f64::NEG_INFINITY,
            Err(_) => f64::INFINITY,
        },
        Some(Value::Float(value)) => *value,
        Some(_) => {
            issues.add(&path, "must be a number");
            f64::from(limits.default)
        }
    };
    let unit = |n: u16| if n == 1 { "second" } else { "seconds" };
    // TOML has nan, which no comparison catches.
    if value.is_nan() {
        issues.add(&path, "must be a number");
    } else if value < min {
        issues.add(
            &path,
            format!("must be at least {min} {}", unit(limits.min)),
        );
    } else if value > max {
        issues.add(&path, format!("must be at most {max} {}", unit(limits.max)));
    } else {
        return Duration::from_secs_f64(value);
    }
    Duration::from_secs(u64::from(limits.default))
}

/// The config, if it's right enough to make one: whether it's right at all
/// is whether there are issues.
fn parse(raw: &Table, env_token: Option<String>, issues: &mut Issues) -> Option<Config> {
    check_keys(raw, "", &["plane", "agent", "metrics", "vm"], issues);
    let plane = parse_plane(raw, env_token, issues);
    let data_dir = parse_agent(raw, issues);
    let metrics_interval = parse_metrics(raw, issues);
    let vm = parse_vm(raw, issues);
    Some(Config {
        plane: plane?,
        data_dir,
        metrics_interval,
        vm,
    })
}

fn parse_plane(raw: &Table, env_token: Option<String>, issues: &mut Issues) -> Option<PlaneConfig> {
    let plane = match raw.get("plane") {
        None => {
            issues.add("plane", "is required");
            return None;
        }
        Some(Value::Table(plane)) => plane,
        Some(_) => {
            issues.add("plane", "must be a table");
            return None;
        }
    };
    check_keys(plane, "plane", &["url", "token", "poll_interval"], issues);

    let url = match string(plane, "plane", "url", issues) {
        None if !plane.contains_key("url") => {
            issues.add("plane.url", "is required");
            None
        }
        None => None,
        Some(url) => match Url::parse(url) {
            Ok(url) if url.scheme() == "http" || url.scheme() == "https" => Some(url),
            _ => {
                issues.add("plane.url", "must be an http(s) URL");
                None
            }
        },
    };

    let token = env_token.or_else(|| match plane.get("token") {
        Some(Value::String(token)) if !token.is_empty() => Some(token.clone()),
        None | Some(Value::String(_)) => {
            issues.add("plane.token", "is required (or set MANICA_AGENT_TOKEN)");
            None
        }
        Some(_) => {
            issues.add("plane.token", "must be a string");
            None
        }
    });

    let poll_interval = seconds(plane, "plane", "poll_interval", POLL_INTERVAL, issues);
    Some(PlaneConfig {
        url: url?,
        token: token?,
        poll_interval,
    })
}

/// `agent.data_dir`, or the default one.
fn parse_agent(raw: &Table, issues: &mut Issues) -> PathBuf {
    let Some(agent) = section(raw, "agent", issues) else {
        return default_data_dir();
    };
    check_keys(agent, "agent", &["data_dir"], issues);
    match string(agent, "agent", "data_dir", issues) {
        Some("") => {
            issues.add("agent.data_dir", "can't be empty");
            default_data_dir()
        }
        Some(dir) => PathBuf::from(dir),
        None => default_data_dir(),
    }
}

/// Report this machine's CPU, memory and disk use to the plane, with the
/// polls, this often. Off unless enabled.
fn parse_metrics(raw: &Table, issues: &mut Issues) -> Option<Duration> {
    let metrics = section(raw, "metrics", issues)?;
    check_keys(metrics, "metrics", &["enabled", "interval"], issues);
    let enabled = match metrics.get("enabled") {
        None => false,
        Some(Value::Boolean(enabled)) => *enabled,
        Some(_) => {
            issues.add("metrics.enabled", "must be a boolean");
            false
        }
    };
    let interval = seconds(metrics, "metrics", "interval", METRICS_INTERVAL, issues);
    enabled.then_some(interval)
}

/// Run each job in a fresh VM of its own, cloned from `image`, instead of
/// on this machine.
fn parse_vm(raw: &Table, issues: &mut Issues) -> Option<VmConfig> {
    let Value::Table(vm) = raw.get("vm")? else {
        issues.add("vm", "must be a table");
        return None;
    };
    check_keys(vm, "vm", &["backend", "image"], issues);
    let names = BackendName::ALL
        .iter()
        .map(|name| name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    let backend = match string(vm, "vm", "backend", issues) {
        None if !vm.contains_key("backend") => {
            issues.add("vm.backend", "is required");
            None
        }
        None => None,
        Some(name) => {
            let backend = BackendName::from_name(name);
            if backend.is_none() {
                issues.add("vm.backend", format!("must be one of: {names}"));
            }
            backend
        }
    };
    // Not named like the VMs the agent makes: it would delete it as one a
    // previous agent left behind.
    let image = match string(vm, "vm", "image", issues) {
        None if !vm.contains_key("image") => {
            issues.add("vm.image", "is required");
            None
        }
        None => None,
        Some("") => {
            issues.add("vm.image", "can't be empty");
            None
        }
        Some(image) if image.starts_with(VM_PREFIX) => {
            issues.add(
                "vm.image",
                format!("can't start with {VM_PREFIX}, which names the VMs jobs run in"),
            );
            None
        }
        Some(image) => Some(image.to_owned()),
    };
    Some(VmConfig {
        backend: backend?,
        image: image?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{temp_dir, write_config};

    fn load(extra: &str) -> Result<Config, AgentError> {
        let dir = temp_dir();
        write_config(
            &dir,
            &format!("[plane]\nurl = \"http://plane.test\"\ntoken = \"mna_x\"\n{extra}"),
        );
        load_config_with(&dir, None)
    }

    fn error(extra: &str) -> String {
        load(extra).unwrap_err().to_string()
    }

    #[test]
    fn reads_the_plane_with_defaults() {
        let config = load("").unwrap();
        assert_eq!(config.plane.url.as_str(), "http://plane.test/");
        assert_eq!(config.plane.token, "mna_x");
        assert_eq!(config.plane.poll_interval, Duration::from_secs(5));
        assert_eq!(config.data_dir, default_data_dir());
    }

    #[test]
    fn vm_is_optional() {
        assert_eq!(load("").unwrap().vm, None);
    }

    #[test]
    fn vm_takes_a_known_backend_and_an_image() {
        assert_eq!(
            load("[vm]\nbackend = \"lima\"\nimage = \"manica-golden\"\n")
                .unwrap()
                .vm,
            Some(VmConfig {
                backend: BackendName::Lima,
                image: "manica-golden".into()
            })
        );
        assert!(
            error("[vm]\nbackend = \"parallels\"\nimage = \"golden\"\n")
                .contains("vm.backend: must be one of: lima")
        );
    }

    #[test]
    fn the_image_cant_be_named_like_the_vms_jobs_run_in() {
        assert!(
            error("[vm]\nbackend = \"lima\"\nimage = \"manica-runner-golden\"\n")
                .contains("vm.image: can't start with manica-runner-")
        );
    }

    #[test]
    fn metrics_are_off_unless_enabled() {
        assert_eq!(load("").unwrap().metrics_interval, None);
        assert_eq!(
            load("[metrics]\ninterval = 60\n").unwrap().metrics_interval,
            None
        );
        assert_eq!(
            load("[metrics]\nenabled = true\n")
                .unwrap()
                .metrics_interval,
            Some(Duration::from_secs(30))
        );
        assert_eq!(
            load("[metrics]\nenabled = true\ninterval = 60\n")
                .unwrap()
                .metrics_interval,
            Some(Duration::from_secs(60))
        );
        assert!(
            error("[metrics]\nenabled = true\ninterval = 5\n")
                .contains("metrics.interval: must be at least 15 seconds")
        );
    }

    #[test]
    fn reports_every_problem_and_unknown_keys() {
        let message = error("poll_intervall = 3\n[agent]\ndata_dir = 1\n");
        assert!(message.contains("poll_intervall: unknown key"), "{message}");
        assert!(
            message.contains("agent.data_dir: must be a string"),
            "{message}"
        );
    }

    #[test]
    fn needs_a_token_unless_the_environment_has_one() {
        let dir = temp_dir();
        write_config(&dir, "[plane]\nurl = \"https://plane.test\"\n");
        assert!(
            load_config_with(&dir, None)
                .unwrap_err()
                .to_string()
                .contains("plane.token: is required (or set MANICA_AGENT_TOKEN)")
        );
        let config = load_config_with(&dir, Some("mna_env".into())).unwrap();
        assert_eq!(config.plane.token, "mna_env");
    }

    #[test]
    fn rejects_intervals_that_arent_numbers() {
        for extra in ["poll_interval = nan\n", "[metrics]\ninterval = nan\n"] {
            let dir = temp_dir();
            write_config(
                &dir,
                &format!("[plane]\nurl = \"http://plane.test\"\ntoken = \"x\"\n{extra}"),
            );
            let message = load_config_with(&dir, None).unwrap_err().to_string();
            assert!(message.contains("interval: must be a number"), "{message}");
        }
    }

    #[test]
    fn debug_output_leaves_the_token_out() {
        let config = load("").unwrap();
        let debug = format!("{config:?}");
        assert!(!debug.contains("mna_x"), "{debug}");
        assert!(debug.contains("plane.test"), "{debug}");
    }

    #[test]
    fn needs_an_http_url() {
        let dir = temp_dir();
        write_config(&dir, "[plane]\nurl = \"ftp://plane.test\"\ntoken = \"x\"\n");
        assert!(
            load_config_with(&dir, None)
                .unwrap_err()
                .to_string()
                .contains("plane.url: must be an http(s) URL")
        );
    }

    #[test]
    fn a_missing_file_is_reported_as_such() {
        assert!(matches!(
            load_config_with(&temp_dir(), None),
            Err(AgentError::ConfigNotFound(_))
        ));
    }

    #[test]
    fn toml_errors_name_the_line() {
        let dir = temp_dir();
        write_config(&dir, "[plane]\nurl = \n");
        let message = load_config_with(&dir, None).unwrap_err().to_string();
        assert!(message.contains("line 2"), "{message}");
    }
}
