//! End-to-end check of running jobs in VMs with a real backend, on an Apple
//! silicon Mac that has it installed and a stopped golden VM:
//!
//!   MANICA_E2E_IMAGE=manica-golden cargo test --release --test `e2e_vm` -- --ignored --nocapture
//!
//! (`MANICA_E2E_DATA_DIR` keeps the downloaded runner build between runs.)
//! With the real actions/runner build and a bogus JIT config, the runner must
//! start in the guest and fail on the config, with its exit code coming
//! back. With a stand-in build that sleeps, stopping must stop it and delete
//! its VM. Stopping a job while its VM boots must kill the boot. A host mount
//! added back by Lima's global config must be refused. No VM made here may be
//! left behind.
#![allow(
    clippy::tests_outside_test_module,
    clippy::print_stdout,
    clippy::too_many_lines,
    reason = "an integration test, reporting each step as it goes"
)]

use std::{
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use manica_agent::{
    api::RunnerBuild,
    doctor::{Section, format_sections},
    lines::{Log, lock},
    plane::http_client,
    runner::{
        errors::RunnerError,
        host::{RunOptions, RunnerHost, RunnerJob},
        install::{Fixed, Installer},
        vm_host::{VmHost, VmHostOptions},
    },
    temp_dir::make_temp_dir,
    vm::{
        backend::{VM_PREFIX, VmBackend},
        errors::VmError,
        lima::{Lima, LimaOptions},
    },
};
use tokio_util::sync::CancellationToken;

fn runner() -> RunnerBuild {
    RunnerBuild {
        version: "2.338.2".into(),
        url: "https://github.com/actions/runner/releases/download/v2.338.2/actions-runner-osx-arm64-2.338.2.tar.gz".into(),
        sha256: "25a065af409ffa317ab4d5a3b614dd15fc9c40f2172bc1b35a1b1258e919a388".into(),
    }
}

struct Run {
    started: Instant,
    failures: Mutex<usize>,
}

impl Run {
    fn log(&self, line: &str) {
        println!("{:>6.1}s {line}", self.started.elapsed().as_secs_f64());
    }

    fn expect(&self, ok: bool, what: &str) {
        self.log(&format!("{} {what}", if ok { "PASS" } else { "FAIL" }));
        if !ok {
            *lock(&self.failures) += 1;
        }
    }
}

fn job(id: &str, config: &str) -> RunnerJob {
    RunnerJob {
        id: id.into(),
        name: id.into(),
        config: config.into(),
        build: runner(),
    }
}

#[tokio::test]
#[ignore = "needs Lima and a golden VM: set MANICA_E2E_IMAGE"]
async fn runs_jobs_in_real_vms() {
    let image = std::env::var("MANICA_E2E_IMAGE").unwrap_or_else(|_| "manica-golden".into());
    let run = Arc::new(Run {
        started: Instant::now(),
        failures: Mutex::new(0),
    });
    let log = {
        let run = Arc::clone(&run);
        Log::new(move |line| run.log(line))
    };
    let collect = |into: Arc<Mutex<Vec<String>>>, prefix: &'static str| -> Log {
        let run = Arc::clone(&run);
        Log::new(move |line| {
            lock(&into).push(line.to_owned());
            run.log(&format!(
                "  {prefix}{}",
                line.chars().take(160).collect::<String>()
            ));
        })
    };

    let backend = Arc::new(Lima::new(LimaOptions::default()));
    let checks = backend.diagnose(Some(&image)).await;
    let failed = checks.iter().any(manica_agent::checks::Check::failed);
    println!(
        "{}",
        format_sections(&[Section {
            title: "diagnose".into(),
            checks,
            counts: true,
        }])
    );
    run.expect(!failed, "diagnose finds nothing failing");

    let dir = std::env::var_os("MANICA_E2E_DATA_DIR").map_or_else(
        || make_temp_dir(&std::env::temp_dir(), "manica-e2e-").unwrap(),
        PathBuf::from,
    );
    let installer = Arc::new(Installer::new(dir.join("builds"), http_client().unwrap()));
    let host = VmHost::new(VmHostOptions {
        stop_grace: Duration::from_secs(5),
        ..VmHostOptions::new(Arc::<Lima>::clone(&backend), image.clone(), installer)
    });
    // Like the agent: claim the namespace first, so this never deletes the
    // VMs of an agent running alongside.
    host.check().await.unwrap();
    host.clear_stale().await.unwrap();

    // 1. The real runner, with a config it can't parse.
    {
        let output = Arc::new(Mutex::new(Vec::new()));
        let t0 = Instant::now();
        let exit = host
            .run(
                job("e2e-real", "eyJhIjoiYiJ9"),
                RunOptions {
                    stop: CancellationToken::new(),
                    log: log.clone(),
                    output: collect(Arc::clone(&output), "[guest] "),
                },
            )
            .await;
        run.log(&format!(
            "real runner: {exit:?} after {:.1}s",
            t0.elapsed().as_secs_f64()
        ));
        // run.sh exits 0 on a config it can't parse ("terminated error, no
        // retry needed"); exit codes coming through is checked with the
        // stand-in below.
        run.expect(
            matches!(exit, Ok(Some(0))),
            "it ran to completion (run.sh exits 0 here)",
        );
        let output = lock(&output);
        run.expect(
            output.iter().any(|line| {
                ["Base-64", "FormatException", "JIT", "jitconfig"]
                    .iter()
                    .any(|word| line.to_lowercase().contains(&word.to_lowercase()))
            }),
            "it ran in the guest and failed on the config",
        );
    }

    // 2. A stand-in that sleeps, stopped while it runs.
    {
        // limactl doesn't forward the agent's environment, so this stand-in
        // sleeps unconditionally. It exits with 3 on SIGTERM, as a runner
        // stopping cleanly, while its child (not started from the runner's
        // directory) must be stopped with the group.
        let template = make_temp_dir(&std::env::temp_dir(), "manica-e2e-build-").unwrap();
        let run_sh = template.join("run.sh");
        std::fs::write(
            &run_sh,
            "#!/bin/bash\ntrap \"echo got TERM; exit 3\" TERM\necho \"config=$ACTIONS_RUNNER_INPUT_JITCONFIG args=$*\"\nsleep 600 &\nwait\n",
        )
        .unwrap();
        std::fs::set_permissions(&run_sh, std::fs::Permissions::from_mode(0o755)).unwrap();
        let stand_in = VmHost::new(VmHostOptions {
            stop_grace: Duration::from_secs(5),
            ..VmHostOptions::new(
                Arc::<Lima>::clone(&backend),
                image.clone(),
                Fixed::dir(template),
            )
        });
        let output = Arc::new(Mutex::new(Vec::<String>::new()));
        let stop = CancellationToken::new();
        let running = stand_in.run(
            job("e2e-stop", "secret-jit"),
            RunOptions {
                stop: stop.clone(),
                log: log.clone(),
                output: collect(Arc::clone(&output), "[guest] "),
            },
        );
        let stopping = async {
            let deadline = Instant::now() + Duration::from_secs(180);
            while !output
                .lock()
                .unwrap()
                .iter()
                .any(|line| line.starts_with("config="))
                && Instant::now() < deadline
            {
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
            run.expect(
                output
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|line| line == "config=secret-jit args="),
                "the config reached the runner through stdin",
            );
            stop.cancel();
            Instant::now()
        };
        let (exit, t0) = tokio::join!(running, stopping);
        run.log(&format!(
            "stand-in: stopped with {exit:?} after {:.1}s",
            t0.elapsed().as_secs_f64()
        ));
        run.expect(
            matches!(exit, Ok(Some(3))),
            "its exit code came back through the backend",
        );
        run.expect(
            t0.elapsed() < Duration::from_secs(4),
            "it stopped on SIGTERM, before the grace period ran out",
        );
    }

    // 3. Stopped while its VM boots: the boot is killed and the VM deleted.
    {
        let stop = CancellationToken::new();
        let running = host.run(
            job("e2e-boot", "unused"),
            RunOptions {
                stop: stop.clone(),
                log: log.clone(),
                output: log.clone(),
            },
        );
        let stopping = async {
            // Clone takes well under a second; then the boot (~15 s).
            tokio::time::sleep(Duration::from_secs(3)).await;
            stop.cancel();
            Instant::now()
        };
        let (exit, t0) = tokio::join!(running, stopping);
        run.log(&format!(
            "stopped while booting: {exit:?} after {:.1}s",
            t0.elapsed().as_secs_f64()
        ));
        run.expect(matches!(exit, Ok(None)), "it never ran");
        run.expect(
            t0.elapsed() < Duration::from_secs(10),
            "stopping it took under 10 s",
        );
    }

    // 4. Lima's global config adds a host mount back: the clone is refused,
    // never started. Skipped if the user has an override.yaml of their own.
    {
        let config = backend.namespace().join("_config");
        let overrides = config.join("override.yaml");
        if overrides.exists() {
            run.log(&format!(
                "SKIP global mount check: {} exists",
                overrides.display()
            ));
        } else {
            std::fs::create_dir_all(&config).unwrap();
            std::fs::write(&overrides, "mounts:\n- location: \"~\"\n").unwrap();
            let result = host
                .run(
                    job("e2e-mount", "unused"),
                    RunOptions {
                        stop: CancellationToken::new(),
                        log: log.clone(),
                        output: log.clone(),
                    },
                )
                .await;
            std::fs::remove_file(&overrides).unwrap();
            run.log(&format!("with a global mount: {result:?}"));
            run.expect(
                matches!(result, Err(RunnerError::Vm(VmError::Isolation { .. }))),
                "a clone that would mount a host directory is refused",
            );
        }
    }

    let left: Vec<String> = backend
        .list()
        .await
        .unwrap()
        .into_iter()
        .filter(|vm| vm.starts_with(VM_PREFIX))
        .collect();
    run.expect(
        left.is_empty(),
        &format!("no {VM_PREFIX}* VM left behind ({})", left.join(", ")),
    );
    let failures = *lock(&run.failures);
    assert_eq!(failures, 0, "{failures} failed");
}
