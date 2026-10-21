import Foundation
import Security

/// The watch token lives in this watch's own Keychain; the API URL is not secret and lives in UserDefaults.
/// AfterFirstUnlock so a refresh that runs while the watch is locked can still read it.
enum TokenStore {
  private static let service = "com.arjun273773.buildnorth.watch"
  private static let account = "watch-token"
  private static let apiURLKey = "bn.apiUrl"

  static func load() -> WatchLinkInfo? {
    guard let raw = UserDefaults.standard.string(forKey: apiURLKey), let url = URL(string: raw),
      let token = readToken()
    else { return nil }
    return WatchLinkInfo(apiURL: url, token: token)
  }

  /// False when the Keychain write failed; the previously stored link (if any) is then left as it was.
  static func save(_ link: WatchLinkInfo) -> Bool {
    guard writeToken(link.token) else { return false }
    UserDefaults.standard.set(link.apiURL.absoluteString, forKey: apiURLKey)
    return true
  }

  static func clear() {
    SecItemDelete(baseQuery() as CFDictionary)
    UserDefaults.standard.removeObject(forKey: apiURLKey)
  }

  private static func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private static func readToken() -> String? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private static func writeToken(_ token: String) -> Bool {
    let data = Data(token.utf8)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    let status = SecItemUpdate(baseQuery() as CFDictionary, attributes as CFDictionary)
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    var add = baseQuery()
    add.merge(attributes) { _, new in new }
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
  }
}
