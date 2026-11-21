use std::{os::unix::fs::DirBuilderExt, path::PathBuf, sync::Arc};

use async_trait::async_trait;
use tokio_util::sync::CancellationToken;

use super::{
    errors::RunnerError,
    install::{Install, copy_build},
    process::{STOP_GRACE, clear_stale_runners, spawn_runner, stop_runner},
};
use crate::{api::RunnerBuild, lines::Log, temp_dir::remove_dir};

/// One runner to run: the plane's id and name for it, its JIT config, and
/// the actions/runner build to run it with.
#[derive(Clone)]
pub struct RunnerJob {
    pub id: String,
    pub name: String,
    pub config: String,
    pub build: RunnerBuild,
}

/// Without the JIT config, which registers the runner: not for logs.
impl std::fmt::Debug for RunnerJob {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RunnerJob")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("build", &self.build)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub struct RunOptions {
    /// Cancelled to stop the runner, at whatever point it got to.
    pub stop: CancellationToken,
    /// The agent's own log.
    pub log: Log,
    /// The runner's output, line by line.
    pub output: Log,
}

/// Where runners run: on this machine, or each in a VM of its own.
#[async_trait]
pub trait RunnerHost: std::fmt::Debug + Send + Sync {
    /// Runs a runner to completion and cleans up after it. Returns its exit
    /// code, or None if it was stopped before it started. Fails if it
    /// couldn't be started.
    async fn run(&self, job: RunnerJob, options: RunOptions) -> Result<Option<i32>, RunnerError>;
    /// Clears what a previous agent left behind: the plane gave up on it.
    async fn clear_stale(&self) -> Result<(), RunnerError>;
}

/// Runs each runner on this machine, as the agent's user, from a copy of
/// its build in a directory of its own.
#[derive(Debug)]
pub struct LocalHost {
    pub runners_dir: PathBuf,
    pub installer: Arc<dyn Install>,
}

#[async_trait]
impl RunnerHost for LocalHost {
    async fn clear_stale(&self) -> Result<(), RunnerError> {
        Ok(clear_stale_runners(&self.runners_dir).await?)
    }

    async fn run(&self, job: RunnerJob, options: RunOptions) -> Result<Option<i32>, RunnerError> {
        let dir = self.runners_dir.join(&job.id);
        let result = async {
            let installed = self.installer.ensure(&job.build).await?;
            if options.stop.is_cancelled() {
                return Ok(None);
            }
            std::fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&self.runners_dir)?;
            copy_build(&installed, &dir).await?;
            if options.stop.is_cancelled() {
                return Ok(None);
            }
            options.log.line(&format!("starting runner {}", job.name));
            let runner = spawn_runner(&dir, &job.config, options.output.clone()).await?;
            tokio::select! {
                code = runner.wait() => return Ok(Some(code)),
                () = options.stop.cancelled() => {}
            }
            // What the runner started may outlive it, until stop_runner is
            // done.
            stop_runner(&runner, STOP_GRACE).await;
            Ok(Some(runner.wait().await))
        }
        .await;
        if let Err(error) = remove_dir(&dir).await {
            options
                .log
                .line(&format!("removing {} failed: {error}", dir.display()));
        }
        result
    }
}
