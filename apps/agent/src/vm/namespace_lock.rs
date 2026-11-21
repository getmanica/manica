use std::{
    collections::HashMap,
    fs::{self, DirBuilder, File, OpenOptions},
    io::{Seek, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

use nix::{
    errno::Errno,
    fcntl::{Flock, FlockArg},
};
use sha2::{Digest, Sha256};

use super::lima::canonical;
use crate::{errors::AgentError, lines::lock};

/// Where locks go: under the home directory, so every agent of this user
/// finds the same one, whatever its config or data directory.
#[must_use]
pub fn default_lock_dir() -> PathBuf {
    std::env::home_dir()
        .unwrap_or_default()
        .join(".cache")
        .join("manica")
}

/// The locks this process holds, by path: their files stay open, and
/// locked, for as long as it runs.
static HELD: LazyLock<Mutex<HashMap<PathBuf, Flock<File>>>> = LazyLock::new(Default::default);

/// The namespace's canonical name, and where its lock goes in `lock_dir`.
fn lock_path(namespace: &Path, lock_dir: &Path) -> (String, PathBuf) {
    let id = canonical(namespace).display().to_string();
    let hash: Vec<u8> = Sha256::digest(id.as_bytes()).into_iter().take(8).collect();
    let path = lock_dir.join(format!("vm-{}.lock", hex::encode(hash)));
    (id, path)
}

/// Claims a backend's namespace for this process, for as long as it runs.
///
/// An agent deletes the VMs it finds there named like its own, so two
/// sharing one would delete each other's jobs. The lock is flock(2)'s: the
/// kernel holds it for the open file and releases it when it's closed,
/// which it is when the process exits, however it does. Nothing stale is
/// ever left behind.
///
/// # Errors
///
/// `VmNamespaceInUse` if another process holds it, or if the lock can't be
/// made.
pub fn claim_namespace(namespace: &Path, lock_dir: Option<&Path>) -> Result<PathBuf, AgentError> {
    let lock_dir = lock_dir.map_or_else(default_lock_dir, Path::to_path_buf);
    let (id, path) = lock_path(namespace, &lock_dir);
    if lock(&HELD).contains_key(&path) {
        return Ok(path);
    }
    DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&lock_dir)?;
    // Opened close-on-exec (as Rust opens every file), so processes the
    // agent starts, like Lima's host agents, don't keep it locked.
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(&path)?;
    let mut claimed = match Flock::lock(file, FlockArg::LockExclusiveNonblock) {
        Ok(claimed) => claimed,
        Err((_, Errno::EWOULDBLOCK)) => {
            let holder = fs::read_to_string(&path).unwrap_or_default();
            return Err(AgentError::VmNamespaceInUse {
                namespace: id,
                pid: holder.trim().parse().ok().filter(|pid| *pid > 0),
                lock: path,
            });
        }
        Err((_, errno)) => return Err(std::io::Error::from(errno).into()),
    };
    // Who holds it, for the message another agent shows.
    claimed.set_len(0)?;
    claimed.rewind()?;
    write!(claimed, "{}", std::process::id())?;
    lock(&HELD).insert(path.clone(), claimed);
    Ok(path)
}

#[cfg(test)]
mod tests {
    use std::{
        io::Read,
        os::fd::AsRawFd,
        process::{Child, Command, Stdio},
    };

    use super::*;
    use crate::test_support::temp_dir;

    /// Another agent holding the lock at `path`, as flock(2) does: resolves
    /// once it holds it.
    fn contender(path: &Path) -> Child {
        let mut child = Command::new("perl")
            .args([
                "-e",
                r#"use Fcntl ":flock"; open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX | LOCK_NB) or die "in use"; truncate($f, 0); print $f $$; $f->flush; print "ok\n"; $| = 1; sleep 30"#,
            ])
            .arg(path)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut said = [0; 3];
        child
            .stdout
            .as_mut()
            .unwrap()
            .read_exact(&mut said)
            .unwrap();
        assert_eq!(&said, b"ok\n");
        child
    }

    /// Who holds the lock at `path`, as it says.
    fn holder_of(path: &Path) -> Option<u32> {
        fs::read_to_string(path).ok()?.trim().parse().ok()
    }

    fn path(namespace: &Path, lock_dir: &Path) -> PathBuf {
        lock_path(namespace, lock_dir).1
    }

    #[test]
    fn another_live_agent_holds_it_once_its_gone_its_free() {
        let (namespace, lock_dir) = (temp_dir(), temp_dir());
        let mut holder = contender(&path(&namespace, &lock_dir));
        let refused = claim_namespace(&namespace, Some(&lock_dir)).unwrap_err();
        assert!(matches!(refused, AgentError::VmNamespaceInUse { .. }));
        assert!(
            refused
                .to_string()
                .contains(&format!("pid {}", holder.id())),
            "{refused}"
        );
        // Killed outright: the kernel releases the lock.
        holder.kill().unwrap();
        holder.wait().unwrap();
        let path = claim_namespace(&namespace, Some(&lock_dir)).unwrap();
        assert_eq!(holder_of(&path), Some(std::process::id()));
        // Claiming again from the holder is fine.
        claim_namespace(&namespace, Some(&lock_dir)).unwrap();
    }

    #[test]
    fn processes_the_agent_starts_dont_inherit_its_claim() {
        let (namespace, lock_dir) = (temp_dir(), temp_dir());
        let path = claim_namespace(&namespace, Some(&lock_dir)).unwrap();
        let held = lock(&HELD);
        let file = &*held[&path];
        let fd = file.as_raw_fd();
        let flags = nix::fcntl::fcntl(file, nix::fcntl::FcntlArg::F_GETFD).unwrap();
        drop(held);
        assert!(
            nix::fcntl::FdFlag::from_bits_truncate(flags).contains(nix::fcntl::FdFlag::FD_CLOEXEC),
            "fd {fd} isn't close-on-exec"
        );
    }

    #[test]
    fn the_same_directory_written_differently_is_the_same_namespace() {
        let (namespace, lock_dir) = (temp_dir(), temp_dir());
        let alias = temp_dir().join("lima");
        std::os::unix::fs::symlink(&namespace, &alias).unwrap();
        let mut holder = contender(&path(&namespace, &lock_dir));
        for same in [
            PathBuf::from(format!("{}/", namespace.display())),
            PathBuf::from(format!("{}/./", namespace.display())),
            alias,
        ] {
            assert!(matches!(
                claim_namespace(&same, Some(&lock_dir)),
                Err(AgentError::VmNamespaceInUse { .. })
            ));
        }
        holder.kill().unwrap();
        holder.wait().unwrap();
    }
}
