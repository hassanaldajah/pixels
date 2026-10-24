// No extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The pixels desktop shell.
//!
//! It starts the bundled Python backend on a free loopback port, waits until it answers, then
//! points the (already maximised) window at it. The backend serves the web app and the API from
//! one origin, exactly like `start.ps1` does, so nothing about the browser version changes.
//! The window never navigates anywhere except that local address.

use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use tauri::{Manager, RunEvent, Url};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);

/// The running backend process, so it can be stopped when the window closes.
struct Backend(Mutex<Option<Child>>);

fn free_port() -> std::io::Result<u16> {
    // Bind to port 0, let the OS pick, then release it for the backend to take.
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// A plain HTTP request to /api/health, without pulling in an HTTP client crate.
fn backend_is_healthy(port: u16) -> bool {
    let addr: SocketAddr = match format!("127.0.0.1:{port}").parse() {
        Ok(addr) => addr,
        Err(_) => return false,
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let request =
        format!("GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.1 200")
}

fn backend_command(resources: &std::path::Path, port: u16) -> Command {
    let exe_name = if cfg!(windows) { "pixels-server.exe" } else { "pixels-server" };
    let mut command = Command::new(resources.join("backend").join(exe_name));
    command
        .args(["--port", &port.to_string()])
        .env("PIXELS_WEB_DIST", resources.join("web"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

fn resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| format!("Could not find the app resources: {e}"))
}

/// The message as a JavaScript string literal: only plain printable ASCII is kept as it is, every other
/// character (quotes, backslashes, line breaks, U+2028, non-ASCII text) becomes a \uXXXX escape.
fn js_string(message: &str) -> String {
    let mut out = String::with_capacity(message.len() + 2);
    out.push('"');
    for unit in message.encode_utf16() {
        match unit {
            0x20..=0x7e if unit != u16::from(b'"') && unit != u16::from(b'\\') && unit != u16::from(b'<') => {
                out.push(char::from(unit as u8));
            }
            _ => out.push_str(&format!("\\u{unit:04x}")),
        }
    }
    out.push('"');
    out
}

fn show_error(window: &tauri::WebviewWindow, message: &str) {
    let _ = window.eval(&format!("window.pixelsFail && window.pixelsFail({})", js_string(message)));
}

#[cfg(test)]
mod tests {
    use super::js_string;

    #[test]
    fn messages_cannot_break_out_of_the_string() {
        assert_eq!(js_string("ok"), "\"ok\"");
        assert_eq!(js_string("a'b\"c\\d"), "\"a'b\\u0022c\\u005cd\"");
        assert_eq!(js_string("line\nbreak\u{2028}"), "\"line\\u000abreak\\u2028\"");
        assert_eq!(js_string("</script>"), "\"\\u003c/script>\"");
        assert_eq!(js_string("مسار"), "\"\\u0645\\u0633\\u0627\\u0631\"");
    }
}

fn start(app: tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };

    // `tauri dev`: use a backend that is already running instead of the bundled one.
    if let Ok(url) = std::env::var("PIXELS_DEV_URL") {
        if let Ok(url) = Url::parse(&url) {
            let _ = window.navigate(url);
        }
        return;
    }

    let result = (|| -> Result<u16, String> {
        let port = free_port().map_err(|e| format!("No free network port: {e}"))?;
        let resources = resource_dir(&app)?;
        let child = backend_command(&resources, port)
            .spawn()
            .map_err(|e| format!("Could not start the pixels backend: {e}"))?;
        if let Some(state) = app.try_state::<Backend>() {
            *state.0.lock().expect("backend lock") = Some(child);
        }
        let started = Instant::now();
        while started.elapsed() < STARTUP_TIMEOUT {
            if backend_is_healthy(port) {
                return Ok(port);
            }
            // If the backend already died there is no point waiting.
            if let Some(state) = app.try_state::<Backend>() {
                if let Some(child) = state.0.lock().expect("backend lock").as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        return Err(format!("The backend stopped during start-up ({status})."));
                    }
                }
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("The backend did not start within 90 seconds.".into())
    })();

    match result {
        Ok(port) => match Url::parse(&format!("http://127.0.0.1:{port}/?splash=0")) {
            Ok(url) => {
                let _ = window.navigate(url);
            }
            Err(e) => show_error(&window, &format!("Bad address: {e}")),
        },
        Err(message) => show_error(&window, &message),
    }
}

fn stop_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Some(mut child) = state.0.lock().expect("backend lock").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            // The window is created hidden and maximised, then shown: it never appears small and jumps.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
                let _ = window.show();
            }
            let handle = app.handle().clone();
            thread::spawn(move || start(handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the pixels desktop app");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_backend(handle);
        }
    });
}
