use std::{process::ExitCode, sync::Arc};

use manica_agent::{
    cli::{Command, USAGE, parse_cli},
    config::{Config, default_config_dir, load_config},
    doctor::{all_backends, check_plane, diagnose, format_sections, healthy},
    errors::AgentError,
    lines::{Log, error, info},
    live::{LiveOptions, Shutdown, run_live},
    metrics::{Sampler, SystemSampler},
    plane::{Plane, http_client},
    runner::{
        host::{LocalHost, RunnerHost},
        install::Installer,
        supervisor::Supervisor,
        vm_host::{VmHost, VmHostOptions},
    },
    version::VERSION,
};
use tokio::signal::unix::{SignalKind, signal};

/// Where jobs run: in VMs if `[vm]` is set, checked up front so the agent
/// doesn't take jobs it would only fail; otherwise on this machine.
async fn create_host(
    config: &Config,
    client: reqwest::Client,
) -> Result<Arc<dyn RunnerHost>, AgentError> {
    let installer = Arc::new(Installer::new(config.data_dir.join("builds"), client));
    let Some(vm) = &config.vm else {
        return Ok(Arc::new(LocalHost {
            runners_dir: config.data_dir.join("runners"),
            installer,
        }));
    };
    let host = VmHost::new(VmHostOptions::new(
        vm.backend.create(),
        vm.image.clone(),
        installer,
    ));
    host.check().await?;
    Ok(Arc::new(host))
}

/// The first SIGINT or SIGTERM lets running jobs finish; a second stops
/// them.
fn handle_signals(shutdown: Shutdown) -> std::io::Result<()> {
    let mut interrupt = signal(SignalKind::interrupt())?;
    let mut terminate = signal(SignalKind::terminate())?;
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = interrupt.recv() => {}
                _ = terminate.recv() => {}
            }
            if !shutdown.drain.is_cancelled() {
                info("shutting down once running jobs finish; signal again to stop them");
                shutdown.drain.cancel();
            } else if !shutdown.stop.is_cancelled() {
                info("stopping running jobs");
                shutdown.stop.cancel();
            }
        }
    });
    Ok(())
}

async fn run() -> Result<ExitCode, AgentError> {
    let cli = parse_cli(std::env::args_os().skip(1))?;
    if cli.help {
        info(USAGE);
        return Ok(ExitCode::SUCCESS);
    }
    if cli.version {
        info(VERSION);
        return Ok(ExitCode::SUCCESS);
    }
    let config_dir = cli.config_dir.unwrap_or_else(default_config_dir);

    if cli.command == Command::Doctor {
        let sections = diagnose(&config_dir, all_backends(), check_plane).await;
        info(&format_sections(&sections));
        return Ok(if healthy(&sections) {
            ExitCode::SUCCESS
        } else {
            ExitCode::FAILURE
        });
    }

    let config = load_config(&config_dir)?;
    let shutdown = Shutdown::default();
    handle_signals(shutdown.clone())?;

    let client = http_client()?;
    let plane = Plane::new(&config.plane, client.clone());
    let supervisor = Supervisor::new(create_host(&config, client).await?, Log::stdout());
    // Without readings, polls go on without metrics.
    let sampler = config.metrics_interval.and_then(|_| {
        SystemSampler::new(config.data_dir.clone())
            .inspect_err(|problem| error(problem))
            .ok()
            .map(|sampler| -> Box<dyn Sampler> { Box::new(sampler) })
    });
    run_live(
        LiveOptions {
            origin: plane.origin().to_owned(),
            poll_interval: config.plane.poll_interval,
            metrics_interval: config.metrics_interval,
        },
        &plane,
        &supervisor,
        &shutdown,
        sampler,
    )
    .await?;
    Ok(ExitCode::SUCCESS)
}

// One thread: the agent mostly waits, on the plane and on its runners.
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    match run().await {
        Ok(code) => code,
        Err(problem) => {
            error(&format!("error: {problem}"));
            if matches!(problem, AgentError::Usage(_)) {
                error(&format!("\n{USAGE}"));
                ExitCode::from(2)
            } else {
                ExitCode::FAILURE
            }
        }
    }
}
