use std::{
    ffi::OsString,
    io,
    os::unix::process::ExitStatusExt,
    process::{ExitStatus, Stdio},
};

use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, ChildStderr, ChildStdout, Command},
};
use tokio_util::sync::CancellationToken;

use super::errors::VmError;

#[derive(Debug)]
pub struct CommandResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Default)]
pub struct RunOptions<'a> {
    /// Don't fail if it exits with anything but 0.
    pub unchecked: bool,
    /// Kills it when cancelled.
    pub stop: Option<&'a CancellationToken>,
    /// Set on top of the agent's own environment.
    pub env: Vec<(String, OsString)>,
}

/// An exit code, or 128 plus the signal that killed it, as shells report it.
#[must_use]
pub fn exit_code(status: ExitStatus) -> i32 {
    status
        .code()
        .unwrap_or_else(|| 128 + status.signal().unwrap_or(0))
}

/// The output pipes of a child spawned with stdout and stderr piped.
///
/// # Errors
///
/// If they weren't piped, or were taken already.
pub fn take_output(child: &mut Child) -> io::Result<(ChildStdout, ChildStderr)> {
    let missing = || io::Error::other("the process's output isn't piped");
    Ok((
        child.stdout.take().ok_or_else(missing)?,
        child.stderr.take().ok_or_else(missing)?,
    ))
}

/// Waits for `child` to exit, killing it if `stop` is cancelled first.
///
/// # Errors
///
/// If it can't be waited for or killed.
pub async fn wait_or_kill(
    child: &mut Child,
    stop: Option<&CancellationToken>,
) -> io::Result<ExitStatus> {
    let Some(stop) = stop else {
        return child.wait().await;
    };
    tokio::select! {
        status = child.wait() => status,
        () = stop.cancelled() => {
            // It may have exited meanwhile: then there's nothing to kill.
            if let Err(error) = child.start_kill()
                && error.kind() != io::ErrorKind::InvalidInput
            {
                return Err(error);
            }
            child.wait().await
        }
    }
}

/// Everything `stream` carries until it closes, decoded lossily. A read
/// error ends it: what came before is kept.
pub async fn read_all(mut stream: impl AsyncRead + Unpin) -> String {
    let mut bytes = Vec::new();
    drop(stream.read_to_end(&mut bytes).await);
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Runs a command to completion, collecting its output.
///
/// # Errors
///
/// `VmError::Command` if it can't be started, or if it fails unless
/// `unchecked` (as it does once killed through `stop`).
pub async fn run_command(
    argv: &[String],
    options: RunOptions<'_>,
) -> Result<CommandResult, VmError> {
    let error = |exit_code, stderr: String| VmError::Command {
        argv: argv.to_vec(),
        exit_code,
        stderr,
    };
    let Some((command, arguments)) = argv.split_first() else {
        return Err(error(None, "no command to run".to_owned()));
    };
    let mut child = Command::new(command)
        .args(arguments)
        .envs(options.env.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|spawn| error(None, spawn.to_string()))?;
    let (stdout, stderr) =
        take_output(&mut child).map_err(|pipes| error(None, pipes.to_string()))?;
    let (status, stdout, stderr) = tokio::join!(
        wait_or_kill(&mut child, options.stop),
        read_all(stdout),
        read_all(stderr)
    );
    let exit_code = exit_code(status.map_err(|wait| error(None, wait.to_string()))?);
    if !options.unchecked && exit_code != 0 {
        return Err(error(Some(exit_code), stderr.trim().to_owned()));
    }
    Ok(CommandResult {
        exit_code,
        stdout,
        stderr,
    })
}

/// Compares dotted versions numerically.
#[must_use]
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let parts = |version: &str| -> Vec<u64> {
        version
            .split('.')
            .map(|part| part.parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let order = a.get(i).unwrap_or(&0).cmp(b.get(i).unwrap_or(&0));
        if order.is_ne() {
            return order;
        }
    }
    std::cmp::Ordering::Equal
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    use super::*;

    #[test]
    fn compares_versions_numerically() {
        assert_eq!(compare_versions("2.10.0", "2.3.0"), Ordering::Greater);
        assert_eq!(compare_versions("2.3", "2.3.0"), Ordering::Equal);
        assert_eq!(compare_versions("2.2.1", "2.3.0"), Ordering::Less);
    }

    #[tokio::test]
    async fn reports_failures_with_their_stderr() {
        let argv = ["sh", "-c", "echo one >&2; echo two >&2; exit 3"].map(String::from);
        let error = run_command(&argv, RunOptions::default()).await.unwrap_err();
        assert_eq!(error.to_string(), "sh -c exited with 3: one two");
        let result = run_command(
            &argv,
            RunOptions {
                unchecked: true,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(result.exit_code, 3);
        let missing = run_command(&["/nonexistent/x".to_owned()], RunOptions::default())
            .await
            .unwrap_err();
        assert!(matches!(
            missing,
            VmError::Command {
                exit_code: None,
                ..
            }
        ));
    }
}
