use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use super::{
    errors::RunnerError,
    host::{RunOptions, RunnerHost, RunnerJob},
    install::Install,
    process::STOP_GRACE,
};
use crate::{
    checks::failed,
    errors::AgentError,
    lines::{Log, info, lock},
    vm::{
        backend::{ExecOptions, GuestStdin, VM_PREFIX, VmBackend, vm_name},
        command::{exit_code, read_all, take_output, wait_or_kill},
        errors::{VmError, last},
        namespace_lock::claim_namespace,
    },
};

/// Where the runner build goes in the guest.
const GUEST_RUNNER_DIR: &str = "$HOME/actions-runner";

/// Deleting a job's VM is tried this many times before it's left for the
/// next job to retry.
const DELETE_ATTEMPTS: u32 = 3;

/// Unpacks a tar stream from stdin into the runner directory.
fn unpack_script() -> String {
    format!(
        r#"rm -rf "{GUEST_RUNNER_DIR}" && mkdir -p "{GUEST_RUNNER_DIR}" && tar -xf - -C "{GUEST_RUNNER_DIR}""#
    )
}

/// Records the runner's process group, which its session over SSH leads.
/// Only if it does lead one: stopping must never signal another group.
fn pid_file() -> String {
    format!("{GUEST_RUNNER_DIR}/.manica-pgid")
}

/// Starts the runner with the JIT config read from the first line of stdin,
/// rather than from argv, which other users of the guest could see. It exits
/// with 7, instead of retrying, on a runner version GitHub deprecated.
fn run_script() -> String {
    let pid_file = pid_file();
    format!(
        r#"IFS= read -r config
cd "{GUEST_RUNNER_DIR}" || exit 1
[ "$(ps -o pgid= -p $$ | tr -d ' ')" = "$$" ] && echo $$ > "{pid_file}"
export ACTIONS_RUNNER_INPUT_JITCONFIG="$config" ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE=1
unset config
exec "{GUEST_RUNNER_DIR}/run.sh""#
    )
}

/// Asks the runner to stop: SIGTERM to its whole process group (the
/// listener, the worker, the job's steps), as on the host. Deleting the VM
/// afterwards takes care of anything that ignores it. No `--` before the
/// group: dash's `kill` rejects it.
fn stop_script() -> String {
    let pid_file = pid_file();
    format!(
        r#"pgid=$(cat "{pid_file}" 2>/dev/null) && [ -n "$pgid" ] && kill -TERM "-$pgid"; true"#
    )
}

#[derive(Debug)]
pub struct VmHostOptions {
    pub backend: Arc<dyn VmBackend>,
    /// The stopped VM jobs are cloned from.
    pub image: String,
    pub installer: Arc<dyn Install>,
    pub stop_grace: Duration,
    /// Between attempts at deleting a VM.
    pub delete_retry: Duration,
    /// Where the backend namespace's lock goes (see `claim_namespace`).
    pub lock_dir: Option<PathBuf>,
}

impl VmHostOptions {
    pub fn new(backend: Arc<dyn VmBackend>, image: String, installer: Arc<dyn Install>) -> Self {
        Self {
            backend,
            image,
            installer,
            stop_grace: STOP_GRACE,
            delete_retry: Duration::from_secs(2),
            lock_dir: None,
        }
    }
}

/// Runs each runner in a fresh macOS VM cloned from the image, deleted once
/// the runner is done: nothing a job does outlives it, and it can't see the
/// host's files or the agent's token.
#[derive(Debug)]
pub struct VmHost {
    options: VmHostOptions,
    /// VMs of finished jobs that couldn't be deleted yet.
    undeleted: Mutex<BTreeSet<String>>,
}

impl VmHost {
    #[must_use]
    pub fn new(options: VmHostOptions) -> Self {
        Self {
            options,
            undeleted: Mutex::default(),
        }
    }

    fn backend(&self) -> &dyn VmBackend {
        self.options.backend.as_ref()
    }

    /// Claims the backend's namespace for this agent, and fails if jobs
    /// can't run with this backend and image, so the agent doesn't take jobs
    /// it would only fail.
    ///
    /// # Errors
    ///
    /// `VmBackendUnavailable` if jobs can't run with it, or
    /// `VmNamespaceInUse` if another agent uses its namespace.
    pub async fn check(&self) -> Result<(), AgentError> {
        let checks = self.backend().diagnose(Some(&self.options.image)).await;
        let problems = failed(&checks);
        if !problems.is_empty() {
            return Err(AgentError::VmBackendUnavailable {
                backend: self.backend().name().to_owned(),
                problems: problems.iter().map(|check| check.message.clone()).collect(),
            });
        }
        claim_namespace(self.backend().namespace(), self.options.lock_dir.as_deref())?;
        Ok(())
    }

    /// Copies the build the host downloaded and verified into the guest.
    async fn copy_build(
        &self,
        vm: &str,
        build: &Path,
        stop: &CancellationToken,
    ) -> Result<(), VmError> {
        let copy_error = |reason: String| VmError::GuestCopy {
            vm: vm.to_owned(),
            reason,
        };
        let mut tar = Command::new("tar")
            .arg("-C")
            .arg(build)
            .args(["-cf", "-", "."])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| copy_error(format!("tar could not be started: {error}")))?;
        let (archive, tar_stderr) =
            take_output(&mut tar).map_err(|error| copy_error(error.to_string()))?;
        let archive: Stdio = archive
            .try_into()
            .map_err(|error: std::io::Error| copy_error(error.to_string()))?;
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let output = {
            let lines = Arc::clone(&lines);
            Log::new(move |line| lock(&lines).push(line.to_owned()))
        };
        let unpack = unpack_script();
        let mut unpacking = self.backend().exec(
            vm,
            &["/bin/sh", "-c", &unpack],
            ExecOptions {
                stdin: GuestStdin::Pipe(archive),
                output: Some(output),
                stop: Some(stop.clone()),
            },
        )?;
        let (tar_status, tar_stderr, unpack_exit) = tokio::join!(
            wait_or_kill(&mut tar, Some(stop)),
            read_all(tar_stderr),
            unpacking.wait()
        );
        let tar_exit = tar_status.map_or(-1, exit_code);
        if tar_exit != 0 {
            return Err(copy_error(format!(
                "tar exited with {tar_exit}: {}",
                tar_stderr.trim()
            )));
        }
        if unpack_exit != 0 {
            let last = last(&lock(&lines), 3).join(" ");
            return Err(copy_error(format!(
                "unpacking exited with {unpack_exit}: {last}"
            )));
        }
        Ok(())
    }

    /// Deletes `vm`, retrying a few times. If it still can't, it's kept for
    /// the next job to retry first.
    async fn remove(&self, vm: &str, log: &Log) {
        for attempt in 1.. {
            match self.backend().delete(vm).await {
                Ok(()) => {
                    lock(&self.undeleted).remove(vm);
                    return;
                }
                Err(error) => {
                    log.line(&format!("deleting VM {vm} failed: {error}"));
                    if attempt >= DELETE_ATTEMPTS {
                        lock(&self.undeleted).insert(vm.to_owned());
                        return;
                    }
                    tokio::time::sleep(self.options.delete_retry).await;
                }
            }
        }
    }

    /// Runs the runner in a booted `vm` until it exits, or until it's been
    /// stopped and its grace period ran out.
    async fn run_in_guest(
        &self,
        vm: &str,
        config: &str,
        stop: &CancellationToken,
        output: Log,
    ) -> Result<Option<i32>, VmError> {
        let run = run_script();
        let mut runner = self.backend().exec(
            vm,
            &["/bin/sh", "-c", &run],
            ExecOptions {
                stdin: GuestStdin::Bytes(format!("{config}\n").into_bytes()),
                output: Some(output),
                stop: None,
            },
        )?;
        tokio::select! {
            code = runner.wait() => return Ok(Some(code)),
            () = stop.cancelled() => {}
        }
        let script = stop_script();
        if let Ok(mut stopping) =
            self.backend()
                .exec(vm, &["/bin/sh", "-c", &script], ExecOptions::default())
        {
            tokio::spawn(async move { stopping.wait().await });
        }
        Ok(tokio::time::timeout(self.options.stop_grace, runner.wait())
            .await
            .ok())
    }
}

#[async_trait]
impl RunnerHost for VmHost {
    /// Deletes the VMs a previous agent left behind. Never the image, even
    /// if its name looks like theirs (the config refuses that anyway).
    async fn clear_stale(&self) -> Result<(), RunnerError> {
        for vm in self.backend().list().await? {
            if !vm.starts_with(VM_PREFIX) || vm == self.options.image {
                continue;
            }
            info(&format!("deleting VM {vm}, left over by a previous agent"));
            self.backend().delete(&vm).await?;
        }
        Ok(())
    }

    async fn run(&self, job: RunnerJob, options: RunOptions) -> Result<Option<i32>, RunnerError> {
        // No new VM while an old one may still run: the Mac can only run so
        // many, and the old one's job may not be over.
        let undeleted: Vec<String> = lock(&self.undeleted).iter().cloned().collect();
        for vm in undeleted {
            self.remove(&vm, &options.log).await;
        }
        let undeleted: Vec<String> = lock(&self.undeleted).iter().cloned().collect();
        if !undeleted.is_empty() {
            return Err(VmError::Cleanup { vms: undeleted }.into());
        }

        let vm = vm_name(&job.id);
        let stop = &options.stop;
        let result = async {
            let installed = self.options.installer.ensure(&job.build).await?;
            if stop.is_cancelled() {
                return Ok(None);
            }
            options
                .log
                .line(&format!("creating VM {vm} from {}", self.options.image));
            // Cancelling kills what these run, and they fail.
            self.backend()
                .clone_vm(&self.options.image, &vm, Some(stop))
                .await?;
            self.backend().start(&vm, Some(stop)).await?;
            self.copy_build(&vm, &installed, stop).await?;
            if stop.is_cancelled() {
                return Ok(None);
            }
            options
                .log
                .line(&format!("starting runner {} in {vm}", job.name));
            Ok::<_, RunnerError>(
                self.run_in_guest(&vm, &job.config, stop, options.output.clone())
                    .await?,
            )
        }
        .await;
        options.log.line(&format!("deleting VM {vm}"));
        self.remove(&vm, &options.log).await;
        match result {
            // Stopped while its VM was being made: it never ran.
            Err(_) if stop.is_cancelled() => Ok(None),
            result => result,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;
    use crate::{
        api::RunnerBuild,
        runner::install::Fixed,
        test_support::{FakeLimactl, Instance, Lines, create_build, golden},
        vm::lima::{ISOLATED, Lima, LimaOptions},
    };

    fn clone_call() -> String {
        let sets: Vec<String> = ISOLATED
            .iter()
            .map(|setting| format!("--set {setting}"))
            .collect();
        format!("clone --tty=false {} golden", sets.join(" "))
    }

    fn job() -> RunnerJob {
        RunnerJob {
            id: "r1".into(),
            name: "manica-r1".into(),
            config: "secret-jit".into(),
            build: RunnerBuild {
                version: "1.0.0".into(),
                url: "unused".into(),
                sha256: "unused".into(),
            },
        }
    }

    struct Setup {
        fake: FakeLimactl,
        host: VmHost,
        log: Lines,
        output: Lines,
    }

    impl Setup {
        fn new(env: &[(&str, &str)]) -> Self {
            let fake = FakeLimactl::new(&[golden()]);
            let template = create_build(env);
            let host = VmHost::new(VmHostOptions {
                stop_grace: Duration::from_millis(200),
                delete_retry: Duration::from_millis(10),
                ..VmHostOptions::new(lima(&fake), "golden".into(), Fixed::dir(template))
            });
            Self {
                fake,
                host,
                log: Lines::default(),
                output: Lines::default(),
            }
        }

        async fn run(&self, stop: CancellationToken) -> Result<Option<i32>, RunnerError> {
            self.host
                .run(
                    job(),
                    RunOptions {
                        stop,
                        log: self.log.log(),
                        output: self.output.log(),
                    },
                )
                .await
        }
    }

    fn lima(fake: &FakeLimactl) -> Arc<Lima> {
        Arc::new(Lima::new(LimaOptions {
            limactl: Some(fake.limactl()),
            home: None,
        }))
    }

    #[tokio::test]
    async fn runs_the_runner_in_a_fresh_vm_from_the_hosts_build_then_deletes_it() {
        let setup = Setup::new(&[("EXIT_CODE", "3")]);
        assert_eq!(setup.run(CancellationToken::new()).await.unwrap(), Some(3));
        // The build was copied into the guest and run from there, with the
        // config through stdin.
        assert!(
            setup.output.contains("config=secret-jit args="),
            "{:?}",
            setup.output.all()
        );
        assert!(
            setup
                .fake
                .guest_home("manica-runner-r1")
                .join("actions-runner")
                .join("run.sh")
                .exists()
        );
        let calls = setup.fake.calls();
        assert_eq!(calls[0], format!("{} manica-runner-r1", clone_call()));
        assert_eq!(calls[1], "list --json manica-runner-r1");
        assert!(calls[2].starts_with("start "));
        assert_eq!(calls.last().unwrap(), "delete --force manica-runner-r1");
        assert!(!calls.join("\n").contains("secret-jit"));
    }

    #[tokio::test]
    async fn deletes_the_vm_when_it_fails_to_start() {
        let setup = Setup::new(&[]);
        setup.fake.set("FAKE_LIMA_FAIL_CLONE", "1");
        let error = setup.run(CancellationToken::new()).await.unwrap_err();
        assert!(error.to_string().contains("clone failed"), "{error}");
        assert_eq!(
            setup.fake.calls().last().unwrap(),
            "delete --force manica-runner-r1"
        );
    }

    #[tokio::test]
    async fn stops_the_runner_then_deletes_its_vm() {
        let setup = Setup::new(&[("SLEEP", "30")]);
        let stop = CancellationToken::new();
        let running = setup.run(stop.clone());
        let stopping = async {
            crate::test_support::wait_for(async || {
                setup
                    .output
                    .all()
                    .iter()
                    .any(|line| line.starts_with("config="))
            })
            .await;
            stop.cancel();
            Instant::now()
        };
        let (result, stopped_at) = tokio::join!(running, stopping);
        // It stopped on SIGTERM, before its grace period ran out: it exited.
        assert!(
            matches!(result, Ok(Some(_))),
            "the runner exited: {result:?}"
        );
        assert!(
            stopped_at.elapsed() < Duration::from_secs(5),
            "it stopped promptly"
        );
        // What it started was stopped with it.
        let child = setup
            .fake
            .guest_home("manica-runner-r1")
            .join("actions-runner")
            .join("child.pid");
        let pid: i32 = std::fs::read_to_string(child)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        crate::test_support::wait_for(async || !crate::test_support::is_alive(pid)).await;
        let calls = setup.fake.calls();
        assert!(calls.iter().any(|call| call.contains("kill -TERM")));
        assert_eq!(calls.last().unwrap(), "delete --force manica-runner-r1");
    }

    #[tokio::test]
    async fn doesnt_start_a_vm_once_stopped() {
        let setup = Setup::new(&[]);
        let stop = CancellationToken::new();
        stop.cancel();
        assert_eq!(setup.run(stop).await.unwrap(), None);
        assert_eq!(setup.fake.calls(), ["delete --force manica-runner-r1"]);
    }

    #[tokio::test]
    async fn clears_the_vms_a_previous_agent_left_and_only_those() {
        let fake = FakeLimactl::new(&[
            golden(),
            Instance::named("manica-runner-old", "Running"),
            Instance::named("manica-golden", "Stopped"),
            Instance::named("mine", "Running"),
        ]);
        let lima = lima(&fake);
        VmHost::new(VmHostOptions::new(
            Arc::<Lima>::clone(&lima),
            "golden".into(),
            Fixed::dir(""),
        ))
        .clear_stale()
        .await
        .unwrap();
        assert_eq!(
            lima.list().await.unwrap(),
            ["golden", "manica-golden", "mine"]
        );
    }

    #[tokio::test]
    async fn never_clears_the_image_even_named_like_a_jobs_vm() {
        let fake = FakeLimactl::new(&[Instance {
            name: "manica-runner-golden",
            ..golden()
        }]);
        let lima = lima(&fake);
        VmHost::new(VmHostOptions::new(
            Arc::<Lima>::clone(&lima),
            "manica-runner-golden".into(),
            Fixed::dir(""),
        ))
        .clear_stale()
        .await
        .unwrap();
        assert_eq!(lima.list().await.unwrap(), ["manica-runner-golden"]);
    }

    #[tokio::test]
    async fn deletes_a_vm_whose_clone_isnt_isolated_without_starting_it() {
        let setup = Setup::new(&[]);
        setup.fake.set("FAKE_LIMA_GLOBAL_MOUNT", "1");
        let error = setup.run(CancellationToken::new()).await.unwrap_err();
        assert!(
            matches!(error, RunnerError::Vm(VmError::Isolation { .. })),
            "{error}"
        );
        let calls = setup.fake.calls();
        assert!(!calls.iter().any(|call| call.starts_with("start ")));
        assert_eq!(calls.last().unwrap(), "delete --force manica-runner-r1");
    }

    #[tokio::test]
    async fn stopping_while_the_vm_boots_kills_the_boot_and_deletes_the_vm() {
        let setup = Setup::new(&[]);
        setup.fake.set("FAKE_LIMA_START_SLEEP", "30");
        let stop = CancellationToken::new();
        let running = setup.run(stop.clone());
        let stopping = async {
            crate::test_support::wait_for(async || {
                setup
                    .fake
                    .calls()
                    .iter()
                    .any(|call| call.starts_with("start "))
            })
            .await;
            stop.cancel();
            Instant::now()
        };
        let (result, stopped_at) = tokio::join!(running, stopping);
        assert_eq!(result.unwrap(), None);
        assert!(stopped_at.elapsed() < Duration::from_secs(2));
        assert_eq!(
            setup.fake.calls().last().unwrap(),
            "delete --force manica-runner-r1"
        );
    }

    #[tokio::test]
    async fn a_vm_that_cant_be_deleted_blocks_new_jobs_until_it_is() {
        let setup = Setup::new(&[]);
        setup.fake.set("FAKE_LIMA_FAIL_DELETE", "1");
        assert_eq!(setup.run(CancellationToken::new()).await.unwrap(), Some(0));
        let failures = setup
            .log
            .all()
            .iter()
            .filter(|line| line.starts_with("deleting VM manica-runner-r1 failed"))
            .count();
        assert_eq!(failures, 3);
        let error = setup.run(CancellationToken::new()).await.unwrap_err();
        assert!(
            matches!(error, RunnerError::Vm(VmError::Cleanup { .. })),
            "{error}"
        );
        setup.fake.unset("FAKE_LIMA_FAIL_DELETE");
        // Once it can be deleted, jobs run again.
        assert_eq!(setup.run(CancellationToken::new()).await.unwrap(), Some(0));
        assert_eq!(lima(&setup.fake).list().await.unwrap(), ["golden"]);
    }
}
