use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use futures_util::{
    FutureExt, StreamExt,
    future::{BoxFuture, Shared},
};
use sha2::{Digest, Sha256};
use tokio::{fs, io::AsyncWriteExt, process::Command};

use super::errors::{RunnerError, RunnerInstallError};
use crate::{
    api::RunnerBuild,
    lines::lock,
    temp_dir::{make_temp_dir, remove_dir},
};

const COMPLETE_MARKER: &str = ".manica-complete";

/// Where runner builds come from, installed.
#[async_trait]
pub trait Install: std::fmt::Debug + Send + Sync {
    /// The directory of the installed build, installing it first if needed.
    async fn ensure(&self, build: &RunnerBuild) -> Result<PathBuf, RunnerInstallError>;
}

type Pending = Shared<BoxFuture<'static, Result<PathBuf, RunnerInstallError>>>;

/// Downloads, verifies and extracts runner builds into `<dir>/<version>`,
/// once each.
///
/// A build is published by renaming it into place once complete,
/// so a crash midway leaves nothing half-installed. Builds are templates:
/// runners run from copies of them (see `copy_build`).
pub struct Installer {
    dir: PathBuf,
    client: reqwest::Client,
    installing: Mutex<HashMap<String, Pending>>,
}

impl std::fmt::Debug for Installer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Installer")
            .field("dir", &self.dir)
            .finish_non_exhaustive()
    }
}

impl Installer {
    #[must_use]
    pub fn new(dir: PathBuf, client: reqwest::Client) -> Self {
        Self {
            dir,
            client,
            installing: Mutex::default(),
        }
    }
}

#[async_trait]
impl Install for Installer {
    /// Concurrent calls for a build share one install.
    async fn ensure(&self, build: &RunnerBuild) -> Result<PathBuf, RunnerInstallError> {
        let pending = lock(&self.installing)
            .entry(build.version.clone())
            .or_insert_with(|| {
                install(self.dir.clone(), self.client.clone(), build.clone())
                    .boxed()
                    .shared()
            })
            .clone();
        let result = pending.clone().await;
        // Once per install: a waiter resuming late mustn't drop a retry
        // started meanwhile, or the next call would install the build again
        // alongside it.
        let mut installing = lock(&self.installing);
        if installing
            .get(&build.version)
            .is_some_and(|current| current.ptr_eq(&pending))
        {
            installing.remove(&build.version);
        }
        drop(installing);
        result
    }
}

fn install_error(build: &RunnerBuild, reason: impl Into<String>) -> RunnerInstallError {
    RunnerInstallError {
        version: build.version.clone(),
        reason: reason.into(),
        archive: None,
    }
}

async fn install(
    dir: PathBuf,
    client: reqwest::Client,
    build: RunnerBuild,
) -> Result<PathBuf, RunnerInstallError> {
    let target = dir.join(&build.version);
    if fs::try_exists(target.join(COMPLETE_MARKER))
        .await
        .unwrap_or(false)
    {
        return Ok(target);
    }
    let io = |error: std::io::Error| install_error(&build, error.to_string());
    fs::create_dir_all(&dir).await.map_err(io)?;
    let scratch = make_temp_dir(&dir, &format!(".{}-", build.version)).map_err(io)?;
    let archive = scratch.join("runner.tar.gz");
    // The last failed download of this version, kept to look into.
    let failed = dir.join(format!("{}.failed.tar.gz", build.version));
    let result = download_and_extract(&client, &build, &archive, &scratch, &target).await;
    let result = match result {
        Ok(()) => {
            // An old failed download left behind is only a file to look into.
            drop(fs::remove_file(&failed).await);
            Ok(target)
        }
        Err(reason) if fs::try_exists(&archive).await.unwrap_or(false) => {
            let kept = fs::rename(&archive, &failed).await.is_ok();
            Err(RunnerInstallError {
                archive: kept.then_some(failed),
                ..install_error(&build, reason)
            })
        }
        Err(reason) => Err(install_error(&build, reason)),
    };
    // A scratch directory left behind is dot-named, and harmless.
    drop(remove_dir(&scratch).await);
    result
}

async fn download_and_extract(
    client: &reqwest::Client,
    build: &RunnerBuild,
    archive: &Path,
    scratch: &Path,
    target: &Path,
) -> Result<(), String> {
    let response = client
        .get(&build.url)
        .send()
        .await
        .map_err(|error| crate::plane::describe(&error))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let mut file = fs::File::create(archive)
        .await
        .map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = chunk.map_err(|error| crate::plane::describe(&error))?;
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    let actual = hex::encode(hasher.finalize());
    if actual != build.sha256 {
        return Err(format!(
            "checksum mismatch: expected {}, got {actual}",
            build.sha256
        ));
    }

    // tar keeps execute bits and symlinks, and confines entries to
    // `extracted`.
    let extracted = scratch.join("build");
    let (from, to) = (archive.to_path_buf(), extracted.clone());
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        let mut tarball =
            tar::Archive::new(flate2::read::GzDecoder::new(std::fs::File::open(from)?));
        // Modes without setuid, setgid or sticky bits (not preserving drops
        // them), and without group or other write: no one else may change
        // the build after its checksum was checked.
        tarball.set_preserve_permissions(false);
        tarball.set_mask(0o022);
        tarball.unpack(to)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| format!("extracting failed: {error}"))?;
    // Made new, so a marker the archive brought (a symlink, say) fails the
    // install rather than being written through.
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(extracted.join(COMPLETE_MARKER))
        .await
        .map_err(|error| format!("marking the build complete failed: {error}"))?;
    // Clears what an interrupted install may have left.
    remove_dir(target)
        .await
        .map_err(|error| error.to_string())?;
    fs::rename(&extracted, target)
        .await
        .map_err(|error| error.to_string())
}

/// Copies a build for one runner.
///
/// A runner writes its identity and credentials next to its binaries, so
/// runners can't share one. Copies are cheap clones where the filesystem
/// supports them (APFS, btrfs, XFS).
///
/// # Errors
///
/// If it can't be copied.
pub async fn copy_build(build: &Path, target: &Path) -> Result<(), RunnerError> {
    let clone: &[&str] = if cfg!(target_os = "macos") {
        &["-cR"]
    } else {
        &["-R", "--reflink=auto"]
    };
    let cloned = Command::new("cp")
        .args(clone)
        .arg(build)
        .arg(target)
        .stderr(std::process::Stdio::null())
        .status()
        .await?;
    if cloned.success() {
        return Ok(());
    }
    remove_dir(target).await?;
    let copied = Command::new("cp")
        .arg("-R")
        .arg(build)
        .arg(target)
        .output()
        .await?;
    if !copied.status.success() {
        return Err(RunnerError::Copy {
            build: build.to_path_buf(),
            reason: String::from_utf8_lossy(&copied.stderr).trim().to_owned(),
        });
    }
    Ok(())
}

/// An installer that always has `dir`, for tests and stand-in builds.
#[derive(Debug)]
pub struct Fixed(pub Result<PathBuf, RunnerInstallError>);

#[async_trait]
impl Install for Fixed {
    async fn ensure(&self, _: &RunnerBuild) -> Result<PathBuf, RunnerInstallError> {
        self.0.clone()
    }
}

impl Fixed {
    pub fn dir(dir: impl Into<PathBuf>) -> Arc<dyn Install> {
        Arc::new(Self(Ok(dir.into())))
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;
    use crate::test_support::{Server, create_build, temp_dir};

    struct Release {
        server: Server,
        bytes: Vec<u8>,
        sha256: String,
    }

    /// A tarball of the stand-in build, served like a release asset.
    async fn release() -> Release {
        let build = create_build(&[]);
        let tarball = temp_dir().join("runner.tar.gz");
        let status = std::process::Command::new("tar")
            .arg("-czf")
            .arg(&tarball)
            .arg("-C")
            .arg(&build)
            .arg(".")
            .status()
            .unwrap();
        assert!(status.success());
        let bytes = std::fs::read(&tarball).unwrap();
        let sha256 = hex::encode(Sha256::digest(&bytes));
        Release {
            server: Server::start(bytes.clone()).await,
            bytes,
            sha256,
        }
    }

    impl Release {
        fn build(&self, version: &str, sha256: Option<&str>) -> RunnerBuild {
            RunnerBuild {
                version: version.into(),
                url: self.server.url("runner.tar.gz"),
                sha256: sha256.unwrap_or(&self.sha256).into(),
            }
        }
    }

    fn installer(dir: &Path) -> Installer {
        Installer::new(dir.to_path_buf(), reqwest::Client::new())
    }

    #[tokio::test]
    async fn downloads_verifies_and_extracts_a_build_once() {
        let release = release().await;
        let installer = installer(&temp_dir());
        let build = release.build("1.0.0", None);
        let (dir, again) = tokio::join!(installer.ensure(&build), installer.ensure(&build));
        let (dir, again) = (dir.unwrap(), again.unwrap());
        assert_eq!(dir, again);
        let run_sh = dir.join("run.sh");
        assert!(run_sh.exists(), "run.sh was extracted");
        assert_ne!(
            run_sh.metadata().unwrap().permissions().mode() & 0o111,
            0,
            "run.sh stays executable"
        );
        installer.ensure(&build).await.unwrap();
        assert_eq!(release.server.requests(), 1);
    }

    #[tokio::test]
    async fn a_late_waiter_doesnt_drop_a_retry_in_progress() {
        let release = release().await;
        let installer = installer(&temp_dir());
        let bad = release.build("1.0.0", Some(&"0".repeat(64)));
        let good = release.build("1.0.0", None);
        let failed = tokio::sync::Notify::new();
        let late = tokio::sync::Notify::new();
        // Polled in this order on each wake: `first` sees the failed install
        // first, `retry` starts a new one, `second` (waiting on the failed
        // one too) resumes after it, then `again` asks for the build.
        let first = async {
            let result = installer.ensure(&bad).await;
            failed.notify_one();
            result
        };
        let retry = async {
            failed.notified().await;
            installer.ensure(&good).await
        };
        let second = async {
            let result = installer.ensure(&bad).await;
            late.notify_one();
            result
        };
        let again = async {
            late.notified().await;
            installer.ensure(&good).await
        };
        let (first, retry, second, again) =
            futures_util::future::join4(first, retry, second, again).await;
        assert!(first.is_err() && second.is_err(), "the bad build fails");
        assert_eq!(retry.unwrap(), again.unwrap(), "both get the build");
        assert_eq!(
            release.server.requests(),
            2,
            "the retry was shared, not installed twice"
        );
    }

    #[tokio::test]
    async fn keeps_installed_builds_across_agents() {
        let release = release().await;
        let dir = temp_dir();
        installer(&dir)
            .ensure(&release.build("1.0.0", None))
            .await
            .unwrap();
        installer(&dir)
            .ensure(&release.build("1.0.0", None))
            .await
            .unwrap();
        assert_eq!(release.server.requests(), 1);
    }

    #[tokio::test]
    async fn rejects_a_build_whose_checksum_doesnt_match() {
        let release = release().await;
        let dir = temp_dir();
        let error = installer(&dir)
            .ensure(&release.build("1.0.0", Some(&"0".repeat(64))))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("checksum mismatch"), "{error}");
        assert!(!dir.join("1.0.0").join("run.sh").exists());
        assert_eq!(
            std::fs::read(dir.join("1.0.0.failed.tar.gz")).unwrap(),
            release.bytes
        );
    }

    #[tokio::test]
    async fn drops_the_kept_archive_once_a_build_installs() {
        let release = release().await;
        let dir = temp_dir();
        let installer = installer(&dir);
        let failed = installer
            .ensure(&release.build("1.0.0", Some(&"0".repeat(64))))
            .await;
        assert!(failed.is_err(), "the bad build doesn't install");
        installer
            .ensure(&release.build("1.0.0", None))
            .await
            .unwrap();
        assert!(!dir.join("1.0.0.failed.tar.gz").exists());
    }

    #[tokio::test]
    async fn never_writes_through_a_marker_the_archive_brings() {
        let sentinel = temp_dir().join("sentinel");
        std::fs::write(&sentinel, "keep").unwrap();
        let build = create_build(&[]);
        std::os::unix::fs::symlink(&sentinel, build.join(COMPLETE_MARKER)).unwrap();
        let tarball = temp_dir().join("runner.tar.gz");
        let status = std::process::Command::new("tar")
            .arg("-czf")
            .arg(&tarball)
            .arg("-C")
            .arg(&build)
            .arg(".")
            .status()
            .unwrap();
        assert!(status.success(), "the tarball was made");
        let bytes = std::fs::read(&tarball).unwrap();
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let server = Server::start(bytes).await;
        let result = installer(&temp_dir())
            .ensure(&RunnerBuild {
                version: "1.0.0".into(),
                url: server.url("runner.tar.gz"),
                sha256,
            })
            .await;
        assert!(result.is_err(), "the install fails: {result:?}");
        assert_eq!(
            std::fs::read_to_string(&sentinel).unwrap(),
            "keep",
            "the file the symlink points at is untouched"
        );
    }

    #[tokio::test]
    async fn extracts_without_setuid_or_write_for_others() {
        let build = create_build(&[]);
        let modes = [("open", 0o777), ("setuid", 0o4755)];
        for (name, mode) in modes {
            let path = build.join(name);
            std::fs::write(&path, "").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
        }
        let tarball = temp_dir().join("runner.tar.gz");
        let status = std::process::Command::new("tar")
            .arg("-czf")
            .arg(&tarball)
            .arg("-C")
            .arg(&build)
            .arg(".")
            .status()
            .unwrap();
        assert!(status.success(), "the tarball was made");
        let bytes = std::fs::read(&tarball).unwrap();
        let sha256 = hex::encode(Sha256::digest(&bytes));
        let server = Server::start(bytes).await;
        let dir = installer(&temp_dir())
            .ensure(&RunnerBuild {
                version: "1.0.0".into(),
                url: server.url("runner.tar.gz"),
                sha256,
            })
            .await
            .unwrap();
        for (name, _) in modes {
            let mode = dir.join(name).metadata().unwrap().permissions().mode() & 0o7777;
            assert_eq!(mode, 0o755, "{name} is {mode:o}");
        }
    }

    #[tokio::test]
    async fn rejects_a_build_that_isnt_a_tarball() {
        let garbage = Server::start(b"not a tarball".to_vec()).await;
        let dir = temp_dir();
        let error = installer(&dir)
            .ensure(&RunnerBuild {
                version: "1.0.0".into(),
                url: garbage.url("runner.tar.gz"),
                sha256: hex::encode(Sha256::digest(b"not a tarball")),
            })
            .await
            .unwrap_err();
        assert!(error.to_string().contains("extracting failed"), "{error}");
        assert!(!dir.join("1.0.0").join("run.sh").exists());
        assert_eq!(
            std::fs::read_to_string(dir.join("1.0.0.failed.tar.gz")).unwrap(),
            "not a tarball"
        );
    }
}
