use std::time::Duration;

use tokio::time::Instant;
use tokio_util::sync::CancellationToken;

use crate::{
    api::{AgentMetrics, AgentPoll},
    errors::AgentError,
    lines::{error, info},
    metrics::Sampler,
    plane::{PlaneApi, PlaneError},
    runner::supervisor::Supervisor,
    version::VERSION,
};

/// Signals for shutting down: `drain` stops taking jobs and waits for the
/// running ones, `stop` stops them too.
#[derive(Debug, Clone, Default)]
pub struct Shutdown {
    pub drain: CancellationToken,
    pub stop: CancellationToken,
}

#[derive(Debug)]
pub struct LiveOptions {
    pub origin: String,
    pub poll_interval: Duration,
    /// Between metrics readings, if they're reported.
    pub metrics_interval: Option<Duration>,
}

/// Reads metrics once every metrics interval, from one interval after it's
/// made: a reading that fails is skipped, logged only if the one before it
/// didn't fail too.
#[derive(Debug)]
struct MetricsReader {
    sampler: Option<(Duration, Box<dyn Sampler>)>,
    next: Instant,
    failing: bool,
}

impl MetricsReader {
    fn new(interval: Option<Duration>, sampler: Option<Box<dyn Sampler>>) -> Self {
        let sampler = interval.zip(sampler);
        let next = Instant::now()
            + sampler
                .as_ref()
                .map_or(Duration::ZERO, |(interval, _)| *interval);
        Self {
            sampler,
            next,
            failing: false,
        }
    }

    async fn read(&mut self) -> Option<AgentMetrics> {
        let (interval, sampler) = self.sampler.as_mut()?;
        if Instant::now() < self.next {
            return None;
        }
        self.next = Instant::now() + *interval;
        match sampler.sample().await {
            Ok(metrics) => {
                self.failing = false;
                Some(metrics)
            }
            Err(problem) => {
                if !self.failing {
                    error(&format!("reading metrics failed: {problem}"));
                }
                self.failing = true;
                None
            }
        }
    }
}

/// Polls the plane every poll interval, until shut down.
///
/// Each poll reports the runners it holds (and, when enabled, this
/// machine's metrics), starts the ones the plane hands out, and stops the
/// ones the plane gave up on. Returns once shut down and every runner is
/// done (and reported, while the plane can be reached).
///
/// # Errors
///
/// `TokenRejected` once the plane rejects the token, after stopping every
/// runner; or if what a previous agent left can't be cleared.
pub async fn run_live(
    options: LiveOptions,
    plane: &dyn PlaneApi,
    supervisor: &Supervisor,
    shutdown: &Shutdown,
    sampler: Option<Box<dyn Sampler>>,
) -> Result<(), AgentError> {
    info(&format!("connecting to {}", options.origin));
    supervisor.clear_stale().await?;
    let mut metrics = MetricsReader::new(options.metrics_interval, sampler);

    let mut connected = false;
    let mut stopping = false;
    loop {
        if shutdown.stop.is_cancelled() && !stopping {
            stopping = true;
            let supervisor = supervisor.clone();
            tokio::spawn(async move { supervisor.stop_all().await });
        }
        supervisor.report_exited(plane).await;
        let accepting = !shutdown.drain.is_cancelled();
        if !accepting && supervisor.idle() {
            break;
        }

        let poll = AgentPoll {
            accepting,
            runners: supervisor.held(),
            metrics: metrics.read().await,
            version: VERSION.try_into().ok(),
        };
        match plane.poll(&poll).await {
            Ok(polled) => {
                if !connected {
                    info("connected");
                }
                connected = true;
                for id in polled.cancel {
                    let supervisor = supervisor.clone();
                    tokio::spawn(async move { supervisor.stop(&id).await });
                }
                if let Some(build) = polled.runner {
                    for start in polled.start {
                        supervisor.start(start, build.clone());
                    }
                }
            }
            Err(PlaneError::Unauthorized) => {
                supervisor.stop_all().await;
                return Err(AgentError::TokenRejected);
            }
            Err(problem) => {
                if connected {
                    error("lost connection to the plane, retrying");
                }
                error(&format!("poll failed: {problem}"));
                connected = false;
                // Stopping with the plane unreachable: no one to report to.
                if stopping && supervisor.all_exited() {
                    break;
                }
            }
        }

        // Once stopping, the stop signal no longer cuts the wait short.
        let wait = tokio::time::sleep(options.poll_interval);
        if stopping {
            wait.await;
        } else {
            tokio::select! {
                () = wait => {}
                () = shutdown.stop.cancelled() => {}
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::lines::lock;
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;

    use super::*;
    use crate::{
        api::{RunnerBuild, RunnerStart},
        lines::Log,
        runner::{
            errors::RunnerError,
            host::{RunOptions, RunnerHost, RunnerJob},
        },
        test_support::{FakePlane, wait_for},
    };

    /// Runners that run until stopped.
    #[derive(Debug)]
    struct UntilStopped;

    #[async_trait]
    impl RunnerHost for UntilStopped {
        async fn run(&self, _: RunnerJob, options: RunOptions) -> Result<Option<i32>, RunnerError> {
            options.stop.cancelled().await;
            Ok(Some(143))
        }

        async fn clear_stale(&self) -> Result<(), RunnerError> {
            Ok(())
        }
    }

    fn build() -> RunnerBuild {
        RunnerBuild {
            version: "1.0.0".into(),
            url: "unused".into(),
            sha256: "unused".into(),
        }
    }

    fn start(id: &str) -> RunnerStart {
        RunnerStart {
            id: id.into(),
            name: format!("manica-{id}"),
            config: "jit".into(),
        }
    }

    fn options(metrics_interval: Option<Duration>) -> LiveOptions {
        LiveOptions {
            origin: "http://plane.test".into(),
            poll_interval: Duration::from_millis(1),
            metrics_interval,
        }
    }

    fn supervisor() -> Supervisor {
        Supervisor::new(Arc::new(UntilStopped), Log::none())
    }

    #[tokio::test]
    async fn starts_and_stops_runners_as_the_plane_says_and_lists_them() {
        let plane = FakePlane::default();
        plane.reply(Ok(FakePlane::result(
            vec![start("a")],
            vec![],
            Some(build()),
        )));
        plane.reply(Ok(FakePlane::result(
            vec![],
            vec!["a".into()],
            Some(build()),
        )));
        let supervisor = supervisor();
        let shutdown = Shutdown::default();
        let live = run_live(options(None), &plane, &supervisor, &shutdown, None);
        let drain = async {
            wait_for(async || plane.polls().len() >= 3 && supervisor.idle()).await;
            shutdown.drain.cancel();
        };
        let (result, ()) = tokio::join!(live, drain);
        result.unwrap();

        let polls = plane.polls();
        assert_eq!(polls[1].runners, ["a"]);
        assert!(polls[1].accepting);
        assert_eq!(
            polls[1].version.as_deref().map(String::as_str),
            Some(VERSION)
        );
        assert_eq!(plane.exits(), [("a".to_owned(), Some(143))]);
    }

    #[tokio::test]
    async fn drains_takes_no_new_jobs_and_waits_for_running_ones() {
        let plane = FakePlane::default();
        plane.reply(Ok(FakePlane::result(
            vec![start("a")],
            vec![],
            Some(build()),
        )));
        let supervisor = supervisor();
        let shutdown = Shutdown::default();
        let live = run_live(options(None), &plane, &supervisor, &shutdown, None);
        let signals = async {
            wait_for(async || !plane.polls().is_empty()).await;
            shutdown.drain.cancel();
            let drained = plane.polls().len();
            wait_for(async || plane.polls().len() > drained + 1).await;
            let last = plane.polls().pop().unwrap();
            assert!(!last.accepting);
            assert_eq!(last.runners, ["a"]);
            // A second signal stops the running one.
            shutdown.stop.cancel();
        };
        let (result, ()) = tokio::join!(live, signals);
        result.unwrap();
        assert!(supervisor.idle());
    }

    #[tokio::test]
    async fn keeps_polling_through_plane_outages() {
        let plane = FakePlane::default();
        plane.reply(Err(PlaneError::Http {
            status: 503,
            detail: None,
        }));
        plane.reply(Err(PlaneError::Network("connection refused".into())));
        let supervisor = supervisor();
        let shutdown = Shutdown::default();
        let live = run_live(options(None), &plane, &supervisor, &shutdown, None);
        let drain = async {
            wait_for(async || plane.polls().len() >= 3).await;
            shutdown.drain.cancel();
        };
        let (result, ()) = tokio::join!(live, drain);
        result.unwrap();
    }

    #[tokio::test]
    async fn gives_up_on_a_rejected_token() {
        let plane = FakePlane::default();
        plane.reply(Err(PlaneError::Unauthorized));
        let result = run_live(
            options(None),
            &plane,
            &supervisor(),
            &Shutdown::default(),
            None,
        )
        .await;
        assert!(matches!(result, Err(AgentError::TokenRejected)));
    }

    #[derive(Debug)]
    struct Readings {
        count: Arc<Mutex<usize>>,
    }

    fn reading() -> AgentMetrics {
        AgentMetrics {
            cpu: 0.5,
            memory_used: 1,
            memory_total: 2,
            disk_used: 3,
            disk_total: 4,
        }
    }

    #[async_trait]
    impl Sampler for Readings {
        async fn sample(&mut self) -> Result<AgentMetrics, String> {
            let count = {
                let mut count = lock(&self.count);
                *count += 1;
                *count
            };
            // A failed reading is skipped.
            if count == 2 {
                return Err("vm_stat failed".into());
            }
            Ok(reading())
        }
    }

    #[tokio::test]
    async fn reports_metrics_once_every_metrics_interval_when_enabled() {
        let plane = FakePlane::default();
        let count = Arc::new(Mutex::new(0));
        let supervisor = supervisor();
        let shutdown = Shutdown::default();
        let live = run_live(
            options(Some(Duration::from_millis(30))),
            &plane,
            &supervisor,
            &shutdown,
            Some(Box::new(Readings {
                count: Arc::clone(&count),
            })),
        );
        let drain = async {
            wait_for(async || *lock(&count) >= 3).await;
            shutdown.drain.cancel();
        };
        let (result, ()) = tokio::join!(live, drain);
        result.unwrap();

        let polls = plane.polls();
        // None in the first interval: CPU use is measured over it.
        assert!(polls[0].metrics.is_none());
        let reported: Vec<_> = polls
            .iter()
            .filter_map(|poll| poll.metrics.as_ref())
            .collect();
        assert_eq!(reported.len(), 2);
        assert_eq!(reported[0].disk_total, reading().disk_total);
        assert!(polls.len() > 3);
    }

    #[tokio::test]
    async fn reports_no_metrics_unless_enabled() {
        let plane = FakePlane::default();
        let count = Arc::new(Mutex::new(0));
        let supervisor = supervisor();
        let shutdown = Shutdown::default();
        let live = run_live(
            options(None),
            &plane,
            &supervisor,
            &shutdown,
            Some(Box::new(Readings {
                count: Arc::clone(&count),
            })),
        );
        let drain = async {
            wait_for(async || plane.polls().len() >= 3).await;
            shutdown.drain.cancel();
        };
        let (result, ()) = tokio::join!(live, drain);
        result.unwrap();
        assert!(plane.polls().iter().all(|poll| poll.metrics.is_none()));
        assert_eq!(*lock(&count), 0);
    }
}
