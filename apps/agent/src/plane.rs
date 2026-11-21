//! The plane's agent API, as the agent calls it: typed by the types
//! generated from its OpenAPI spec (`crate::api`).
use std::{error::Error, time::Duration};

use async_trait::async_trait;
use reqwest::{StatusCode, header};
use serde::Serialize;

use crate::{
    api::{AgentPoll, AgentPollResult, RunnerExited},
    config::PlaneConfig,
    version::VERSION,
};

/// How long a call may take: well within a runner lease (a minute), so a
/// plane that stopped answering doesn't stall the agent.
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, thiserror::Error)]
pub enum PlaneError {
    /// The token was rejected: retrying can't fix that.
    #[error("the plane rejected the agent token")]
    Unauthorized,
    /// API errors carry a human-readable `detail`.
    #[error("HTTP {status}{}", detail.as_ref().map(|detail| format!(": {detail}")).unwrap_or_default())]
    Http { status: u16, detail: Option<String> },
    /// No response at all.
    #[error("{0}")]
    Network(String),
}

/// An error with its causes, which is where reqwest says what went wrong.
pub fn describe(error: &dyn Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !message.contains(&text) {
            message = format!("{message}: {text}");
        }
        source = cause.source();
    }
    message
}

/// What the agent calls on the plane. The live loop and the supervisor take
/// it as a trait so tests can stand in for the plane.
#[async_trait]
pub trait PlaneApi: std::fmt::Debug + Send + Sync {
    async fn poll(&self, poll: &AgentPoll) -> Result<AgentPollResult, PlaneError>;
    /// Tells the plane a runner is done: its exit code, or None if it never
    /// ran.
    async fn exited(&self, runner: &str, exit_code: Option<i64>) -> Result<(), PlaneError>;
}

/// A client for the plane's API, authenticated as the agent.
pub struct Plane {
    client: reqwest::Client,
    origin: String,
    token: String,
}

/// Without the token, which isn't for logs.
impl std::fmt::Debug for Plane {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Plane")
            .field("origin", &self.origin)
            .finish_non_exhaustive()
    }
}

/// A client for whatever the agent fetches: the plane, runner builds.
///
/// It trusts the system's certificates and Mozilla's, which it carries, so
/// it works on machines without a CA bundle (slim containers), as the agent
/// did on Bun.
///
/// # Errors
///
/// If TLS can't be set up.
pub fn http_client() -> Result<reqwest::Client, PlaneError> {
    let mozilla = webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .filter_map(|cert| reqwest::Certificate::from_der(cert).ok());
    reqwest::Client::builder()
        .user_agent(format!("manica-agent/{VERSION}"))
        .connect_timeout(TIMEOUT)
        .tls_certs_merge(mozilla)
        .build()
        .map_err(|error| PlaneError::Network(describe(&error)))
}

impl Plane {
    #[must_use]
    pub fn new(config: &PlaneConfig, client: reqwest::Client) -> Self {
        Self {
            client,
            origin: config.url.origin().ascii_serialization(),
            token: config.token.clone(),
        }
    }

    #[must_use]
    pub fn origin(&self) -> &str {
        &self.origin
    }

    async fn post(
        &self,
        path: &str,
        body: Option<&(impl Serialize + Sync)>,
    ) -> Result<reqwest::Response, PlaneError> {
        let mut request = self
            .client
            .post(format!("{}/api/agent{path}", self.origin))
            .header(header::AUTHORIZATION, format!("Bearer {}", self.token))
            .timeout(TIMEOUT);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .await
            .map_err(|error| PlaneError::Network(describe(&error)))?;
        let status = response.status();
        if status == StatusCode::UNAUTHORIZED {
            return Err(PlaneError::Unauthorized);
        }
        if !status.is_success() {
            let detail = response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|body| body.get("detail")?.as_str().map(str::to_owned));
            return Err(PlaneError::Http {
                status: status.as_u16(),
                detail,
            });
        }
        Ok(response)
    }

    /// Marks the agent seen, without polling: whether the plane is reachable
    /// and takes the token. A poll would tell the plane the agent holds no
    /// runners, and it would give up on the ones a running agent holds.
    ///
    /// # Errors
    ///
    /// If the plane can't be reached, or rejects the token.
    pub async fn heartbeat(&self) -> Result<(), PlaneError> {
        self.post("/heartbeat", None::<&()>).await.map(|_| ())
    }
}

#[async_trait]
impl PlaneApi for Plane {
    async fn poll(&self, poll: &AgentPoll) -> Result<AgentPollResult, PlaneError> {
        self.post("/poll", Some(poll))
            .await?
            .json()
            .await
            .map_err(|error| PlaneError::Network(describe(&error)))
    }

    async fn exited(&self, runner: &str, exit_code: Option<i64>) -> Result<(), PlaneError> {
        self.post(
            &format!("/runners/{runner}/exited"),
            Some(&RunnerExited { exit_code }),
        )
        .await
        .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{Reply, Server};

    fn plane(server: &Server) -> Plane {
        let config = PlaneConfig {
            url: server.url("some/path").parse().unwrap(),
            token: "mna_x".into(),
            poll_interval: Duration::from_secs(1),
        };
        Plane::new(&config, http_client().unwrap())
    }

    #[tokio::test]
    async fn polls_as_the_agent_and_reads_what_to_do() {
        let server = Server::replying(vec![Reply::json(
            200,
            r#"{"start":[{"id":"a","name":"manica-a","config":"jit"}],"cancel":["b"],"leaseSeconds":60,"runner":null}"#,
        )])
        .await;
        let polled = plane(&server)
            .poll(&AgentPoll {
                accepting: true,
                runners: vec!["b".into()],
                metrics: None,
                version: Some("1.2.3".try_into().unwrap()),
            })
            .await
            .unwrap();
        assert_eq!(polled.start[0].id, "a");
        assert_eq!(polled.cancel, ["b"]);
        assert!(polled.runner.is_none());
        let request = &server.received()[0];
        assert!(
            request.starts_with("POST /api/agent/poll HTTP/1.1\r\n"),
            "{request}"
        );
        assert!(
            request.contains("authorization: Bearer mna_x\r\n"),
            "{request}"
        );
        assert!(
            request.ends_with(r#"{"accepting":true,"runners":["b"],"version":"1.2.3"}"#),
            "{request}"
        );
    }

    #[tokio::test]
    async fn tells_a_rejected_token_from_other_errors() {
        let server = Server::replying(vec![
            Reply::json(401, "{}"),
            Reply::json(500, r#"{"detail":"database down"}"#),
        ])
        .await;
        let plane = plane(&server);
        assert!(matches!(
            plane.heartbeat().await,
            Err(PlaneError::Unauthorized)
        ));
        assert_eq!(
            plane.exited("r1", Some(3)).await.unwrap_err().to_string(),
            "HTTP 500: database down"
        );
        assert!(server.received()[1].ends_with(r#"{"exitCode":3}"#));
    }

    #[tokio::test]
    async fn reports_an_unreachable_plane() {
        let config = PlaneConfig {
            url: "http://127.0.0.1:1".parse().unwrap(),
            token: "mna_x".into(),
            poll_interval: Duration::from_secs(1),
        };
        let error = Plane::new(&config, http_client().unwrap())
            .heartbeat()
            .await
            .unwrap_err();
        assert!(matches!(error, PlaneError::Network(_)), "{error}");
    }
}
