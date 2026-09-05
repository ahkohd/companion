import AppKit

let once = CommandLine.arguments.contains("--once")
let interval = Double(CommandLine.arguments.dropFirst().first ?? "100") ?? 100
guard [100.0, 250, 500, 1000].contains(interval) else { exit(2) }

func sample() {
    let point = NSEvent.mouseLocation
    let screens = NSScreen.screens
    guard let screen = screens.first(where: { $0.frame.contains(point) }) ?? screens.first else { return }
    let frame = screen.frame
    guard frame.width > 0 && frame.height > 0 else { return }
    func rounded(_ value: Double) -> Double { (min(1, max(-1, value)) * 1000).rounded() / 1000 }
    let x = rounded(2 * (point.x - frame.minX) / frame.width - 1)
    let y = rounded(1 - 2 * (point.y - frame.minY) / frame.height)
    if let data = try? JSONSerialization.data(withJSONObject: ["x": x, "y": y]) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

repeat {
    autoreleasepool { sample() }
    if !once { RunLoop.main.run(until: Date(timeIntervalSinceNow: interval / 1000)) }
} while !once
