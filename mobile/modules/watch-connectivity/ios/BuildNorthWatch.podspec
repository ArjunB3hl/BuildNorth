# Local Expo module (autolinked from ./modules). The pod is deliberately not called
# "WatchConnectivity": its Swift module would shadow Apple's framework of that name.
Pod::Spec.new do |s|
  s.name           = 'BuildNorthWatch'
  s.version        = '1.0.0'
  s.summary        = 'Links the BuildNorth Apple Watch app over WatchConnectivity'
  s.description    = 'Hands the BuildNorth API address and a revocable watch token to the paired Apple Watch.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
