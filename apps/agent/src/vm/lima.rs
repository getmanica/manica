//! Lima (<https://lima-vm.io>), with its vz driver: macOS guests on
//! Virtualization.framework.
//!
//! It reaches guests over SSH through a port it forwards on 127.0.0.1, so it
//! works from a headless session without Local Network access.
use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use async_trait::async_trait;
use serde::Deserialize;
use tokio::{io::AsyncWriteExt, process::Command};
use tokio_util::sync::CancellationToken;

use super::{
    backend::{
        ExecOptions, GuestProcess, GuestStdin, MAX_RUNNING_MACOS_VMS, VmBackend, check_host,
        longest_vm_name,
    },
    command::{RunOptions, compare_versions, exit_code, run_command, take_output, wait_or_kill},
    errors::VmError,
};
use crate::{
    checks::{Check, fail, ok, warn},
    lines::{Log, forward_lines},
};

/// macOS guests arrived in Lima 2.1; cutting a guest off from the host's
/// loopback services (networkOpts.hostLoopback), in 2.3.
pub const MIN_LIMA_VERSION: &str = "2.3.0";

/// How long `limactl start` may take to get a guest ready. It blocks for all
/// of it when the guest never comes up (a 2 GiB macOS guest never does).
const START_TIMEOUT: &str = "5m";

/// Smaller macOS guests didn't boot when measured (macOS 27.2, Lima 2.3).
const MIN_MEMORY_BYTES: f64 = 3.0 * 1024.0 * 1024.0 * 1024.0;

const INSTALL_HINT: &str = "install Lima 2.3 or later: https://lima-vm.io/docs/installation/";

/// What a job's clone is set to, so it shares nothing with the host or with
/// other jobs.
///
/// No host directories, no disks (a clone shares the golden VM's, and they
/// outlive it), no host devices, audio or microphone, no
/// forwarded SSH agent or X11, no networks shared between VMs, and no access
/// to the host's loopback services (which include the SSH port Lima forwards
/// for every other VM, whose guest has the same user and password).
pub const ISOLATED: &[&str] = &[
    ".mounts = []",
    ".additionalDisks = []",
    ".blockDevices = []",
    ".audio.device = \"\"",
    ".audio.microphone = false",
    ".ssh.forwardAgent = false",
    ".ssh.forwardX11 = false",
    ".ssh.forwardX11Trusted = false",
    ".networks = []",
    ".networkOpts.hostLoopback = false",
];

/// macOS's limit on a Unix socket's path, terminator included.
const UNIX_PATH_MAX: usize = 104;

/// The longest socket Lima's SSH makes in a VM's directory: `ControlMaster`'s
/// temporary ssh.sock.<16 random characters>.
const LONGEST_SOCKET: &str = "ssh.sock.0123456789abcdef";

/// How long a command's output may take to drain once it exited: a process
/// it started in the guest can hold the pipe until the VM is gone.
const DRAIN: Duration = Duration::from_secs(1);

/// The parts of `limactl list --json` used here: one object per line.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instance {
    name: String,
    status: Option<String>,
    vm_type: Option<String>,
    /// Lima's effective config: the instance's own, merged with
    /// $`LIMA_HOME`/_config/default.yaml and override.yaml.
    config: Option<InstanceConfig>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstanceConfig {
    os: Option<String>,
    memory: Option<String>,
    mounts: Option<Vec<Mount>>,
    additional_disks: Option<Vec<serde_json::Value>>,
    block_devices: Option<Vec<String>>,
    audio: Option<Audio>,
    ssh: Option<Ssh>,
    networks: Option<Vec<Network>>,
    network_opts: Option<NetworkOpts>,
}

#[derive(Debug, Deserialize)]
struct Mount {
    location: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Audio {
    device: Option<String>,
    microphone: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ssh {
    forward_agent: Option<bool>,
    #[serde(rename = "forwardX11")]
    x11: Option<bool>,
    #[serde(rename = "forwardX11Trusted")]
    x11_trusted: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct Network {
    lima: Option<String>,
    socket: Option<String>,
    #[serde(rename = "vzNAT")]
    vz_nat: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetworkOpts {
    host_loopback: Option<bool>,
}

/// Lima's memory sizes look like "4GiB": bytes, or None if it isn't one.
#[must_use]
pub fn parse_size(size: &str) -> Option<f64> {
    let size = size.trim();
    let digits = size
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(size.len());
    if digits == 0 {
        return None;
    }
    let number: f64 = size[..digits].parse().ok()?;
    let unit = match size[digits..].trim_start() {
        "" | "B" => 1.0,
        "Ki" | "KiB" => 1024.0,
        "Mi" | "MiB" => 1024_f64.powi(2),
        "Gi" | "GiB" => 1024_f64.powi(3),
        "Ti" | "TiB" => 1024_f64.powi(4),
        _ => return None,
    };
    Some(number * unit)
}

#[derive(Debug, Default)]
pub struct LimaOptions {
    /// The limactl to run. Defaults to the one on PATH.
    pub limactl: Option<String>,
    /// Lima's home directory, where it keeps its VMs. Defaults to
    /// $`LIMA_HOME`, or ~/.lima.
    pub home: Option<PathBuf>,
}

#[derive(Debug)]
pub struct Lima {
    limactl: String,
    home: PathBuf,
}

/// Where `command` is found on PATH, if it's a bare name.
fn which(command: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    if command.contains('/') {
        return Some(PathBuf::from(command));
    }
    env::split_paths(&env::var_os("PATH")?)
        .map(|dir| dir.join(command))
        .find(|path| {
            path.metadata().is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            })
        })
}

/// The directory made absolute, with symlinks resolved where it exists.
#[must_use]
pub fn canonical(dir: &Path) -> PathBuf {
    std::fs::canonicalize(dir)
        .or_else(|_| std::path::absolute(dir))
        .unwrap_or_else(|_| dir.to_path_buf())
}

impl Lima {
    #[must_use]
    pub fn new(options: LimaOptions) -> Self {
        let home = options.home.unwrap_or_else(|| {
            env::var_os("LIMA_HOME")
                .filter(|home| !home.is_empty())
                .map_or_else(
                    || env::home_dir().unwrap_or_default().join(".lima"),
                    PathBuf::from,
                )
        });
        Self {
            limactl: options.limactl.unwrap_or_else(|| "limactl".to_owned()),
            home,
        }
    }

    fn env(&self) -> Vec<(String, OsString)> {
        vec![("LIMA_HOME".to_owned(), self.home.clone().into_os_string())]
    }

    fn argv(&self, args: &[&str]) -> Vec<String> {
        std::iter::once(self.limactl.clone())
            .chain(args.iter().map(ToString::to_string))
            .collect()
    }

    async fn run(
        &self,
        args: &[&str],
        unchecked: bool,
        stop: Option<&CancellationToken>,
    ) -> Result<super::command::CommandResult, VmError> {
        run_command(
            &self.argv(args),
            RunOptions {
                unchecked,
                stop,
                env: self.env(),
            },
        )
        .await
    }

    async fn instances(&self, name: Option<&str>) -> Result<Vec<Instance>, VmError> {
        let mut args = vec!["list", "--json"];
        args.extend(name);
        let output = self.run(&args, false, None).await?;
        output
            .stdout
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| {
                serde_json::from_str(line).map_err(|error| VmError::InvalidOutput {
                    command: format!("{} list --json", self.limactl),
                    reason: error.to_string(),
                })
            })
            .collect()
    }

    async fn check_version(&self) -> Check {
        let output = match self.run(&["--version"], false, None).await {
            Ok(output) => output.stdout,
            Err(VmError::Command {
                exit_code: None, ..
            }) => {
                return fail(format!("{} not found", self.limactl)).hint(INSTALL_HINT);
            }
            Err(error) => {
                return fail(format!("{} --version failed: {error}", self.limactl))
                    .hint(INSTALL_HINT);
            }
        };
        let Some(version) = output
            .split(|c: char| !c.is_ascii_digit() && c != '.')
            .find(|word| {
                word.split('.').count() >= 3 && word.split('.').all(|part| !part.is_empty())
            })
            .map(|word| word.split('.').take(3).collect::<Vec<_>>().join("."))
        else {
            return warn(format!(
                "couldn't read Lima's version from \"{}\"",
                output.trim()
            ));
        };
        let location = which(&self.limactl)
            .map_or_else(|| self.limactl.clone(), |path| path.display().to_string());
        if compare_versions(&version, MIN_LIMA_VERSION).is_lt() {
            fail(format!(
                "Lima {version} ({location}) is too old to isolate macOS guests"
            ))
            .hint(INSTALL_HINT)
        } else {
            ok(format!("Lima {version} ({location})"))
        }
    }

    fn check_image(image: &str, all: &[Instance]) -> Vec<Check> {
        let Some(golden) = all.iter().find(|instance| instance.name == image) else {
            return vec![fail(format!("no Lima instance named {image}")).hint(format!(
                "create it: limactl create --name={image} template:macos, then start it once, install what jobs need, and stop it"
            ))];
        };
        let config = golden.config.as_ref();
        let os = config.and_then(|config| config.os.as_deref());
        let mut checks = Vec::new();
        if os != Some("Darwin") || golden.vm_type.as_deref() != Some("vz") {
            checks.push(fail(format!(
                "{image} isn't a macOS guest (os {}, vmType {})",
                os.unwrap_or("?"),
                golden.vm_type.as_deref().unwrap_or("?")
            )));
        }
        checks.push(match golden.status.as_deref() {
            Some("Stopped") => ok(format!("{image}: stopped macOS instance, ready to clone")),
            status => fail(format!(
                "{image} is {}: jobs are cloned from it stopped",
                status.unwrap_or("in an unknown state")
            ))
            .hint(format!("limactl stop {image}")),
        });
        let memory = config
            .and_then(|config| config.memory.as_deref())
            .unwrap_or("");
        if parse_size(memory).is_some_and(|bytes| bytes < MIN_MEMORY_BYTES) {
            checks.push(
                warn(format!(
                    "{image} has {memory} of memory: macOS guests under 3 GiB may never boot"
                ))
                .hint(format!("limactl edit {image} --memory=4")),
            );
        }
        checks
    }

    /// Lima refuses a VM whose sockets' paths are too long for macOS. It
    /// makes them under its home made absolute, with symlinks resolved.
    fn check_socket_path(&self) -> Check {
        let resolved = canonical(&self.home);
        let longest = resolved.join(longest_vm_name()).join(LONGEST_SOCKET);
        if longest.as_os_str().len() < UNIX_PATH_MAX {
            ok(format!("Lima home {}", resolved.display()))
        } else {
            fail(format!(
                "Lima home {} is too long: job VMs' sockets would exceed macOS's {UNIX_PATH_MAX}-byte limit",
                resolved.display()
            ))
            .hint("set LIMA_HOME to a shorter directory for the agent and the golden VM")
        }
    }

    fn check_running(all: &[Instance]) -> Check {
        let running: Vec<&str> = all
            .iter()
            .filter(|instance| instance.status.as_deref() == Some("Running"))
            .map(|instance| instance.name.as_str())
            .collect();
        if running.len() >= MAX_RUNNING_MACOS_VMS {
            warn(format!(
                "{} Lima instances already running ({}): macOS runs at most {MAX_RUNNING_MACOS_VMS} VMs at once",
                running.len(),
                running.join(", ")
            ))
            .hint("stop the ones jobs don’t need")
        } else {
            ok(format!(
                "{} of {MAX_RUNNING_MACOS_VMS} VMs in use by Lima",
                running.len()
            ))
        }
    }

    /// What a job's VM would share with the host, after Lima merged in its
    /// global config: refused rather than started.
    async fn check_isolation(&self, vm: &str) -> Result<(), VmError> {
        let isolation = |reasons: Vec<String>| VmError::Isolation {
            vm: vm.to_owned(),
            reasons,
        };
        let instances = self.instances(Some(vm)).await?;
        let Some(config) = instances
            .into_iter()
            .next()
            .and_then(|instance| instance.config)
        else {
            return Err(isolation(vec!["Lima didn’t report its config".to_owned()]));
        };
        let mut reasons = Vec::new();
        for mount in config.mounts.unwrap_or_default() {
            reasons.push(format!(
                "it mounts {}",
                mount.location.as_deref().unwrap_or("a host directory")
            ));
        }
        for disk in config.additional_disks.unwrap_or_default() {
            let name = match &disk {
                serde_json::Value::String(name) => name.as_str(),
                disk => disk
                    .get("name")
                    .and_then(|name| name.as_str())
                    .unwrap_or("?"),
            };
            reasons.push(format!("it attaches disk {name}, which outlives it"));
        }
        for device in config.block_devices.unwrap_or_default() {
            reasons.push(format!("it attaches host device {device}"));
        }
        if let Some(audio) = &config.audio {
            if let Some(device) = audio
                .device
                .as_deref()
                .filter(|device| !device.is_empty() && *device != "none")
            {
                reasons.push(format!("it plays audio on the host ({device})"));
            }
            if audio.microphone == Some(true) {
                reasons.push("it records the host’s microphone".to_owned());
            }
        }
        if let Some(ssh) = &config.ssh {
            if ssh.forward_agent == Some(true) {
                reasons.push("it forwards the host’s SSH agent".to_owned());
            }
            if ssh.x11 == Some(true) || ssh.x11_trusted == Some(true) {
                reasons.push("it forwards X11".to_owned());
            }
        }
        for network in config.networks.unwrap_or_default() {
            let name = network.lima.or(network.socket).unwrap_or_else(|| {
                if network.vz_nat == Some(true) {
                    "vzNAT"
                } else {
                    "?"
                }
                .to_owned()
            });
            reasons.push(format!("it joins network {name}, shared with other VMs"));
        }
        if config.network_opts.and_then(|opts| opts.host_loopback) != Some(false) {
            reasons.push("it reaches the host’s loopback services".to_owned());
        }
        if reasons.is_empty() {
            Ok(())
        } else {
            Err(isolation(reasons))
        }
    }
}

#[async_trait]
impl VmBackend for Lima {
    fn name(&self) -> &'static str {
        "lima"
    }

    fn namespace(&self) -> &Path {
        &self.home
    }

    async fn diagnose(&self, image: Option<&str>) -> Vec<Check> {
        let mut checks = vec![check_host(), self.check_version().await];
        if checks.iter().any(Check::failed) {
            return checks;
        }
        checks.push(self.check_socket_path());
        let all = match self.instances(None).await {
            Ok(all) => all,
            Err(error) => {
                checks.push(fail(format!("listing Lima instances failed: {error}")));
                return checks;
            }
        };
        if let Some(image) = image {
            checks.extend(Self::check_image(image, &all));
        }
        checks.push(Self::check_running(&all));
        checks
    }

    async fn clone_vm(
        &self,
        image: &str,
        vm: &str,
        stop: Option<&CancellationToken>,
    ) -> Result<(), VmError> {
        // The macOS template shares the host's home directory (read-only) by
        // default, and a golden VM may have anything else a VM can share (see
        // ISOLATED). Lima merges its global config back in, so what the clone
        // ends up with is checked too.
        let mut args = vec!["clone", "--tty=false"];
        for setting in ISOLATED {
            args.extend(["--set", setting]);
        }
        args.extend([image, vm]);
        self.run(&args, false, stop).await?;
        self.check_isolation(vm).await
    }

    async fn start(&self, vm: &str, stop: Option<&CancellationToken>) -> Result<(), VmError> {
        let timeout = format!("--timeout={START_TIMEOUT}");
        self.run(&["start", "--tty=false", &timeout, vm], false, stop)
            .await
            .map(|_| ())
    }

    fn exec(&self, vm: &str, argv: &[&str], options: ExecOptions) -> Result<GuestProcess, VmError> {
        // limactl quotes each argument, and runs them with the guest user's
        // login shell, over SSH. It doesn't forward the agent's environment.
        let shell = [&["shell", "--workdir", "/", vm], argv].concat();
        let not_started = |error: std::io::Error| VmError::Command {
            argv: self.argv(&shell),
            exit_code: None,
            stderr: error.to_string(),
        };
        let (stdin, bytes) = match options.stdin {
            GuestStdin::Null => (Stdio::null(), None),
            GuestStdin::Bytes(bytes) => (Stdio::piped(), Some(bytes)),
            GuestStdin::Pipe(stdio) => (stdio, None),
        };
        let mut child = Command::new(&self.limactl)
            .args(&shell)
            .envs(self.env())
            .stdin(stdin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(not_started)?;
        if let (Some(bytes), Some(mut stdin)) = (bytes, child.stdin.take()) {
            tokio::spawn(async move {
                // It fails only if the process exited without reading it,
                // which its exit code tells.
                drop(stdin.write_all(&bytes).await);
            });
        }
        let output = options.output.unwrap_or_else(Log::none);
        let (stdout, stderr) = take_output(&mut child).map_err(not_started)?;
        let forwarded = tokio::spawn(async move {
            tokio::join!(
                forward_lines(stdout, output.clone()),
                forward_lines(stderr, output)
            );
        });
        let stop = options.stop;
        let exited = tokio::spawn(async move {
            let status = wait_or_kill(&mut child, stop.as_ref()).await;
            // A process it started in the guest may hold the pipes open: its
            // output is cut short rather than waited for.
            drop(tokio::time::timeout(DRAIN, forwarded).await);
            status.map_or(-1, exit_code)
        });
        Ok(GuestProcess { exited })
    }

    async fn delete(&self, vm: &str) -> Result<(), VmError> {
        let result = self.run(&["delete", "--force", vm], true, None).await?;
        if result.exit_code != 0 && self.list().await?.iter().any(|name| name == vm) {
            return Err(VmError::Command {
                argv: self.argv(&["delete", "--force", vm]),
                exit_code: Some(result.exit_code),
                stderr: result.stderr.trim().to_owned(),
            });
        }
        Ok(())
    }

    async fn list(&self) -> Result<Vec<String>, VmError> {
        let output = self.run(&["list", "--quiet"], false, None).await?;
        Ok(output
            .stdout
            .lines()
            .filter(|name| !name.trim().is_empty())
            .map(str::to_owned)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::lines::lock;
    use std::{
        sync::{Arc, Mutex},
        time::Instant,
    };

    use super::*;
    use crate::{
        checks::Status,
        test_support::{FakeLimactl, Instance, golden, temp_dir},
    };

    fn clone_call(vm: &str) -> String {
        let sets: Vec<String> = ISOLATED
            .iter()
            .map(|setting| format!("--set {setting}"))
            .collect();
        format!("clone --tty=false {} golden {vm}", sets.join(" "))
    }

    fn statuses(checks: &[Check]) -> Vec<Status> {
        checks.iter().map(|check| check.status).collect()
    }

    /// Most checks depend on the host: only Apple silicon Macs run macOS
    /// guests.
    const ON_APPLE_SILICON: bool = cfg!(all(target_os = "macos", target_arch = "aarch64"));

    fn lima(fake: &FakeLimactl) -> Lima {
        Lima::new(LimaOptions {
            limactl: Some(fake.limactl()),
            home: None,
        })
    }

    #[tokio::test]
    async fn a_stopped_macos_golden_instance_passes() {
        if !ON_APPLE_SILICON {
            return;
        }
        let fake = FakeLimactl::new(&[golden()]);
        let checks = lima(&fake).diagnose(Some("golden")).await;
        assert_eq!(statuses(&checks), [Status::Ok; 5], "{checks:?}");
        assert!(checks[1].message.starts_with("Lima 2.3.0"));
    }

    #[tokio::test]
    async fn a_missing_limactl_fails_with_how_to_install_it() {
        let checks = Lima::new(LimaOptions {
            limactl: Some("/nonexistent/limactl".into()),
            home: None,
        })
        .diagnose(Some("golden"))
        .await;
        let last = checks.last().unwrap();
        assert_eq!(last.status, Status::Fail);
        assert_eq!(last.message, "/nonexistent/limactl not found");
        assert!(last.hint.as_deref().unwrap().contains("lima-vm.io"));
    }

    #[tokio::test]
    async fn lima_before_2_3_fails() {
        if !ON_APPLE_SILICON {
            return;
        }
        let fake = FakeLimactl::new(&[golden()]);
        fake.set("FAKE_LIMA_VERSION", "2.2.1");
        let checks = lima(&fake).diagnose(Some("golden")).await;
        let last = checks.last().unwrap();
        assert_eq!(last.status, Status::Fail);
        assert!(last.message.contains("too old to isolate macOS guests"));
    }

    #[tokio::test]
    async fn golden_instance_problems() {
        if !ON_APPLE_SILICON {
            return;
        }
        let fake = FakeLimactl::new(&[
            Instance {
                name: "running",
                status: "Running",
                ..golden()
            },
            Instance {
                name: "small",
                memory: "2GiB",
                ..golden()
            },
            Instance {
                name: "linux",
                os: "Linux",
                ..golden()
            },
        ]);
        let lima = lima(&fake);

        let missing = lima.diagnose(Some("nope")).await;
        assert_eq!(missing[3].message, "no Lima instance named nope");

        let running = lima.diagnose(Some("running")).await;
        assert_eq!(running[3].status, Status::Fail);
        assert_eq!(running[3].hint.as_deref(), Some("limactl stop running"));

        let small = lima.diagnose(Some("small")).await;
        assert_eq!(
            statuses(&small),
            [
                Status::Ok,
                Status::Ok,
                Status::Ok,
                Status::Ok,
                Status::Warn,
                Status::Ok
            ]
        );

        let linux = lima.diagnose(Some("linux")).await;
        assert!(linux[3].message.contains("isn't a macOS guest"));
    }

    #[tokio::test]
    async fn warns_when_the_vm_limit_is_already_used_up() {
        if !ON_APPLE_SILICON {
            return;
        }
        let fake = FakeLimactl::new(&[
            golden(),
            Instance::named("a", "Running"),
            Instance::named("b", "Running"),
        ]);
        let checks = lima(&fake).diagnose(Some("golden")).await;
        let last = checks.last().unwrap();
        assert_eq!(last.status, Status::Warn);
        assert!(last.message.contains("2 Lima instances already running"));
    }

    #[tokio::test]
    async fn clones_isolated_starts_with_a_timeout_and_deletes() {
        let fake = FakeLimactl::new(&[golden()]);
        let lima = lima(&fake);
        lima.clone_vm("golden", "manica-r1", None).await.unwrap();
        lima.start("manica-r1", None).await.unwrap();
        assert_eq!(lima.list().await.unwrap(), ["golden", "manica-r1"]);
        lima.delete("manica-r1").await.unwrap();
        assert_eq!(lima.list().await.unwrap(), ["golden"]);
        assert_eq!(
            fake.calls(),
            [
                clone_call("manica-r1"),
                "list --json manica-r1".into(),
                "start --tty=false --timeout=5m manica-r1".into(),
                "list --quiet".into(),
                "delete --force manica-r1".into(),
                "list --quiet".into(),
            ]
        );
    }

    #[tokio::test]
    async fn exec_feeds_stdin_and_reports_output_and_the_exit_code() {
        let fake = FakeLimactl::new(&[golden()]);
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let output = Arc::clone(&lines);
        let mut process = lima(&fake)
            .exec(
                "vm",
                &[
                    "/bin/sh",
                    "-c",
                    "read -r x; echo \"got $x\"; echo oops >&2; exit 4",
                ],
                ExecOptions {
                    stdin: GuestStdin::Bytes(b"secret\n".to_vec()),
                    output: Some(Log::new(move |line| {
                        lock(&output).push(line.to_owned());
                    })),
                    stop: None,
                },
            )
            .unwrap();
        assert_eq!(process.wait().await, 4);
        let mut lines = lock(&lines).clone();
        lines.sort();
        assert_eq!(lines, ["got secret", "oops"]);
        // The secret went through stdin, not the command line.
        assert!(!fake.calls().join("\n").contains("secret"));
    }

    #[test]
    fn parses_lima_memory_sizes() {
        assert_eq!(parse_size("4GiB"), Some(4.0 * 1024_f64.powi(3)));
        assert_eq!(parse_size("512MiB"), Some(512.0 * 1024_f64.powi(2)));
        assert_eq!(parse_size("nonsense"), None);
    }

    #[tokio::test]
    async fn refuses_a_clone_limas_global_config_shares_anything_with() {
        let fake = FakeLimactl::new(&[golden()]);
        let lima = lima(&fake);
        for (variable, reason) in [
            ("FAKE_LIMA_GLOBAL_MOUNT", "it mounts /Users/host"),
            (
                "FAKE_LIMA_FORWARD_AGENT",
                "it forwards the host’s SSH agent",
            ),
            ("FAKE_LIMA_DISK", "it attaches disk data, which outlives it"),
            (
                "FAKE_LIMA_HOST_LOOPBACK",
                "it reaches the host’s loopback services",
            ),
            ("FAKE_LIMA_MICROPHONE", "it records the host’s microphone"),
        ] {
            fake.set(variable, "1");
            let error = lima
                .clone_vm("golden", &format!("manica-{variable}"), None)
                .await
                .unwrap_err();
            fake.unset(variable);
            assert!(matches!(error, VmError::Isolation { .. }), "{error}");
            assert!(error.to_string().contains(reason), "{error}");
        }
    }

    #[tokio::test]
    async fn cancelling_kills_what_an_operation_runs() {
        let fake = FakeLimactl::new(&[golden()]);
        fake.set("FAKE_LIMA_START_SLEEP", "30");
        let lima = lima(&fake);
        let stop = CancellationToken::new();
        let started = lima.start("vm", Some(&stop));
        let cancel = async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            stop.cancel();
            Instant::now()
        };
        let (result, cancelled_at) = tokio::join!(started, cancel);
        assert!(matches!(result, Err(VmError::Command { .. })));
        assert!(cancelled_at.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn uses_its_own_lima_home_as_its_namespace() {
        let lima = Lima::new(LimaOptions {
            limactl: None,
            home: Some("/tmp/lima-x".into()),
        });
        assert_eq!(lima.namespace(), Path::new("/tmp/lima-x"));
    }

    #[tokio::test]
    async fn fails_a_lima_home_too_long_for_job_vms_sockets() {
        if !ON_APPLE_SILICON {
            return;
        }
        let fake = FakeLimactl::new(&[golden()]);
        let with_home = |home: &str| {
            Lima::new(LimaOptions {
                limactl: Some(fake.limactl()),
                home: Some(home.into()),
            })
        };
        let short = with_home("/Users/someone/.lima").diagnose(None).await;
        assert_eq!(short[2].status, Status::Ok);
        let long = with_home(&format!("/Users/{}/.lima", "a".repeat(40)))
            .diagnose(None)
            .await;
        assert_eq!(long[2].status, Status::Fail);
        assert!(long[2].message.contains("104-byte limit"));
    }

    #[tokio::test]
    async fn measures_the_lima_home_lima_uses() {
        if !ON_APPLE_SILICON {
            return;
        }
        let fake = FakeLimactl::new(&[golden()]);
        let deep = temp_dir().join("a".repeat(60));
        std::fs::create_dir(&deep).unwrap();
        let alias = temp_dir().join("l");
        std::os::unix::fs::symlink(&deep, &alias).unwrap();
        let via_alias = Lima::new(LimaOptions {
            limactl: Some(fake.limactl()),
            home: Some(alias),
        })
        .diagnose(None)
        .await;
        assert_eq!(via_alias[2].status, Status::Fail);
        let deep = std::fs::canonicalize(&deep).unwrap();
        assert!(via_alias[2].message.contains(&deep.display().to_string()));
        let relative = Lima::new(LimaOptions {
            limactl: Some(fake.limactl()),
            home: Some(".".into()),
        })
        .diagnose(None)
        .await;
        let cwd = std::fs::canonicalize(".").unwrap();
        assert!(relative[2].message.contains(&cwd.display().to_string()));
    }
}
