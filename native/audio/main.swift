import Foundation
import CoreAudio

struct AudioFailure: Error { let message: String }
let system = AudioObjectID(kAudioObjectSystemObject)
func address(_ selector: AudioObjectPropertySelector, _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal, _ element: AudioObjectPropertyElement = kAudioObjectPropertyElementMain) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: element)
}
func read<T>(_ id: AudioObjectID, _ property: AudioObjectPropertyAddress, _ initial: T) -> T? {
    var property = property, result = initial, size = UInt32(MemoryLayout<T>.size)
    guard withUnsafeMutablePointer(to: &result, { AudioObjectGetPropertyData(id, &property, 0, nil, &size, $0) }) == noErr else { return nil }
    return result
}
func writable(_ id: AudioObjectID, _ property: AudioObjectPropertyAddress) -> Bool {
    var property = property, value = DarwinBoolean(false)
    return AudioObjectIsPropertySettable(id, &property, &value) == noErr && value.boolValue
}
func write<T>(_ id: AudioObjectID, _ property: AudioObjectPropertyAddress, _ value: T) throws {
    var property = property, value = value
    guard writable(id, property), withUnsafePointer(to: &value, { AudioObjectSetPropertyData(id, &property, 0, nil, UInt32(MemoryLayout<T>.size), $0) }) == noErr else { throw AudioFailure(message: "This audio device does not support that control.") }
}
func deviceIDs() -> [AudioObjectID] {
    var property = address(kAudioHardwarePropertyDevices), size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &property, 0, nil, &size) == noErr, size > 0, size <= 4096 else { return [] }
    var values = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    let status = values.withUnsafeMutableBytes { AudioObjectGetPropertyData(system, &property, 0, nil, &size, $0.baseAddress!) }
    return status == noErr ? values : []
}
func channels(_ id: AudioObjectID, _ scope: AudioObjectPropertyScope) -> UInt32 {
    var property = address(kAudioDevicePropertyStreamConfiguration, scope), size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(id, &property, 0, nil, &size) == noErr, size >= MemoryLayout<AudioBufferList>.size, size < 65536 else { return 0 }
    let memory = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { memory.deallocate() }
    guard AudioObjectGetPropertyData(id, &property, 0, nil, &size, memory) == noErr else { return 0 }
    return UnsafeMutableAudioBufferListPointer(memory.assumingMemoryBound(to: AudioBufferList.self)).reduce(0) { $0 + $1.mNumberChannels }
}
func defaultID(_ scope: AudioObjectPropertyScope) -> AudioObjectID {
    read(system, address(scope == kAudioObjectPropertyScopeInput ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice), AudioObjectID(0)) ?? 0
}
func volumeProperties(_ id: AudioObjectID, _ scope: AudioObjectPropertyScope) -> [AudioObjectPropertyAddress] {
    let master = address(kAudioDevicePropertyVolumeScalar, scope)
    if read(id, master, Float32(0)) != nil { return [master] }
    let count = channels(id, scope)
    guard count > 0 && count <= 32 else { return [] }
    let properties = (1...count).map { address(kAudioDevicePropertyVolumeScalar, scope, $0) }
    return properties.allSatisfy { read(id, $0, Float32(0)) != nil } ? properties : []
}
func name(_ id: AudioObjectID) -> String {
    var property = address(kAudioObjectPropertyName), value: Unmanaged<CFString>?, size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard withUnsafeMutablePointer(to: &value, { AudioObjectGetPropertyData(id, &property, 0, nil, &size, $0) }) == noErr, let value else { return "Audio device" }
    return String((value.takeRetainedValue() as String).prefix(128))
}
func snapshot(_ scope: AudioObjectPropertyScope) -> [String: Any] {
    let devices = deviceIDs().filter { channels($0, scope) > 0 && (read($0, address(kAudioDevicePropertyDeviceIsAlive), UInt32(1)) ?? 0) != 0 }
    let id = defaultID(scope), properties = volumeProperties(id, scope)
    let values = properties.compactMap { read(id, $0, Float32(0)) }
    let volume: Any = values.isEmpty ? NSNull() : Int((values.reduce(0,+) / Float32(values.count) * 100).rounded())
    let muteProperty = address(kAudioDevicePropertyMute, scope)
    let muted = read(id, muteProperty, UInt32(0))
    return ["devices": devices.map { ["id": $0, "name": name($0)] }, "deviceId": id, "deviceName": devices.contains(id) ? name(id) : "No device", "volume": volume, "muted": muted.map { $0 != 0 } as Any? ?? NSNull(), "canVolume": !properties.isEmpty && properties.allSatisfy { writable(id, $0) }, "canMute": muted != nil && writable(id, muteProperty)]
}
do {
    let args = Array(CommandLine.arguments.dropFirst())
    if args.first != "get" {
        guard args.count == 4, ["input", "output"].contains(args[1]), let id = UInt32(args[2]), deviceIDs().contains(id) else { throw AudioFailure(message: "Choose an available audio device.") }
        let scope = args[1] == "input" ? kAudioObjectPropertyScopeInput : kAudioObjectPropertyScopeOutput
        guard channels(id, scope) > 0 else { throw AudioFailure(message: "This device does not support that audio direction.") }
        if args[0] == "device" {
            guard let expected = UInt32(args[3]), expected == defaultID(scope) else { throw AudioFailure(message: "The active audio device changed. Try again.") }
            try write(system, address(scope == kAudioObjectPropertyScopeInput ? kAudioHardwarePropertyDefaultInputDevice : kAudioHardwarePropertyDefaultOutputDevice), id)
        } else {
            guard id == defaultID(scope) else { throw AudioFailure(message: "The active audio device changed. Try again.") }
            if args[0] == "volume", let percent = Float32(args[3]), percent.isFinite, percent >= 0, percent <= 100 {
                let properties = volumeProperties(id, scope)
                guard !properties.isEmpty, properties.allSatisfy({ writable(id, $0) }) else { throw AudioFailure(message: "Volume is controlled by this device.") }
                for property in properties { try write(id, property, percent / 100) }
            } else if args[0] == "mute", ["true", "false"].contains(args[3]) {
                try write(id, address(kAudioDevicePropertyMute, scope), UInt32(args[3] == "true" ? 1 : 0))
            } else { throw AudioFailure(message: "Unknown audio control.") }
        }
    } else if args.count != 1 { throw AudioFailure(message: "Invalid audio command.") }
    let data = try JSONSerialization.data(withJSONObject: ["input": snapshot(kAudioObjectPropertyScopeInput), "output": snapshot(kAudioObjectPropertyScopeOutput)], options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
} catch {
    let message = (error as? AudioFailure)?.message ?? "Could not read the Mac audio devices."
    FileHandle.standardError.write(Data(message.utf8)); exit(1)
}
