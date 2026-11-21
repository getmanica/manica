use std::{ffi::OsString, path::PathBuf};

use crate::errors::AgentError;

pub const USAGE: &str = "Usage: manica-agent [command] [options]

Runs the Manica agent: picks up CI jobs from the plane and runs them, until
interrupted (once to let running jobs finish, twice to stop them).

Commands:
  doctor                  Check the config, the plane, and which VM backends
                          this machine can run jobs with, then exit

Options:
  -c, --config-dir <dir>  Directory holding config.toml
                          (default: $XDG_CONFIG_HOME/manica)
  -h, --help              Show this help
  -v, --version           Show the version";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// Run the agent, until interrupted.
    Run,
    Doctor,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Cli {
    pub command: Command,
    pub help: bool,
    pub version: bool,
    pub config_dir: Option<PathBuf>,
}

fn usage(message: impl Into<String>) -> AgentError {
    AgentError::Usage(message.into())
}

/// Parses the arguments, without the program name.
///
/// # Errors
///
/// `AgentError::Usage` if they aren't ones the agent takes.
pub fn parse_cli(args: impl IntoIterator<Item = impl Into<OsString>>) -> Result<Cli, AgentError> {
    use lexopt::prelude::*;

    let mut parser = lexopt::Parser::from_args(args);
    let mut cli = Cli {
        command: Command::Run,
        help: false,
        version: false,
        config_dir: None,
    };
    let mut positionals = Vec::new();
    while let Some(arg) = parser.next().map_err(|error| usage(error.to_string()))? {
        match arg {
            Short('c') | Long("config-dir") => {
                let dir = parser.value().map_err(|error| usage(error.to_string()))?;
                if dir.is_empty() {
                    return Err(usage("--config-dir needs a directory"));
                }
                cli.config_dir = Some(dir.into());
            }
            Short('h') | Long("help") => cli.help = true,
            Short('v') | Long("version") => cli.version = true,
            Value(value) => positionals.push(value.to_string_lossy().into_owned()),
            Short(option) => return Err(usage(format!("Unknown option: -{option}"))),
            Long(option) => return Err(usage(format!("Unknown option: --{option}"))),
        }
    }
    let mut positionals = positionals.into_iter();
    if let Some(command) = positionals.next() {
        cli.command = match command.as_str() {
            "doctor" => Command::Doctor,
            _ => return Err(usage(format!("Unknown command: {command}"))),
        };
    }
    if let Some(extra) = positionals.next() {
        return Err(usage(format!("Unexpected argument: {extra}")));
    }
    Ok(cli)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_the_agent_by_default() {
        let cli = parse_cli(["-c", "/etc/manica"]).unwrap();
        assert_eq!(cli.command, Command::Run);
        assert_eq!(cli.config_dir, Some(PathBuf::from("/etc/manica")));
    }

    #[test]
    fn takes_the_doctor_command_with_options() {
        let cli = parse_cli(["doctor", "--config-dir", "/etc/manica"]).unwrap();
        assert_eq!(cli.command, Command::Doctor);
        assert_eq!(cli.config_dir, Some(PathBuf::from("/etc/manica")));
        let cli = parse_cli(["--config-dir=/etc/manica", "-h"]).unwrap();
        assert!(cli.help);
        assert_eq!(cli.config_dir, Some(PathBuf::from("/etc/manica")));
    }

    #[test]
    fn rejects_unknown_commands_options_and_extra_arguments() {
        let message = |args: &[&str]| parse_cli(args.iter().copied()).unwrap_err().to_string();
        assert_eq!(message(&["docter"]), "Unknown command: docter");
        assert_eq!(message(&["doctor", "now"]), "Unexpected argument: now");
        assert_eq!(message(&["--verbose"]), "Unknown option: --verbose");
        assert_eq!(
            message(&["--config-dir="]),
            "--config-dir needs a directory"
        );
        assert!(matches!(parse_cli(["-c"]), Err(AgentError::Usage(_))));
    }
}
