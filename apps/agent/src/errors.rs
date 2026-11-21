//! Errors the agent reports to the user and exits on.
use std::path::PathBuf;

use crate::{plane::PlaneError, runner::errors::RunnerError, vm::errors::VmError};

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    /// The command line is wrong: the usage is printed too, and the agent
    /// exits with 2.
    #[error("{0}")]
    Usage(String),

    #[error("No config file at {}", .0.display())]
    ConfigNotFound(PathBuf),

    #[error("Invalid config {}: {reason}", path.display())]
    InvalidConfig { path: PathBuf, reason: String },

    #[error(
        "Jobs can't run in {backend} VMs: {} (run manica-agent doctor for details)",
        problems.join("; ")
    )]
    VmBackendUnavailable {
        backend: String,
        problems: Vec<String>,
    },

    #[error(
        "Another agent{} runs jobs in VMs from {namespace}: one agent at a time can, since each deletes the VMs it finds there on start (lock: {})",
        pid.map(|pid| format!(" (pid {pid})")).unwrap_or_default(),
        lock.display()
    )]
    VmNamespaceInUse {
        namespace: String,
        pid: Option<u32>,
        lock: PathBuf,
    },

    #[error(
        "The plane rejected the agent token: it may have been regenerated, or the agent deleted"
    )]
    TokenRejected,

    #[error(transparent)]
    Plane(#[from] PlaneError),

    #[error(transparent)]
    Runner(#[from] RunnerError),

    #[error(transparent)]
    Vm(#[from] VmError),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}
