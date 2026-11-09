// FlipDeck — desktop companion for the Flipper One.
// Embedded SSH client (russh, pure Rust) so the app needs no system ssh binary
// and works the same on Windows 11 and Linux. Supports password and key auth.
use russh::client;
use russh::keys::{load_secret_key, PrivateKeyWithHashAlg};
use russh::ChannelMsg;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use std::sync::Arc;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshProfile {
    host: String,
    port: u16,
    user: String,
    /// Password auth. Empty / null means "don't try password".
    #[serde(default)]
    password: Option<String>,
    /// Path to a private key for key auth. Empty / null means "don't try key".
    #[serde(default)]
    identity_file: Option<String>,
    /// Passphrase protecting the private key, if any.
    #[serde(default)]
    passphrase: Option<String>,
}

#[derive(Debug, Serialize)]
struct CommandResult {
    stdout: String,
    stderr: String,
    code: Option<i32>,
}

/// Minimal client handler. We accept the server key on first sight; host-key
/// pinning is a later addition.
struct Handler;

impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn non_empty(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|v| !v.is_empty())
}

/// Connect + authenticate, returning a live session handle.
async fn connect(profile: &SshProfile) -> Result<client::Handle<Handler>, String> {
    let config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(60)),
        ..Default::default()
    });

    let connect_fut = client::connect(config, (profile.host.as_str(), profile.port), Handler);
    let mut handle = match tokio::time::timeout(Duration::from_secs(12), connect_fut).await {
        Err(_) => return Err(format!("connection to {}:{} timed out", profile.host, profile.port)),
        Ok(Err(e)) => return Err(format!("could not connect: {e}")),
        Ok(Ok(h)) => h,
    };

    let password = non_empty(&profile.password);
    let identity = non_empty(&profile.identity_file);

    if password.is_none() && identity.is_none() {
        return Err("no credentials: provide a password or an identity file".into());
    }

    // Prefer key auth when a key is given; fall back to password if also provided.
    if let Some(path) = identity {
        let key = load_secret_key(path, profile.passphrase.as_deref())
            .map_err(|e| format!("could not load key '{path}': {e}"))?;
        let auth = handle
            .authenticate_publickey(
                &profile.user,
                PrivateKeyWithHashAlg::new(Arc::new(key), None),
            )
            .await
            .map_err(|e| format!("key auth error: {e}"))?;
        if auth.success() {
            return Ok(handle);
        }
        if password.is_none() {
            return Err("key authentication rejected by server".into());
        }
    }

    if let Some(pw) = password {
        let auth = handle
            .authenticate_password(&profile.user, pw)
            .await
            .map_err(|e| format!("password auth error: {e}"))?;
        if auth.success() {
            return Ok(handle);
        }
        return Err("password authentication rejected (wrong user/password?)".into());
    }

    Err("authentication failed".into())
}

/// Run one command and collect its output. A fresh connection per call keeps
/// the first cut simple; a persistent session pool is a later optimization.
#[tauri::command]
async fn ssh_run(profile: SshProfile, command: String) -> Result<CommandResult, String> {
    let handle = connect(&profile).await?;

    let mut channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("could not open channel: {e}"))?;
    channel
        .exec(true, command.as_bytes())
        .await
        .map_err(|e| format!("could not run command: {e}"))?;

    let mut stdout: Vec<u8> = Vec::new();
    let mut stderr: Vec<u8> = Vec::new();
    let mut code: Option<i32> = None;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => stdout.extend_from_slice(data),
            ChannelMsg::ExtendedData { ref data, ext } => {
                if ext == 1 {
                    stderr.extend_from_slice(data);
                }
            }
            ChannelMsg::ExitStatus { exit_status } => code = Some(exit_status as i32),
            ChannelMsg::Close | ChannelMsg::Eof => {}
            _ => {}
        }
    }

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        code,
    })
}

#[tauri::command]
async fn ssh_test(profile: SshProfile) -> Result<CommandResult, String> {
    ssh_run(profile, "uname -a && echo FLIPDECK_OK".into()).await
}

// ---- Saved connections --------------------------------------------------
// Only non-secret metadata is persisted. Passwords and key passphrases are
// never written to disk; they are entered per session.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedConnection {
    id: String,
    name: String,
    host: String,
    port: u16,
    user: String,
    #[serde(default)]
    identity_file: Option<String>,
}

fn connections_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    Ok(dir.join("connections.json"))
}

#[tauri::command]
fn connections_load(app: tauri::AppHandle) -> Result<Vec<SavedConnection>, String> {
    let file = connections_file(&app)?;
    if !file.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&file).map_err(|e| format!("could not read: {e}"))?;
    serde_json::from_str(&data).map_err(|e| format!("could not parse connections: {e}"))
}

#[tauri::command]
fn connections_save(
    app: tauri::AppHandle,
    connections: Vec<SavedConnection>,
) -> Result<(), String> {
    let file = connections_file(&app)?;
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create config dir: {e}"))?;
    }
    let data =
        serde_json::to_string_pretty(&connections).map_err(|e| format!("could not serialize: {e}"))?;
    std::fs::write(&file, data).map_err(|e| format!("could not write: {e}"))
}

// ---- SFTP (Files panel) -------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
}

#[derive(Debug, Serialize)]
struct Listing {
    cwd: String,
    entries: Vec<FileEntry>,
}

/// Open an SFTP session. Returns the connection handle too so the caller keeps
/// it alive for the duration of the transfer.
async fn open_sftp(
    profile: &SshProfile,
) -> Result<(client::Handle<Handler>, SftpSession), String> {
    let handle = connect(profile).await?;
    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("could not open channel: {e}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("could not start sftp subsystem: {e}"))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("sftp init failed: {e}"))?;
    Ok((handle, sftp))
}

fn join_remote(base: &str, name: &str) -> String {
    if base.ends_with('/') {
        format!("{base}{name}")
    } else {
        format!("{base}/{name}")
    }
}

/// List a remote directory. An empty `path` resolves to the login directory.
#[tauri::command]
async fn sftp_list(profile: SshProfile, path: String) -> Result<Listing, String> {
    let (_handle, sftp) = open_sftp(&profile).await?;
    let cwd = if path.is_empty() {
        sftp.canonicalize(".")
            .await
            .map_err(|e| format!("could not resolve home: {e}"))?
    } else {
        sftp.canonicalize(&path).await.unwrap_or(path)
    };

    let dir = sftp
        .read_dir(&cwd)
        .await
        .map_err(|e| format!("could not list {cwd}: {e}"))?;

    let mut entries = Vec::new();
    for entry in dir {
        let name = entry.file_name();
        if name == "." || name == ".." {
            continue;
        }
        let md = entry.metadata();
        entries.push(FileEntry {
            path: join_remote(&cwd, &name),
            is_dir: md.is_dir(),
            size: md.len(),
            name,
        });
    }
    // Directories first, then case-insensitive by name.
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(Listing { cwd, entries })
}

/// Download a remote file to a local path. Returns bytes written.
#[tauri::command]
async fn sftp_download(
    profile: SshProfile,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
    let (_handle, sftp) = open_sftp(&profile).await?;
    let data = sftp
        .read(&remote_path)
        .await
        .map_err(|e| format!("download failed: {e}"))?;
    let len = data.len() as u64;
    std::fs::write(&local_path, &data).map_err(|e| format!("could not write {local_path}: {e}"))?;
    Ok(len)
}

/// Upload a local file to a remote path. Returns bytes sent.
#[tauri::command]
async fn sftp_upload(
    profile: SshProfile,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    let data =
        std::fs::read(&local_path).map_err(|e| format!("could not read {local_path}: {e}"))?;
    let len = data.len() as u64;
    let (_handle, sftp) = open_sftp(&profile).await?;
    // Use create() (CREATE|TRUNCATE|WRITE); the bare write() helper opens
    // WRITE-only and fails when the remote file does not already exist.
    let mut file = sftp
        .create(remote_path)
        .await
        .map_err(|e| format!("upload failed to open remote: {e}"))?;
    file.write_all(&data)
        .await
        .map_err(|e| format!("upload failed: {e}"))?;
    file.close()
        .await
        .map_err(|e| format!("upload failed to close: {e}"))?;
    Ok(len)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Runs only when FLIPDECK_TEST_KEY is set, so a plain `cargo test` for
    // others is a no-op. Points at a local sshd using a key in that env var.
    #[test]
    fn russh_key_login_roundtrip() {
        let Ok(key) = std::env::var("FLIPDECK_TEST_KEY") else {
            eprintln!("skipping: FLIPDECK_TEST_KEY not set");
            return;
        };
        let user = std::env::var("USER").unwrap_or_else(|_| "root".into());
        let host = std::env::var("FLIPDECK_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into());

        let profile = SshProfile {
            host,
            port: 22,
            user,
            password: None,
            identity_file: Some(key),
            passphrase: None,
        };

        // Use Tauri's own async runtime, exactly as the app does, so this
        // reproduces the in-app path (not a hand-built tokio runtime).
        let out = tauri::async_runtime::block_on(ssh_run(
            profile,
            "echo HELLO_FROM_RUSSH".into(),
        ))
        .expect("ssh_run failed");

        assert!(
            out.stdout.contains("HELLO_FROM_RUSSH"),
            "stdout was: {:?} / stderr: {:?}",
            out.stdout,
            out.stderr
        );
        assert_eq!(out.code, Some(0));
    }

    fn test_profile() -> Option<SshProfile> {
        let key = std::env::var("FLIPDECK_TEST_KEY").ok()?;
        Some(SshProfile {
            host: std::env::var("FLIPDECK_TEST_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: 22,
            user: std::env::var("USER").unwrap_or_else(|_| "root".into()),
            password: None,
            identity_file: Some(key),
            passphrase: None,
        })
    }

    #[test]
    fn sftp_list_home() {
        let Some(profile) = test_profile() else {
            eprintln!("skipping: FLIPDECK_TEST_KEY not set");
            return;
        };
        let listing = tauri::async_runtime::block_on(sftp_list(profile, String::new()))
            .expect("sftp_list failed");
        assert!(listing.cwd.starts_with('/'), "cwd was {:?}", listing.cwd);
        // The home dir has at least the .ssh we created for the key test.
        assert!(
            listing.entries.iter().any(|e| e.name == ".ssh"),
            "entries: {:?}",
            listing.entries.iter().map(|e| &e.name).collect::<Vec<_>>()
        );
    }

    #[test]
    fn sftp_upload_download_roundtrip() {
        let Some(profile) = test_profile() else {
            eprintln!("skipping: FLIPDECK_TEST_KEY not set");
            return;
        };
        let payload = b"flipdeck sftp roundtrip \x00\x01\x02 payload";
        let src = std::env::temp_dir().join("flipdeck_rt_src.bin");
        let dst = std::env::temp_dir().join("flipdeck_rt_dst.bin");
        let remote = "/tmp/flipdeck_rt_remote.bin".to_string();
        std::fs::write(&src, payload).unwrap();
        let _ = std::fs::remove_file(&dst);

        tauri::async_runtime::block_on(async {
            let up = sftp_upload(
                profile.clone(),
                src.to_string_lossy().into_owned(),
                remote.clone(),
            )
            .await
            .expect("upload failed");
            assert_eq!(up, payload.len() as u64);

            let down = sftp_download(
                profile.clone(),
                remote.clone(),
                dst.to_string_lossy().into_owned(),
            )
            .await
            .expect("download failed");
            assert_eq!(down, payload.len() as u64);
        });

        let got = std::fs::read(&dst).unwrap();
        assert_eq!(got, payload, "round-tripped bytes differ");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ssh_run,
            ssh_test,
            sftp_list,
            sftp_download,
            sftp_upload,
            connections_load,
            connections_save
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
