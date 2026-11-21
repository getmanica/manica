//! The result of checking one thing the agent needs, as `doctor` prints it.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Ok,
    /// Jobs may not run as expected.
    Warn,
    /// Jobs can't run.
    Fail,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub status: Status,
    pub message: String,
    /// What to do about it, for a warning or a failure.
    pub hint: Option<String>,
}

impl Check {
    #[must_use]
    pub fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    #[must_use]
    pub fn failed(&self) -> bool {
        self.status == Status::Fail
    }
}

fn check(status: Status, message: impl Into<String>) -> Check {
    Check {
        status,
        message: message.into(),
        hint: None,
    }
}

pub fn ok(message: impl Into<String>) -> Check {
    check(Status::Ok, message)
}

pub fn warn(message: impl Into<String>) -> Check {
    check(Status::Warn, message)
}

pub fn fail(message: impl Into<String>) -> Check {
    check(Status::Fail, message)
}

#[must_use]
pub fn failed(checks: &[Check]) -> Vec<&Check> {
    checks.iter().filter(|check| check.failed()).collect()
}
