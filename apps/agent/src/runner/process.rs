use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use nix::{
    sys::signal::{Signal, killpg},
    unistd::Pid,
};
use tokio::{fs, process::Command, sync::watch};

use crate::{
    lines::{Log, forward_lines, info},
    vm::command::{exit_code, take_output},
};

const PID_FILE: &str = ".manica-pid";

/// How long a runner gets to stop on SIGTERM before it's killed.
pub const STOP_GRACE: Duration = Duration::from_secs(10);

/// A runner process, leading a process group of its own.
#[derive(Debug)]
pub struct RunnerProcess {
    pub pid: i32,
    exited: watch::Receiver<Option<i32>>,
}

impl RunnerProcess {
    /// Its exit code, once it exited (128 plus the signal, if one killed it).
    pub async fn wait(&self) -> i32 {
        let mut exited = self.exited.clone();
        // Its task sends the code before it ends: a channel closed without
        // one would mean it never could, read as a failure.
        exited
            .wait_for(Option::is_some)
            .await
            .ok()
            .and_then(|code| *code)
            .unwrap_or(1)
    }
}

/// Starts the runner in `dir`, as the leader of a process group of its own.
///
/// Stopping it then reaches everything it started (the listener, the
/// worker, the job's steps). The config goes in through the environment,
/// which the runner reads then clears, rather than the command line, which
/// other users can see.
///
/// # Errors
///
/// If it can't be started, or tracked.
pub async fn spawn_runner(dir: &Path, config: &str, output: Log) -> std::io::Result<RunnerProcess> {
    let mut child = Command::new(dir.join("run.sh"))
        .current_dir(dir)
        .env("ACTIONS_RUNNER_INPUT_JITCONFIG", config)
        // Exit with 7, instead of retrying, on a runner version GitHub
        // deprecated.
        .env("ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;
    let pid = child
        .id()
        .and_then(|id| i32::try_from(id).ok())
        .ok_or_else(|| std::io::Error::other("the runner exited before it could be tracked"))?;
    // Recorded so a later agent can stop it if this one dies first.
    fs::write(dir.join(PID_FILE), pid.to_string()).await?;
    let (stdout, stderr) = take_output(&mut child)?;
    tokio::spawn(forward_lines(stdout, output.clone()));
    tokio::spawn(forward_lines(stderr, output));
    let (tx, exited) = watch::channel(None);
    tokio::spawn(async move {
        let code = child.wait().await.map_or(1, exit_code);
        tx.send_replace(Some(code));
    });
    Ok(RunnerProcess { pid, exited })
}

/// Signals the process group `pgid`: whether it was still there.
fn signal_group(pgid: i32, signal: Signal) -> bool {
    killpg(Pid::from_raw(pgid), signal).is_ok()
}

/// Stops a runner's process group: SIGTERM, then SIGKILL if it's still
/// there after `grace`.
pub async fn stop_runner(runner: &RunnerProcess, grace: Duration) {
    signal_group(runner.pid, Signal::SIGTERM);
    if tokio::time::timeout(grace, runner.wait()).await.is_err() {
        signal_group(runner.pid, Signal::SIGKILL);
        runner.wait().await;
    }
    // What the runner started may outlive it.
    signal_group(runner.pid, Signal::SIGKILL);
}

/// Whether the process group `pgid` still runs something from `dir`, rather
/// than the pid having been recycled. Its leader may be gone while what it
/// started still runs.
async fn group_runs_from(pgid: i32, dir: &Path) -> bool {
    let Ok(ps) = Command::new("ps")
        .args(["-A", "-o", "pgid=,command="])
        .stderr(Stdio::null())
        .output()
        .await
    else {
        return false;
    };
    let dir = dir.display().to_string();
    String::from_utf8_lossy(&ps.stdout).lines().any(|line| {
        let mut words = line.split_whitespace();
        words.next().and_then(|group| group.parse::<i32>().ok()) == Some(pgid)
            && words.collect::<Vec<_>>().join(" ").contains(&dir)
    })
}

/// Kills the runners a previous agent left behind (it crashed, or was
/// killed), and removes their directories: the plane gave up on them.
/// Anything else in there (a `.DS_Store`) goes too.
///
/// # Errors
///
/// If a directory can't be read or removed.
pub async fn clear_stale_runners(runners_dir: &Path) -> std::io::Result<()> {
    let Ok(mut entries) = fs::read_dir(runners_dir).await else {
        return Ok(());
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    while let Some(entry) = entries.next_entry().await? {
        dirs.push(entry.path());
    }
    for dir in dirs {
        let is_dir = fs::symlink_metadata(&dir)
            .await
            .is_ok_and(|metadata| metadata.is_dir());
        if !is_dir {
            match fs::remove_file(&dir).await {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
                _ => continue,
            }
        }
        if let Ok(pid) = fs::read_to_string(dir.join(PID_FILE)).await
            && let Ok(pid) = pid.trim().parse::<i32>()
            && pid > 0
            && group_runs_from(pid, &dir).await
        {
            info(&format!("stopping runner left over in {}", dir.display()));
            signal_group(pid, Signal::SIGKILL);
        }
        match fs::remove_dir_all(&dir).await {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_dir;

    #[tokio::test]
    async fn clears_whatever_else_is_in_the_runners_directory() {
        let runners_dir = temp_dir();
        std::fs::write(runners_dir.join(".DS_Store"), "").unwrap();
        std::fs::create_dir(runners_dir.join("r1")).unwrap();
        std::os::unix::fs::symlink("/nonexistent", runners_dir.join("link")).unwrap();
        clear_stale_runners(&runners_dir).await.unwrap();
        assert_eq!(
            std::fs::read_dir(&runners_dir).unwrap().count(),
            0,
            "everything was removed"
        );
    }
}
