//! Errors starting a runner fails with: the runner is given up on and
//! reported as exited, the agent keeps going.
use std::path::PathBuf;

use crate::vm::errors::VmError;

#[derive(Debug, Clone, thiserror::Error)]
#[error(
    "Installing runner {version} failed: {reason}{}",
    archive.as_ref().map(|archive| format!(" (archive kept at {})", archive.display())).unwrap_or_default()
)]
pub struct RunnerInstallError {
    pub version: String,
    pub reason: String,
    /// Where the downloaded archive was kept, if it got that far.
    pub archive: Option<PathBuf>,
}

#[derive(Debug, thiserror::Error)]
pub enum RunnerError {
    #[error(transparent)]
    Install(#[from] RunnerInstallError),

    #[error("copying {} failed: {reason}", build.display())]
    Copy { build: PathBuf, reason: String },

    #[error(transparent)]
    Vm(#[from] VmError),

    #[error(transparent)]
    Io(#[from] std::io::Error),
}
