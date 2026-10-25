// NorthWin: Windows features Expo doesn't cover, for the JS in modules/north-win/index.ts.
// The Windows counterpart of the Mac app's NorthMac Swift module, plus the store's file
// (expo-sqlite's job on the Mac).
#pragma once

#include "NativeModules.h"

#include <winrt/Windows.Data.Xml.Dom.h>
#include <winrt/Windows.Storage.h>
#include <winrt/Windows.UI.Notifications.h>

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>

namespace NorthAssistant {

REACT_MODULE(NorthWin)
struct NorthWin {
  ~NorthWin() noexcept {
    ReleaseKeepAwake();
  }

  // Shown on Profile > This PC: deviceName (this PC's name), windowsVersion (React Native's
  // Platform.Version is an API contract number on Windows, not the OS version) and dataFile
  // (where the store is saved).
  REACT_CONSTANT_PROVIDER(GetConstants)
  void GetConstants(winrt::Microsoft::ReactNative::ReactConstantProvider &provider) noexcept {
    wchar_t name[256]{};
    DWORD size = ARRAYSIZE(name);
    if (!GetComputerNameExW(ComputerNameDnsHostname, name, &size)) {
      name[0] = L'\0';
    }
    provider.Add(L"deviceName", winrt::to_string(name));
    provider.Add(L"windowsVersion", winrt::to_string(WindowsVersion()));
    provider.Add(L"dataFile", winrt::to_string(DataFile().wstring()));
  }

  // The whole store as one JSON document, read once at startup (synchronously, like the Mac
  // app's expo-sqlite read). Empty when nothing is saved yet.
  REACT_SYNC_METHOD(ReadState, L"readState")
  std::string ReadState() noexcept {
    try {
      std::ifstream in(DataFile(), std::ios::binary);
      if (!in) {
        return {};
      }
      std::ostringstream contents;
      contents << in.rdbuf();
      return contents.str();
    } catch (...) {
      return {};
    }
  }

  // Written to a temporary file first and then moved over the old one, so a crash mid-write
  // never leaves half a document.
  REACT_METHOD(WriteState, L"writeState")
  void WriteState(std::string json) noexcept {
    try {
      auto file = DataFile();
      auto temp = file;
      temp += L".tmp";
      {
        std::ofstream out(temp, std::ios::binary | std::ios::trunc);
        out.write(json.data(), static_cast<std::streamsize>(json.size()));
        if (!out) {
          return;
        }
      }
      MoveFileExW(temp.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
    } catch (...) {
    }
  }

  // Keeps the display on (cook mode) with a power request, which Windows tracks per process
  // and lists in `powercfg /requests`. Released with `false` or when the app quits.
  REACT_METHOD(SetKeepAwake, L"setKeepAwake")
  void SetKeepAwake(bool enabled) noexcept {
    if (!enabled) {
      ReleaseKeepAwake();
      return;
    }
    if (m_powerRequest) {
      return;
    }
    REASON_CONTEXT reason{POWER_REQUEST_CONTEXT_VERSION, POWER_REQUEST_CONTEXT_SIMPLE_STRING};
    reason.Reason.SimpleReasonString = const_cast<LPWSTR>(L"BuildNorth cook mode");
    HANDLE request = PowerCreateRequest(&reason);
    if (request == INVALID_HANDLE_VALUE) {
      return;
    }
    if (PowerSetRequest(request, PowerRequestDisplayRequired)) {
      m_powerRequest = request;
    } else {
      CloseHandle(request);
    }
  }

  // Number badge on the taskbar button (the Mac app's Dock badge). Badges need package
  // identity, which the packaged app has; without it the call fails and is ignored.
  REACT_METHOD(SetBadge, L"setBadge")
  void SetBadge(int count) noexcept {
    using namespace winrt::Windows::UI::Notifications;
    try {
      auto updater = BadgeUpdateManager::CreateBadgeUpdaterForApplication();
      if (count <= 0) {
        updater.Clear();
        return;
      }
      auto xml = BadgeUpdateManager::GetTemplateContent(BadgeTemplateType::BadgeNumber);
      xml.SelectSingleNode(L"/badge")
          .as<winrt::Windows::Data::Xml::Dom::XmlElement>()
          .SetAttribute(L"value", winrt::to_hstring(count));
      updater.Update(BadgeNotification(xml));
    } catch (winrt::hresult_error const &) {
    }
  }

 private:
  // e.g. "Windows 11, version 25H2 (build 26300.1234)", from the registry values Settings > About
  // shows. Windows 11 still reports ProductName "Windows 10", so the build number decides.
  static std::wstring WindowsVersion() noexcept {
    constexpr auto key = L"SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
    auto readString = [key](wchar_t const *value) {
      wchar_t buffer[64]{};
      DWORD bytes = sizeof(buffer);
      return RegGetValueW(HKEY_LOCAL_MACHINE, key, value, RRF_RT_REG_SZ, nullptr, buffer, &bytes) == ERROR_SUCCESS
          ? std::wstring{buffer}
          : std::wstring{};
    };
    auto const build = readString(L"CurrentBuildNumber");
    if (build.empty()) {
      return L"Windows";
    }
    std::wstring text = _wtoi(build.c_str()) >= 22000 ? L"Windows 11" : L"Windows 10";
    if (auto const release = readString(L"DisplayVersion"); !release.empty()) {
      text += L", version " + release;
    }
    text += L" (build " + build;
    DWORD revision = 0;
    DWORD bytes = sizeof(revision);
    if (RegGetValueW(HKEY_LOCAL_MACHINE, key, L"UBR", RRF_RT_REG_DWORD, nullptr, &revision, &bytes) == ERROR_SUCCESS) {
      text += L"." + std::to_wstring(revision);
    }
    return text + L")";
  }

  // The packaged app's LocalState folder; %LOCALAPPDATA%\BuildNorth if it runs without package
  // identity.
  std::filesystem::path const &DataFile() noexcept {
    if (m_dataFile.empty()) {
      std::filesystem::path folder;
      try {
        folder = std::wstring{winrt::Windows::Storage::ApplicationData::Current().LocalFolder().Path()};
      } catch (...) {
        wchar_t localAppData[MAX_PATH]{};
        DWORD length = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
        folder = (length && length < MAX_PATH) ? std::filesystem::path{localAppData} / L"BuildNorth"
                                               : std::filesystem::path{L"."};
        std::error_code ignored;
        std::filesystem::create_directories(folder, ignored);
      }
      m_dataFile = folder / L"buildnorth.json";
    }
    return m_dataFile;
  }

  void ReleaseKeepAwake() noexcept {
    if (m_powerRequest) {
      PowerClearRequest(m_powerRequest, PowerRequestDisplayRequired);
      CloseHandle(m_powerRequest);
      m_powerRequest = nullptr;
    }
  }

  HANDLE m_powerRequest{nullptr};
  std::filesystem::path m_dataFile;
};

} // namespace NorthAssistant
