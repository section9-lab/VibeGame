// Runs the WebGPU vs WebGL2 benchmark in a visible WKWebView.
//
// Usage (from the repository root):
//   swift benchmarks/webgpu-vs-webgl2/run-wkwebview.swift
//
// The script starts a local Python HTTP server, loads the benchmark page, waits
// for window.__bench.done, and writes results.json + results.png next to this
// file. A visible window is required: WebKit throttles requestAnimationFrame
// for hidden/occluded WKWebViews.
import Cocoa
import WebKit

let scriptURL = URL(fileURLWithPath: #filePath)
let benchmarkDir = scriptURL.deletingLastPathComponent()
let repoRoot = benchmarkDir.deletingLastPathComponent().deletingLastPathComponent()
let port = 8788

func log(_ message: String) {
    print(message)
    fflush(stdout)
}

final class Runner: NSObject, WKNavigationDelegate {
    var webView: WKWebView!
    var window: NSWindow!
    var server: Process?
    var polls = 0
    var finished = false

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.poll() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log("NAV_FAIL \(error)")
        finish(code: 2)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        log("NAV_PROVISIONAL_FAIL \(error)")
        finish(code: 2)
    }

    func poll() {
        if finished { return }
        polls += 1
        if polls > 240 {
            log("BENCHMARK_TIMEOUT")
            finish(code: 2)
            return
        }
        webView.evaluateJavaScript("JSON.stringify(window.__bench || {missing:true})") { result, error in
            if let error = error {
                log("POLL_ERROR \(error)")
            }
            guard let text = result as? String, let data = text.data(using: .utf8) else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.poll() }
                return
            }
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let done = (object?["done"] as? Bool) ?? false
            if !done {
                if self.polls % 2 == 0, let phase = object?["phase"] as? String {
                    log("PHASE \(phase)")
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.poll() }
                return
            }
            log("BENCHMARK_JSON \(text)")
            try? text.write(to: benchmarkDir.appendingPathComponent("results.json"), atomically: true, encoding: .utf8)
            let hasErrors = (object?["errors"] as? [Any])?.isEmpty == false
            self.finish(code: hasErrors ? 1 : 0)
        }
    }

    func finish(code: Int32) {
        if finished { return }
        finished = true
        server?.terminate()
        exit(code)
    }
}

let runner = Runner()
let app = NSApplication.shared
app.setActivationPolicy(.regular)

let server = Process()
server.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
server.arguments = ["-m", "http.server", "\(port)", "--bind", "127.0.0.1"]
server.currentDirectoryURL = repoRoot
let nullDevice = FileHandle(forWritingAtPath: "/dev/null")
server.standardOutput = nullDevice
server.standardError = nullDevice
do {
    try server.run()
    runner.server = server
} catch {
    log("SERVER_FAIL \(error)")
    exit(2)
}

let config = WKWebViewConfiguration()
let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 720), configuration: config)
webView.navigationDelegate = runner
runner.webView = webView

let window = NSWindow(
    contentRect: NSRect(x: 80, y: 80, width: 1280, height: 720),
    styleMask: [.titled, .closable, .resizable],
    backing: .buffered,
    defer: false
)
window.contentView = webView
window.title = "VibeGame WebGPU vs WebGL2 benchmark"
window.makeKeyAndOrderFront(nil)
runner.window = window
app.activate(ignoringOtherApps: true)

DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
    let url = "http://127.0.0.1:\(port)/benchmarks/webgpu-vs-webgl2/index.html?t=\(Int(Date().timeIntervalSince1970))"
    webView.load(URLRequest(url: URL(string: url)!))
}

DispatchQueue.main.asyncAfter(deadline: .now() + 600) {
    log("BENCHMARK_HARD_TIMEOUT")
    runner.finish(code: 2)
}

app.run()
