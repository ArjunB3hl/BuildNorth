import Foundation

enum APIError: LocalizedError, Equatable {
  /// 401 from the backend: the watch token was revoked, expired or never valid. The watch forgets the link.
  case unauthorized
  case offline
  /// Something answered that is not the backend (a tunnel whose endpoint is down, a captive portal…).
  case unreachable
  case timeout
  case notFound
  case http(status: Int, detail: String?)
  case invalidResponse

  var errorDescription: String? {
    switch self {
    case .unauthorized: return "This watch was unlinked. Link it again from Rhythm on your iPhone."
    case .offline: return "Can't connect. Check your connection and try again."
    case .unreachable: return "Can't reach the Rhythm server right now."
    case .timeout: return "Rhythm took too long to answer. Try again."
    case .notFound: return "That item couldn't be found. It may have been deleted."
    case .http(422, let detail?) where !detail.hasPrefix("["): return detail
    case .http(422, _): return "Some details need fixing. Try again."
    case .http(409, let detail?): return detail
    case .http(429, _): return "Too many requests. Try again shortly."
    case .http: return "Something went wrong on our side. Try again."
    case .invalidResponse: return "Rhythm sent something unexpected. Try again."
    }
  }

  /// No connection at all, as opposed to the server rejecting the request.
  var isConnectivity: Bool {
    self == .offline || self == .unreachable || self == .timeout
  }
}

/// Calls the backend's /watch/* routes with the watch token. The backend derives the user from the token;
/// the watch never sends a user ID.
struct APIClient: Sendable {
  let link: WatchLinkInfo

  private static let timeout: TimeInterval = 15
  /// A health upload can wait on the backend's Agent Memory mirror (its client times out after 20 s) after the
  /// day is already saved, so it gets longer before the watch reports a failure and retries.
  private static let healthUploadTimeout: TimeInterval = 30

  /// Ephemeral with no URL cache: responses hold plan items, check-ins and health metrics, and nothing of them may
  /// stay on disk after an unlink.
  static let session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = timeout
    config.timeoutIntervalForResource = healthUploadTimeout
    config.waitsForConnectivity = false
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.urlCache = nil
    return URLSession(configuration: config)
  }()

  func calendar(date: String) async throws -> [CalendarEntry] {
    try await send("GET", ["watch", "calendar"], query: [
      URLQueryItem(name: "start", value: date),
      URLQueryItem(name: "days", value: "1"),
      URLQueryItem(name: "timezone", value: TimeZone.current.identifier),
    ])
  }

  func today(date: String) async throws -> WatchToday {
    try await send("GET", ["watch", "today"], query: [URLQueryItem(name: "date", value: date)])
  }

  /// Validate the phone's token even when no HealthKit data is available to upload.
  func validateLink() async throws {
    struct History: Decodable { let days: [HealthDay] }
    let _: History = try await send("GET", ["watch", "health"], query: [URLQueryItem(name: "days", value: "1")])
  }

  func setStatus(itemID: String, status: PlanStatus) async throws -> PlanItem {
    try await send("PATCH", ["watch", "plan", itemID], body: Self.encode(PlanStatusPatch(status: status)))
  }

  func saveCheckIn(date: String, patch: CheckInPatch) async throws -> CheckIn {
    try await send("PATCH", ["watch", "checkins", date], body: Self.encode(patch))
  }

  func uploadHealth(date: String, day: HealthDayIn) async throws -> HealthDay {
    try await send("PUT", ["watch", "health", date], body: Self.encode(day), timeout: Self.healthUploadTimeout)
  }

  private static func encode(_ value: some Encodable) throws -> Data {
    try JSONEncoder().encode(value)
  }

  /// `apiURL` (which may end in a slash or carry a base path) plus percent-encoded path segments and the query.
  func url(_ path: [String], query: [URLQueryItem] = []) -> URL {
    let url = path.reduce(link.apiURL) { $0.appending(component: $1) }
    return query.isEmpty ? url : url.appending(queryItems: query)
  }

  private func send<Response: Decodable>(
    _ method: String, _ path: [String], query: [URLQueryItem] = [], body: Data? = nil, timeout: TimeInterval = Self.timeout
  ) async throws -> Response {
    var request = URLRequest(url: url(path, query: query), timeoutInterval: timeout)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("Bearer \(link.token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }

    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await Self.session.data(for: request)
    } catch let error as URLError {
      switch error.code {
      case .cancelled: throw CancellationError()
      case .timedOut: throw APIError.timeout
      default: throw APIError.offline
      }
    }
    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }

    if !(200..<300).contains(http.statusCode) {
      // The backend always answers errors with JSON `{"detail": ...}`; anything else came from something in between,
      // and must not unlink the watch.
      guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw APIError.unreachable
      }
      let detail = json["detail"] as? String
      switch http.statusCode {
      case 401: throw APIError.unauthorized
      case 404: throw APIError.notFound
      default: throw APIError.http(status: http.statusCode, detail: detail)
      }
    }
    do {
      return try JSONDecoder().decode(Response.self, from: data)
    } catch {
      throw APIError.invalidResponse
    }
  }
}
