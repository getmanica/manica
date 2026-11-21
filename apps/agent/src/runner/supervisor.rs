use std::sync::{Arc, Mutex};

use futures_util::future::join_all;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

use super::host::{RunOptions, RunnerHost, RunnerJob};
use crate::{
    api::{RunnerBuild, RunnerStart},
    lines::{Log, lock},
    plane::PlaneApi,
};

/// A runner's exit: its code, or None if it never ran.
type Exit = Option<i32>;

#[derive(Debug)]
struct Runner {
    id: String,
    name: String,
    stop: CancellationToken,
    /// Set once it's done.
    exited: watch::Receiver<Option<Exit>>,
}

impl Runner {
    fn exit(&self) -> Option<Exit> {
        *self.exited.borrow()
    }
}

#[derive(Debug)]
struct Inner {
    host: Arc<dyn RunnerHost>,
    log: Log,
    /// In the order they started.
    runners: Mutex<Vec<Runner>>,
}

/// Runs the runners the plane hands out on its host, from start to reported
/// exit. Clones share the same runners.
#[derive(Debug, Clone)]
pub struct Supervisor(Arc<Inner>);

impl Supervisor {
    #[must_use]
    pub fn new(host: Arc<dyn RunnerHost>, log: Log) -> Self {
        Self(Arc::new(Inner {
            host,
            log,
            runners: Mutex::new(Vec::new()),
        }))
    }

    /// Clears what a previous agent left behind. Call before the first poll:
    /// the plane releases what that agent held once it's not listed.
    ///
    /// # Errors
    ///
    /// If what it left can't be cleared.
    pub async fn clear_stale(&self) -> Result<(), super::errors::RunnerError> {
        self.0.host.clear_stale().await
    }

    /// The runners held, to list in polls: running, starting, or exited but
    /// not yet reported.
    #[must_use]
    pub fn held(&self) -> Vec<String> {
        lock(&self.0.runners)
            .iter()
            .map(|runner| runner.id.clone())
            .collect()
    }

    /// Whether no runner is held anymore.
    #[must_use]
    pub fn idle(&self) -> bool {
        lock(&self.0.runners).is_empty()
    }

    /// Whether every runner held is done, if not yet reported.
    #[must_use]
    pub fn all_exited(&self) -> bool {
        lock(&self.0.runners)
            .iter()
            .all(|runner| runner.exit().is_some())
    }

    /// Starts a runner, unless it's already held.
    pub fn start(&self, start: RunnerStart, build: RunnerBuild) {
        let stop = CancellationToken::new();
        let (tx, exited) = watch::channel(None);
        {
            let mut runners = lock(&self.0.runners);
            if runners.iter().any(|runner| runner.id == start.id) {
                return;
            }
            runners.push(Runner {
                id: start.id.clone(),
                name: start.name.clone(),
                stop: stop.clone(),
                exited,
            });
        }
        let inner = Arc::clone(&self.0);
        tokio::spawn(async move {
            let name = start.name.clone();
            let output = inner.log.prefixed(format!("[{name}] "));
            let job = RunnerJob {
                id: start.id,
                name: start.name,
                config: start.config,
                build,
            };
            let options = RunOptions {
                stop,
                log: inner.log.clone(),
                output,
            };
            let exit = match inner.host.run(job, options).await {
                Ok(exit) => {
                    if let Some(code) = exit {
                        inner.log.line(&format!("runner {name} exited with {code}"));
                    }
                    exit
                }
                Err(error) => {
                    inner.log.line(&format!("runner {name} failed: {error}"));
                    None
                }
            };
            tx.send_replace(Some(exit));
        });
    }

    /// Stops a runner, if it's held, returning once it's done.
    pub async fn stop(&self, id: &str) {
        let Some((name, stop, exited)) = lock(&self.0.runners)
            .iter()
            .find(|runner| runner.id == id)
            .map(|runner| {
                (
                    runner.name.clone(),
                    runner.stop.clone(),
                    runner.exited.clone(),
                )
            })
        else {
            return;
        };
        if !stop.is_cancelled() {
            self.0.log.line(&format!("stopping runner {name}"));
            stop.cancel();
        }
        wait_exited(exited).await;
    }

    pub async fn stop_all(&self) {
        join_all(self.held().iter().map(|id| self.stop(id))).await;
    }

    /// Reports the runners that are done, dropping those the plane was told
    /// about. The rest are retried next time.
    pub async fn report_exited(&self, plane: &dyn PlaneApi) {
        let exited: Vec<(String, String, Exit)> = lock(&self.0.runners)
            .iter()
            .filter_map(|runner| Some((runner.id.clone(), runner.name.clone(), runner.exit()?)))
            .collect();
        for (id, name, exit) in exited {
            if let Err(error) = plane.exited(&id, exit.map(i64::from)).await {
                self.0
                    .log
                    .line(&format!("reporting runner {name}'s exit failed: {error}"));
                return;
            }
            lock(&self.0.runners).retain(|runner| runner.id != id);
        }
    }
}

/// Waits for a runner's exit. Its task sends it before dropping the sender,
/// so a closed channel means it's done too.
async fn wait_exited(mut exited: watch::Receiver<Option<Exit>>) {
    drop(exited.wait_for(Option::is_some).await);
}

#[cfg(test)]
mod tests {
    use std::{path::PathBuf, time::Duration};

    use super::*;
    use crate::{
        runner::{
            errors::RunnerInstallError,
            host::LocalHost,
            install::{Fixed, Install},
        },
        test_support::{FakePlane, Lines, create_build, is_alive, temp_dir, wait_for},
    };

    fn build() -> RunnerBuild {
        RunnerBuild {
            version: "1.0.0".into(),
            url: "unused".into(),
            sha256: "unused".into(),
        }
    }

    fn start() -> RunnerStart {
        RunnerStart {
            id: "r1".into(),
            name: "manica-r1".into(),
            config: "secret-jit".into(),
        }
    }

    fn setup(env: &[(&str, &str)]) -> (Supervisor, PathBuf, Lines) {
        let template = create_build(env);
        let runners_dir = temp_dir();
        let lines = Lines::default();
        let supervisor = Supervisor::new(
            Arc::new(LocalHost {
                runners_dir: runners_dir.clone(),
                installer: Fixed::dir(template),
            }),
            lines.log(),
        );
        (supervisor, runners_dir, lines)
    }

    async fn child_pid(runners_dir: &std::path::Path) -> i32 {
        let path = runners_dir.join("r1").join("child.pid");
        wait_for(async || std::fs::read_to_string(&path).is_ok_and(|pid| pid.ends_with('\n')))
            .await;
        std::fs::read_to_string(&path)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }

    #[tokio::test]
    async fn runs_a_runner_from_its_own_copy_with_its_config_in_the_environment() {
        let (supervisor, runners_dir, lines) = setup(&[("SLEEP", "0"), ("EXIT_CODE", "3")]);
        supervisor.start(start(), build());
        assert_eq!(supervisor.held(), ["r1"]);
        wait_for(async || supervisor.all_exited()).await;

        assert!(
            lines.contains("[manica-r1] config=secret-jit args="),
            "{:?}",
            lines.all()
        );
        let plane = FakePlane::default();
        supervisor.report_exited(&plane).await;
        assert_eq!(plane.exits(), [("r1".to_owned(), Some(3))]);
        assert!(supervisor.idle());
        // Its copy is gone.
        assert_eq!(std::fs::read_dir(&runners_dir).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn stops_a_runners_whole_process_tree() {
        let (supervisor, runners_dir, _) = setup(&[("SLEEP", "30")]);
        supervisor.start(start(), build());
        let pid = child_pid(&runners_dir).await;
        assert!(is_alive(pid));

        supervisor.stop("r1").await;
        assert!(supervisor.all_exited());
        wait_for(async || !is_alive(pid)).await;
    }

    #[tokio::test]
    async fn keeps_reporting_an_exit_until_the_plane_hears_it() {
        let (supervisor, _, _) = setup(&[("SLEEP", "0"), ("EXIT_CODE", "0")]);
        let plane = FakePlane::default();
        plane.fail_exits(1);
        supervisor.start(start(), build());
        wait_for(async || supervisor.all_exited()).await;
        supervisor.report_exited(&plane).await;
        assert_eq!(supervisor.held(), ["r1"]);
        supervisor.report_exited(&plane).await;
        assert!(supervisor.idle());
    }

    #[tokio::test]
    async fn reports_a_runner_that_failed_to_start_as_exited_without_a_code() {
        let failing: Arc<dyn Install> = Arc::new(Fixed(Err(RunnerInstallError {
            version: "1.0.0".into(),
            reason: "download failed".into(),
            archive: None,
        })));
        let lines = Lines::default();
        let supervisor = Supervisor::new(
            Arc::new(LocalHost {
                runners_dir: temp_dir(),
                installer: failing,
            }),
            lines.log(),
        );
        supervisor.start(start(), build());
        wait_for(async || supervisor.all_exited()).await;
        let plane = FakePlane::default();
        supervisor.report_exited(&plane).await;
        assert_eq!(plane.exits(), [("r1".to_owned(), None)]);
        assert!(
            lines.contains(
                "runner manica-r1 failed: Installing runner 1.0.0 failed: download failed"
            )
        );
    }

    #[tokio::test]
    async fn clears_runners_a_previous_agent_left_running() {
        let (supervisor, runners_dir, _) = setup(&[("SLEEP", "30")]);
        supervisor.start(start(), build());
        let pid = child_pid(&runners_dir).await;

        // A new agent, after this one died without stopping it.
        Supervisor::new(
            Arc::new(LocalHost {
                runners_dir: runners_dir.clone(),
                installer: Fixed::dir(""),
            }),
            Log::none(),
        )
        .clear_stale()
        .await
        .unwrap();
        wait_for(async || !is_alive(pid)).await;
        assert_eq!(std::fs::read_dir(&runners_dir).unwrap().count(), 0);
        // This one sees its runner gone.
        tokio::time::timeout(Duration::from_secs(5), async {
            wait_for(async || supervisor.all_exited()).await;
        })
        .await
        .unwrap();
    }
}
