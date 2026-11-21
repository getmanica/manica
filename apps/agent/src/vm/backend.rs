use std::{path::Path, process::Stdio};

use async_trait::async_trait;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::errors::VmError;
use crate::{
    checks::{Check, fail, ok},
    lines::Log,
};

/// What a process in a guest reads.
pub enum GuestStdin {
    Null,
    /// Fed to it, then closed. Secrets go here rather than in argv, which
    /// other users of the host can see.
    Bytes(Vec<u8>),
    /// Another process's output, piped in.
    Pipe(Stdio),
}

/// Without the bytes, which may be secrets.
impl std::fmt::Debug for GuestStdin {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Null => f.write_str("Null"),
            Self::Bytes(bytes) => write!(f, "Bytes({} bytes)", bytes.len()),
            Self::Pipe(_) => f.write_str("Pipe"),
        }
    }
}

#[derive(Debug)]
pub struct ExecOptions {
    pub stdin: GuestStdin,
    /// Called with each line of its stdout and stderr.
    pub output: Option<Log>,
    /// Cancelled to kill it, through the host process running it.
    pub stop: Option<CancellationToken>,
}

impl Default for ExecOptions {
    fn default() -> Self {
        Self {
            stdin: GuestStdin::Null,
            output: None,
            stop: None,
        }
    }
}

/// A process running in a guest, through the backend's CLI on the host.
#[derive(Debug)]
pub struct GuestProcess {
    pub(crate) exited: JoinHandle<i32>,
}

impl GuestProcess {
    /// Its exit code, as the backend's CLI reports it.
    pub async fn wait(&mut self) -> i32 {
        (&mut self.exited).await.unwrap_or(-1)
    }
}

/// A tool that runs macOS VMs on this Mac (Lima; later Tart, Lume), driven
/// through its CLI. The user installs it: the agent doesn't ship one.
///
/// Jobs run each in a VM of its own, cloned from a stopped "golden" VM the
/// user prepared (the image), and deleted afterwards.
#[async_trait]
pub trait VmBackend: std::fmt::Debug + Send + Sync {
    fn name(&self) -> &str;
    /// Where the tool keeps its VMs (for Lima, its home directory). One
    /// agent at a time may use it: on start, an agent deletes the VMs it
    /// finds there named like its own. Locked by its canonical path (see
    /// `claim_namespace`).
    fn namespace(&self) -> &Path;
    /// Whether the tool is installed and recent enough, and, given an image,
    /// whether jobs can be cloned from it. Problems are checks, not errors.
    async fn diagnose(&self, image: Option<&str>) -> Vec<Check>;
    /// Makes `vm` a fresh copy of the stopped `image` that shares nothing
    /// with the host or with other jobs: no host directories or devices, no
    /// disks that outlive it, no forwarded credentials. Fails with
    /// `VmError::Isolation` if the tool's effective config for it still has
    /// any. Cancelling `stop` kills what it runs, and it fails; the VM may be
    /// left half made: delete it.
    async fn clone_vm(
        &self,
        image: &str,
        vm: &str,
        stop: Option<&CancellationToken>,
    ) -> Result<(), VmError>;
    /// Boots `vm`, returning once commands can run in it.
    async fn start(&self, vm: &str, stop: Option<&CancellationToken>) -> Result<(), VmError>;
    /// Runs `argv` in `vm`, as the guest's user, in a session of its own (as
    /// over SSH): it leads its process group, which stopping a runner
    /// signals.
    ///
    /// # Errors
    ///
    /// If the backend's CLI can't be started.
    fn exec(&self, vm: &str, argv: &[&str], options: ExecOptions) -> Result<GuestProcess, VmError>;
    /// Stops `vm` if it's running, and deletes it. Fine if it's already gone.
    async fn delete(&self, vm: &str) -> Result<(), VmError>;
    /// The names of every VM the tool knows of, running or not.
    async fn list(&self) -> Result<Vec<String>, VmError>;
}

/// VMs the agent makes are named with this prefix, so a later agent can
/// find the ones a previous one left behind and delete them. Nothing else
/// may be: the image's name can't start with it.
pub const VM_PREFIX: &str = "manica-runner-";

/// A runner's VM: the prefix and the first 12 characters of its id (a
/// UUID), which keeps the sockets backends make in a VM's directory under
/// macOS's 104-byte limit for ordinary home directories.
#[must_use]
pub fn vm_name(runner_id: &str) -> String {
    let id: String = runner_id.chars().filter(|c| *c != '-').take(12).collect();
    format!("{VM_PREFIX}{id}")
}

/// The longest name `vm_name` makes.
#[must_use]
pub fn longest_vm_name() -> String {
    format!("{VM_PREFIX}{}", "x".repeat(12))
}

/// The platform as Node names it (darwin, linux; arm64, x64), as the plane
/// and the release assets do.
#[must_use]
pub fn platform() -> (&'static str, &'static str) {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        os => os,
    };
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        arch => arch,
    };
    (os, arch)
}

/// Virtualization.framework runs macOS guests on Apple silicon Macs only.
#[must_use]
pub fn check_host() -> Check {
    match platform() {
        ("darwin", "arm64") => ok("Apple silicon Mac: macOS guests are supported"),
        (os, arch) => fail(format!(
            "macOS VMs need an Apple silicon Mac (this is {os}-{arch})"
        )),
    }
}

/// macOS allows two macOS guests running at once per Mac (its license, and
/// Virtualization.framework refuses a third), whichever tool started them.
pub const MAX_RUNNING_MACOS_VMS: usize = 2;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_vms_after_runners_short_enough_for_sockets() {
        assert_eq!(
            vm_name("0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f"),
            "manica-runner-0b6f3c1e8a2d"
        );
        assert_eq!(vm_name("r1"), "manica-runner-r1");
        assert_eq!(longest_vm_name().len(), vm_name("0b6f3c1e-8a2d-4c5b").len());
    }
}
