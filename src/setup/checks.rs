//! Pure setup checks: gathered machine facts in, complete user-facing findings out.

use std::ffi::OsString;
#[cfg(target_os = "linux")]
use std::path::Path;
use std::path::PathBuf;

use crate::config::{self, ConfigError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Level {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Finding {
    pub level: Level,
    pub message: String,
}

#[derive(Debug, Clone)]
pub(crate) struct Facts {
    pub is_root: bool,
    pub default_config: bool,
    pub binary: BinaryFacts,
    pub directories: Vec<DirectoryMismatch>,
    pub tmux_tmpdir_without_socket: bool,
    pub tmux_on_service_path: Option<PathBuf>,
    pub tmux_on_setup_path: Option<PathBuf>,
    pub tailscale: TailnetFacts,
    pub platform: PlatformFacts,
}

#[derive(Debug, Clone)]
pub(crate) struct BinaryFacts {
    pub current_canonical: PathBuf,
    pub installed_canonical: Option<PathBuf>,
    pub cargo_home_other: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirectoryMismatch {
    pub variable: String,
    pub value: Option<String>,
    pub setup_directory: PathBuf,
    pub service_directory: PathBuf,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct DirectoryEnvironment {
    pub home: Option<OsString>,
    pub config_home: Option<OsString>,
    pub state_home: Option<OsString>,
}

#[derive(Debug, Clone)]
pub(crate) enum TailnetFacts {
    Unreachable {
        failure: LocalApiFailure,
        detail: String,
    },
    Status {
        version: String,
        backend_state: String,
        dns_name: Option<String>,
        cert_domains: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalApiFailure {
    NoSocket,
    MacAdmin,
    Other,
}

#[derive(Debug, Clone)]
pub(crate) enum PlatformFacts {
    #[cfg(target_os = "linux")]
    Linux {
        username: String,
        systemd_present: bool,
        user_manager_present: bool,
        systemd_version: Option<Result<u32, String>>,
        missing_controllers: Vec<String>,
        operator_user: Result<String, String>,
    },
    #[cfg(target_os = "macos")]
    Mac {
        other_account: Option<String>,
        gui_session: bool,
        installed_port: Result<Option<u16>, String>,
        port_available: bool,
    },
}

const BACKGROUND_SETUP: &str = "muxen setup --background";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Tailnet {
    pub dns_name: String,
    pub version: String,
    pub operator_needed: bool,
}

impl PlatformFacts {
    fn is_mac(&self) -> bool {
        cfg!(target_os = "macos")
    }

    fn operator_needed(&self) -> bool {
        match self {
            #[cfg(target_os = "linux")]
            Self::Linux { operator_user, .. } => operator_user
                .as_ref()
                .is_ok_and(|operator| operator.is_empty()),
            #[cfg(target_os = "macos")]
            Self::Mac { .. } => false,
        }
    }
}

pub(crate) fn directory_mismatches(
    setup: &DirectoryEnvironment,
    service: &DirectoryEnvironment,
) -> Result<Vec<DirectoryMismatch>, ConfigError> {
    let service_home = service.home.as_ref().or(setup.home.as_ref());
    let mut mismatches = Vec::new();
    for (variable, fallback, setup_value, service_value) in [
        (
            "XDG_CONFIG_HOME",
            ".config",
            setup.config_home.as_ref(),
            service.config_home.as_ref(),
        ),
        (
            "XDG_STATE_HOME",
            ".local/state",
            setup.state_home.as_ref(),
            service.state_home.as_ref(),
        ),
    ] {
        let setup_directory = config::xdg_from(
            variable,
            setup_value.map(OsString::as_os_str),
            setup.home.as_deref(),
            fallback,
        )?
        .join("muxen");
        let service_directory = config::xdg_from(
            variable,
            service_value.map(OsString::as_os_str),
            service_home.map(OsString::as_os_str),
            fallback,
        )?
        .join("muxen");
        if setup_directory != service_directory {
            mismatches.push(DirectoryMismatch {
                variable: variable.to_owned(),
                value: setup_value.map(|value| value.to_string_lossy().into_owned()),
                setup_directory,
                service_directory,
            });
        }
    }
    Ok(mismatches)
}

pub(crate) fn evaluate(
    facts: &Facts,
    warnings: &mut Vec<Finding>,
) -> Result<Tailnet, Vec<Finding>> {
    let mut findings = Vec::new();
    if facts.is_root {
        error(
            &mut findings,
            "Run muxen setup as the user whose tmux muxen serves, not as root.",
        );
    }
    if !facts.default_config {
        error(
            &mut findings,
            "muxen setup --background installs a service that reads the default config path; drop --config.",
        );
    }
    if facts.binary.installed_canonical.as_ref() != Some(&facts.binary.current_canonical) {
        let message = if facts.binary.installed_canonical.is_none() {
            "~/.cargo/bin/muxen doesn't exist.".to_owned()
        } else {
            format!(
                "The service runs ~/.cargo/bin/muxen, but this is {}.",
                facts.binary.current_canonical.display()
            )
        };
        let mut message = format!(
            "{message} Install it with `cargo install --path .`, then run `~/.cargo/bin/muxen setup --background`."
        );
        if facts.binary.cargo_home_other {
            message.push_str(
                " cargo installs into $CARGO_HOME/bin; use [Manual setup](../running.md#manual-setup).",
            );
        }
        error(&mut findings, message);
    }
    for mismatch in &facts.directories {
        let context = match mismatch.value.as_deref() {
            Some(value) => format!("Your shell sets {}={value}, so", mismatch.variable),
            None => format!("Your shell leaves {} unset, so", mismatch.variable),
        };
        let fix = match (&facts.platform, mismatch.value.as_deref()) {
            #[cfg(target_os = "linux")]
            (PlatformFacts::Linux { .. }, Some(value)) => format!(
                "Unset it, or give the user manager the same value with `systemctl --user set-environment {}={value}`.",
                mismatch.variable
            ),
            #[cfg(target_os = "linux")]
            (PlatformFacts::Linux { .. }, None) => format!(
                "Unset it in the user manager with `systemctl --user unset-environment {}`.",
                mismatch.variable
            ),
            #[cfg(target_os = "macos")]
            (PlatformFacts::Mac { .. }, _) => {
                "Unset it before running muxen setup --background.".to_owned()
            }
        };
        error(
            &mut findings,
            format!(
                "{context} muxen setup would use {} while the service uses {}: it would read another config and another device list. {fix}",
                mismatch.setup_directory.display(),
                mismatch.service_directory.display()
            ),
        );
    }
    if facts.tmux_tmpdir_without_socket {
        warning(
            &mut findings,
            "Your shell sets TMUX_TMPDIR; the service won't see it. Set `[tmux] socket_path` in config.toml.",
        );
    }
    if facts.tmux_on_service_path.is_none() {
        match &facts.tmux_on_setup_path {
            Some(path) => error(
                &mut findings,
                format!(
                    "tmux is at {}, which the service's PATH doesn't reach. Set `[tmux] program = \"{}\"` in config.toml.",
                    path.display(),
                    path.display()
                ),
            ),
            None => error(
                &mut findings,
                "tmux isn't installed (no `tmux` on the service's PATH).",
            ),
        }
    }
    check_tailscale(
        facts.platform.is_mac(),
        &facts.tailscale,
        BACKGROUND_SETUP,
        &mut findings,
    );
    match &facts.platform {
        #[cfg(target_os = "linux")]
        PlatformFacts::Linux {
            username,
            systemd_present,
            user_manager_present,
            systemd_version,
            missing_controllers,
            operator_user,
        } => {
            if !systemd_present {
                error(
                    &mut findings,
                    "This Linux doesn't run systemd; muxen setup supports systemd only. Follow Manual setup in docs/running.md.",
                );
            }
            if !user_manager_present {
                error(
                    &mut findings,
                    format!(
                        "No systemd user manager is running for {username}. Log in as {username} directly (SSH or a console, not su or sudo), then rerun `{BACKGROUND_SETUP}`."
                    ),
                );
            }
            if *systemd_present {
                match systemd_version {
                    Some(Ok(version)) if *version < 254 => warning(
                        &mut findings,
                        format!(
                            "systemd {version} ignores the unit's restart backoff; muxen restarts every 2 s instead, which still works."
                        ),
                    ),
                    Some(Err(cause)) => error(
                        &mut findings,
                        format!("Can't read the systemd version: {cause}."),
                    ),
                    None => error(
                        &mut findings,
                        "Can't read the systemd version: no version fact was gathered.",
                    ),
                    _ => {}
                }
            }
            for controller in missing_controllers {
                warning(
                    &mut findings,
                    format!(
                        "The user manager hasn't been delegated the {controller} controller, so the unit's CPUQuota and MemoryMax aren't enforced."
                    ),
                );
            }
            if matches!(facts.tailscale, TailnetFacts::Status { .. }) {
                check_operator(operator_user, username, BACKGROUND_SETUP, &mut findings);
            }
        }
        #[cfg(target_os = "macos")]
        PlatformFacts::Mac {
            other_account,
            gui_session,
            installed_port,
            port_available,
        } => {
            if let Some(name) = other_account {
                error(
                    &mut findings,
                    format!(
                        "This Mac has another login account ({name}). muxen's Mac defences assume yours is the only one, so setup won't install it here."
                    ),
                );
            }
            if !gui_session {
                error(
                    &mut findings,
                    "You aren't logged in at this Mac's screen. Log in there first: muxen runs only while you're logged in.",
                );
            }
            match installed_port {
                Ok(Some(port)) if *port != 7851 => error(
                    &mut findings,
                    format!(
                        "muxen was installed by hand on port {port}. Keep that install (Manual setup), or run `muxen teardown` and then `muxen setup --background`, which uses 7851."
                    ),
                ),
                Err(cause) => error(
                    &mut findings,
                    format!("Can't read the installed LaunchAgent's socket port: {cause}."),
                ),
                _ => {}
            }
            if !port_available {
                error(
                    &mut findings,
                    "Another process holds 127.0.0.1:7851 (`lsof -nP -iTCP:7851`). Stop it, or install by hand with another port (Manual setup in docs/running.md).",
                );
            }
        }
    }
    finish(
        facts.tailscale.clone(),
        facts.platform.operator_needed(),
        findings,
        warnings,
    )
}

fn finish(
    tailscale: TailnetFacts,
    operator_needed: bool,
    findings: Vec<Finding>,
    warnings: &mut Vec<Finding>,
) -> Result<Tailnet, Vec<Finding>> {
    warnings.extend(
        findings
            .iter()
            .filter(|finding| finding.level == Level::Warning)
            .cloned(),
    );
    let errors = findings
        .into_iter()
        .filter(|finding| finding.level == Level::Error)
        .collect::<Vec<_>>();
    if !errors.is_empty() {
        return Err(errors);
    }
    validated_tailnet(&tailscale, operator_needed).ok_or_else(|| {
        vec![Finding {
            level: Level::Error,
            message: "Tailscale didn't provide a usable tailnet status.".to_owned(),
        }]
    })
}

fn validated_tailnet(tailscale: &TailnetFacts, operator_needed: bool) -> Option<Tailnet> {
    let TailnetFacts::Status {
        version,
        backend_state,
        dns_name,
        ..
    } = tailscale
    else {
        return None;
    };
    if backend_state != "Running" {
        return None;
    }
    let dns_name = dns_name.as_ref()?.trim_end_matches('.');
    if dns_name.is_empty() {
        return None;
    }
    let (major, minor) = parse_major_minor(version)?;
    Some(Tailnet {
        dns_name: dns_name.to_owned(),
        version: format!("{major}.{minor}"),
        operator_needed,
    })
}

#[cfg(target_os = "linux")]
pub(crate) struct ForegroundFacts<'a> {
    pub is_root: bool,
    pub username: &'a str,
    pub program: &'a Path,
    pub tmux_on_setup_path: Option<&'a Path>,
    pub runtime_dir: Option<&'a Path>,
    pub uid: u32,
    pub tailscale: &'a TailnetFacts,
    pub operator_user: &'a Result<String, String>,
}

#[cfg(target_os = "linux")]
pub(crate) fn evaluate_foreground(
    facts: &ForegroundFacts<'_>,
    warnings: &mut Vec<Finding>,
) -> Result<Tailnet, Vec<Finding>> {
    let mut findings = Vec::new();
    let expected_runtime_dir = PathBuf::from(format!("/run/user/{}/muxen", facts.uid));
    if facts.is_root {
        error(
            &mut findings,
            "Run muxen setup as the user whose tmux muxen serves, not as root.",
        );
    }
    if facts.runtime_dir.map(Path::as_os_str) != Some(expected_runtime_dir.as_os_str()) {
        let expected = format!("/run/user/{}", facts.uid);
        let actual = facts.runtime_dir.map_or_else(
            || "unset or invalid".to_owned(),
            |path| path.display().to_string(),
        );
        error(
            &mut findings,
            format!(
                "Plain muxen setup requires config::runtime_dir()={expected}/muxen (XDG_RUNTIME_DIR={expected}); got config::runtime_dir()={actual}."
            ),
        );
    }
    if facts.tmux_on_setup_path.is_none() {
        error(
            &mut findings,
            format!(
                "tmux isn't available at {} on this shell's PATH. Install tmux or set `[tmux] program` to its executable path.",
                facts.program.display()
            ),
        );
    }
    check_tailscale(false, facts.tailscale, "muxen setup", &mut findings);
    if matches!(facts.tailscale, TailnetFacts::Status { .. }) {
        check_operator(
            facts.operator_user,
            facts.username,
            "muxen setup",
            &mut findings,
        );
    }
    let operator_needed = facts
        .operator_user
        .as_ref()
        .is_ok_and(|operator| operator.is_empty());
    finish(facts.tailscale.clone(), operator_needed, findings, warnings)
}

fn check_tailscale(
    is_mac: bool,
    tailscale: &TailnetFacts,
    setup_command: &str,
    findings: &mut Vec<Finding>,
) {
    if is_mac {
        if let TailnetFacts::Unreachable { failure, .. } = tailscale {
            match failure {
                LocalApiFailure::MacAdmin => error(
                    findings,
                    "Your account must be an admin: muxen reads Tailscale's LocalAPI token from /Library/Tailscale.",
                ),
                _ => error(
                    findings,
                    "Can't reach the Tailscale app. Install the standalone app from tailscale.com (1.104 or later), open it and sign in.",
                ),
            }
            return;
        }
        check_status(is_mac, tailscale, setup_command, findings);
        return;
    }
    match tailscale {
        TailnetFacts::Unreachable { failure, detail } => match failure {
            LocalApiFailure::NoSocket => error(
                findings,
                "tailscaled isn't running: no LocalAPI socket at /var/run/tailscale/tailscaled.sock. Install Tailscale (https://tailscale.com/download/linux), then `sudo systemctl enable --now tailscaled`.",
            ),
            _ => error(
                findings,
                format!("Can't reach Tailscale LocalAPI: {detail}."),
            ),
        },
        TailnetFacts::Status { .. } => check_status(is_mac, tailscale, setup_command, findings),
    }
}

fn check_status(
    is_mac: bool,
    tailscale: &TailnetFacts,
    setup_command: &str,
    findings: &mut Vec<Finding>,
) {
    let TailnetFacts::Status {
        version,
        backend_state,
        dns_name,
        cert_domains,
        ..
    } = tailscale
    else {
        return;
    };
    let running = backend_state == "Running" && dns_name.is_some();
    if !running {
        match (is_mac, backend_state.as_str()) {
            (false, "NeedsLogin") => error(
                findings,
                "Tailscale isn't logged in: run `sudo tailscale login`.",
            ),
            (false, "Stopped") => error(
                findings,
                "Tailscale is stopped: run `sudo tailscale up` (if it asks you to repeat your settings, add the flags it names).",
            ),
            (true, "NeedsLogin") => error(findings, "Sign in from the Tailscale app."),
            (true, "Stopped") => error(findings, "Connect from the Tailscale app."),
            _ => error(
                findings,
                format!("Tailscale isn't ready (backend state: {backend_state})."),
            ),
        }
    }
    match parse_major_minor(version) {
        Some((major, minor)) => {
            let version_string = format!("{major}.{minor}");
            if is_mac && (major, minor) < (1, 104) {
                error(
                    findings,
                    format!(
                        "The Tailscale app {version_string} is older than 1.104, the oldest muxen is tested with; update it."
                    ),
                );
            } else if !is_mac && (major, minor) < (1, 94) {
                error(
                    findings,
                    format!(
                        "Tailscale {version_string} can't proxy to a Unix socket; upgrade to 1.94 or later."
                    ),
                );
            }
        }
        None => error(
            findings,
            format!("Tailscale returned an unrecognized version: {version}."),
        ),
    }
    if running {
        match dns_name.as_deref() {
            None | Some("") => error(
                findings,
                "MagicDNS is off for your tailnet; turn it on at https://login.tailscale.com/admin/dns.",
            ),
            Some(name)
                if !cert_domains
                    .iter()
                    .map(|domain| domain.trim_end_matches('.'))
                    .any(|domain| domain.eq_ignore_ascii_case(name.trim_end_matches('.'))) =>
            {
                error(
                    findings,
                    format!(
                        "HTTPS certificates are off for your tailnet. Turn them on under HTTPS Certificates at https://login.tailscale.com/admin/dns, then rerun `{setup_command}`."
                    ),
                );
            }
            _ => {}
        }
    }
}

#[cfg(target_os = "linux")]
fn check_operator(
    operator: &Result<String, String>,
    username: &str,
    setup_command: &str,
    findings: &mut Vec<Finding>,
) {
    match operator {
        Ok(operator) if operator.is_empty() || operator == username => {}
        Ok(operator) => error(
            findings,
            format!(
                "Tailscale's operator is {operator}. muxen setup won't replace it; run `sudo tailscale set --operator=$USER` if you mean to, then rerun `{setup_command}`."
            ),
        ),
        Err(cause) => error(
            findings,
            format!("Can't read Tailscale's Serve operator: {cause}."),
        ),
    }
}

pub(crate) fn parse_major_minor(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts
        .next()?
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;
    Some((major, minor))
}

fn error(findings: &mut Vec<Finding>, message: impl Into<String>) {
    findings.push(Finding {
        level: Level::Error,
        message: message.into(),
    });
}

fn warning(findings: &mut Vec<Finding>, message: impl Into<String>) {
    findings.push(Finding {
        level: Level::Warning,
        message: message.into(),
    });
}
