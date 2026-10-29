import AppKit
import CryptoKit
import SwiftUI
import WebKit

#if RHYTHM_AUTH_TEST_ALT
private let rhythmURL = URL(string: "http://localhost:8113/")!
#elseif RHYTHM_AUTH_TEST
private let rhythmURL = URL(string: "http://localhost:8089/")!
#else
private let rhythmURL = URL(string: "https://rhythm-buildnorth.expo.app/")!
#endif

@main
struct NorthAssistantApp: App {
  var body: some Scene {
    Window("Rhythm · Demo version", id: "main") {
      RhythmWindow().frame(minWidth: 900, minHeight: 600)
    }
    .defaultSize(width: 1200, height: 800)
  }
}

private struct RhythmWindow: View {
  @State private var failure = false
  @State private var reloadID = 0

  var body: some View {
    ZStack {
      RhythmWebView(failure: $failure, reloadID: reloadID)
      if failure {
        VStack(spacing: 16) {
          Text("Rhythm couldn’t connect").font(.title2.bold())
          Text("Check your internet connection and try again.")
          Button("Try again") { failure = false; reloadID += 1 }
          Button("Open Rhythm in your browser") { NSWorkspace.shared.open(rhythmURL) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(nsColor: .windowBackgroundColor))
      }
    }
  }
}

private struct RhythmWebView: NSViewRepresentable {
  @Binding var failure: Bool
  let reloadID: Int

  func makeCoordinator() -> Coordinator { Coordinator(failure: $failure) }

  func makeNSView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .default()
    configuration.userContentController.add(context.coordinator, name: "rhythmAuth")
    configuration.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "rhythmVoice")
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = context.coordinator
    view.uiDelegate = context.coordinator
    view.load(URLRequest(url: rhythmURL))
    return view
  }

  func updateNSView(_ view: WKWebView, context: Context) {
    guard context.coordinator.reloadID != reloadID else { return }
    context.coordinator.reloadID = reloadID
    view.load(URLRequest(url: rhythmURL))
  }

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    @Binding var failure: Bool
    var reloadID = 0

    init(failure: Binding<Bool>) { _failure = failure }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
      let origin = message.frameInfo.securityOrigin
      guard message.name == "rhythmVoice", message.frameInfo.isMainFrame,
            origin.protocol == rhythmURL.scheme, origin.host == rhythmURL.host,
            origin.port == (rhythmURL.port ?? (rhythmURL.scheme == "https" ? 443 : 80)),
            let body = message.body as? [String: Any], let action = body["action"] as? String,
            ((message.webView?.url?.path == "/coach" && ["status", "transcribe", "synthesize", "coach"].contains(action)) ||
             (message.webView?.url?.path == "/activity/camera" && action == "status")) else {
        replyHandler(nil, "Local voice is unavailable."); return
      }
      var payload: [String: Any] = [:]
      if action == "transcribe" {
        guard let audio = body["audioBase64"] as? String, audio.count <= 880_000 else {
          replyHandler(nil, "Invalid recording."); return
        }
        payload["audioBase64"] = audio
      } else if action == "synthesize" || action == "coach" {
        guard let text = body["text"] as? String, !text.isEmpty, text.count <= (action == "coach" ? 4000 : 600) else {
          replyHandler(nil, "Invalid reply."); return
        }
        payload["text"] = text
      }
      Task {
        do { let result = try await LocalVoice.request(action, payload: payload); replyHandler(result, nil) }
        catch { replyHandler(nil, "Local voice is unavailable. Start the local voice service and try again.") }
      }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
      let origin = message.frameInfo.securityOrigin
      guard message.name == "rhythmAuth", message.frameInfo.isMainFrame,
            origin.protocol == rhythmURL.scheme, origin.host == rhythmURL.host,
            origin.port == (rhythmURL.port ?? (rhythmURL.scheme == "https" ? 443 : 80)),
            let code = message.body as? String,
            code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { return }
      var url = URLComponents(url: rhythmURL, resolvingAgainstBaseURL: false)!
      url.path = "/mac-connect"
      url.fragment = code
      if let url = url.url { NSWorkspace.shared.open(url) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { failure = false }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
      if (error as NSError).code != NSURLErrorCancelled { failure = true }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      if (error as NSError).code != NSURLErrorCancelled { failure = true }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
      guard let url = action.request.url else { decisionHandler(.cancel); return }
      // The camera coach runs in a separate HTTPS iframe.
      guard action.targetFrame?.isMainFrame != false else { decisionHandler(.allow); return }
      let downloads = ["zip", "dmg", "pkg", "exe", "msi", "apk"]
      if action.navigationType == .linkActivated && downloads.contains(url.pathExtension.lowercased()) {
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
      } else if url.scheme == rhythmURL.scheme && url.host == rhythmURL.host && url.port == rhythmURL.port {
        decisionHandler(.allow)
      } else {
        if action.navigationType == .linkActivated, ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
          NSWorkspace.shared.open(url)
        }
        decisionHandler(.cancel)
      }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
      guard let url = action.request.url else { return nil }
      if url.scheme == rhythmURL.scheme && url.host == rhythmURL.host && url.port == rhythmURL.port { webView.load(action.request) }
      else if ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
      return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
      let alert = NSAlert()
      alert.messageText = message
      alert.addButton(withTitle: "OK")
      guard let window = webView.window else { completionHandler(); return }
      alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
      let alert = NSAlert()
      alert.messageText = message
      alert.addButton(withTitle: "OK")
      alert.addButton(withTitle: "Cancel")
      guard let window = webView.window else { completionHandler(false); return }
      alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }
  }
}

private final class VoiceNoRedirect: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

private enum LocalVoice {
  private static let endpoint = "http://127.0.0.1:39765/"
  private static let delegate = VoiceNoRedirect()
  private static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 120
    config.urlCache = nil
    return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
  }()

  static func request(_ action: String, payload: [String: Any]) async throws -> [String: Any] {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
    let token = try String(contentsOf: support.appendingPathComponent("Rhythm/local-voice.token"), encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else { throw URLError(.userAuthenticationRequired) }
    var random = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw URLError(.unknown) }
    let nonce = random.map { String(format: "%02x", $0) }.joined()
    let status = try await post("status", body: ["nonce": nonce], token: nil)
    let expected = HMAC<SHA256>.authenticationCode(for: Data(nonce.utf8), using: SymmetricKey(data: Data(token.utf8)))
      .map { String(format: "%02x", $0) }.joined()
    guard let proof = status["proof"] as? String, proof == expected else { throw URLError(.userAuthenticationRequired) }
    if action == "status" { return status }
    return try await post(action, body: payload, token: token)
  }

  private static func post(_ action: String, body: [String: Any], token: String?) async throws -> [String: Any] {
    guard let url = URL(string: endpoint + action) else { throw URLError(.badURL) }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let token = token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200, data.count <= 12_000_000,
          let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw URLError(.badServerResponse) }
    return result
  }
}
