import AppKit
import ServiceManagement
#if SPARKLE
import Sparkle
#endif

struct Configuration: Decodable {
    var root: String
    var node: String
    let path: String
    let port: Int
    let bundled: Bool?
}

@MainActor
final class CompanionApp: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var item: NSStatusItem!
    let status = NSMenuItem(title: "Starting Companion...", action: nil, keyEquivalent: "")
    let restartItem = NSMenuItem(title: "Restart Companion", action: #selector(restart), keyEquivalent: "r")
    let nativeToken = UUID().uuidString + UUID().uuidString
    var nativeResult: [String: Any]?
    let updatesItem = NSMenuItem(title: "Check for Updates...", action: #selector(checkForUpdates), keyEquivalent: "")
    var config: Configuration!
    var dataFolder: URL?
    #if SPARKLE
    let updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: nil)
    #endif
    var child: Process?
    var logHandle: FileHandle?
    var timer: Timer?
    var terminationSignal: DispatchSourceSignal?
    var quitPulse: Timer?
    var statusSpinner: NSProgressIndicator?
    var polling = false
    var quitting = false
    var restarting = false
    var external = false
    var failures = 0
    var startedAt = Date()
    var logURL: URL!
    var baseURL: URL { URL(string: "http://127.0.0.1:\(config.port)")! }

    func applicationDidFinishLaunching(_ notification: Notification) {
        signal(SIGTERM, SIG_IGN)
        terminationSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        terminationSignal?.setEventHandler { NSApp.terminate(nil) }
        terminationSignal?.resume()
        item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setFill()
            for (x, y, height) in [(4.8, 8.0, 9.0), (12.7, 10.0, 8.0)] {
                let eye = NSBezierPath(roundedRect: NSRect(x: -1.575, y: -height / 2, width: 3.15, height: height), xRadius: 1.575, yRadius: 1.575)
                let tilt = AffineTransform(rotationByDegrees: 16)
                eye.transform(using: tilt)
                eye.transform(using: AffineTransform(translationByX: x, byY: y))
                eye.fill()
            }
            return true
        }
        item.button?.setAccessibilityLabel("Companion")
        item.button?.image?.isTemplate = true
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        status.isEnabled = true
        status.target = self
        status.action = #selector(openDevice)
        showBusyStatus("Starting Companion...")
        menu.addItem(status)
        menu.addItem(.separator())
        for (title, action, key) in [("Dashboard", #selector(openDashboard), "o"), ("Logs", #selector(openLogs), "l")] {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = self
            entry.image = menuIcon(title == "Dashboard" ? "square.grid.2x2" : "doc.text")
            menu.addItem(entry)
        }
        menu.addItem(.separator())
        restartItem.image = menuIcon("arrow.clockwise")
        restartItem.keyEquivalentModifierMask = [.command, .shift]
        restartItem.target = self
        menu.addItem(restartItem)
        menu.addItem(.separator())
        let about = NSMenuItem(title: "About Companion", action: #selector(showAbout), keyEquivalent: "")
        about.target = self
        about.image = menuIcon("info.circle")
        menu.addItem(about)
        updatesItem.target = self
        updatesItem.image = menuIcon("arrow.triangle.2.circlepath")
        menu.addItem(updatesItem)
        menu.addItem(.separator())
        let settings = NSMenuItem(title: "Settings...", action: #selector(openSettings), keyEquivalent: ",")
        settings.target = self
        settings.image = menuIcon("gearshape")
        menu.addItem(settings)
        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit Companion", action: #selector(quitApp), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        item.menu = menu
        do {
            let url = Bundle.main.url(forResource: "config", withExtension: "json")!
            config = try JSONDecoder().decode(Configuration.self, from: Data(contentsOf: url))
            if config.bundled == true {
                let resources = Bundle.main.resourceURL!
                config.root = resources.appendingPathComponent(config.root).path
                config.node = resources.appendingPathComponent(config.node).path
                let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Companion")
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                dataFolder = folder
            }
            guard (1...65535).contains(config.port) else { throw CocoaError(.fileReadCorruptFile) }
            let folder = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Companion Studio")
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            logURL = folder.appendingPathComponent("bridge.log")
            if !FileManager.default.fileExists(atPath: logURL.path) { FileManager.default.createFile(atPath: logURL.path, contents: nil) }
            logHandle = try FileHandle(forWritingTo: logURL)
            logHandle?.seekToEndOfFile()
            Task { await bootstrap() }
            timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.poll() }
            }
        } catch { clearBusyStatus(); status.title = "Setup failed"; status.toolTip = error.localizedDescription }
    }

    func showBusyStatus(_ title: String) {
        if statusSpinner != nil && status.title == title { return }
        clearBusyStatus()
        status.title = title
        status.image = nil
        let row = NSView(frame: NSRect(x: 0, y: 0, width: 250, height: 26))
        let spinner = NSProgressIndicator(frame: NSRect(x: 14, y: 5, width: 16, height: 16))
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isIndeterminate = true
        spinner.isDisplayedWhenStopped = false
        spinner.usesThreadedAnimation = true
        let label = NSTextField(labelWithString: title)
        label.font = .menuFont(ofSize: 0)
        label.textColor = quitting ? .disabledControlTextColor : .labelColor
        label.frame = NSRect(x: 38, y: 4, width: 204, height: 18)
        row.addSubview(spinner)
        row.addSubview(label)
        row.setAccessibilityElement(true)
        row.setAccessibilityLabel(title)
        status.view = row
        statusSpinner = spinner
        spinner.startAnimation(nil)
        item.button?.toolTip = title
    }

    func clearBusyStatus() {
        statusSpinner?.stopAnimation(nil)
        statusSpinner = nil
        status.view = nil
    }

    func menuIcon(_ symbol: String) -> NSImage? {
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        image?.size = NSSize(width: 16, height: 16)
        image?.isTemplate = true
        return image
    }

    func state() async -> [String: Any]? {
        guard config != nil else { return nil }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/state"))
        request.timeoutInterval = 2
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              json["device"] is [String: Any], json["attention"] is [String: Any] else { return nil }
        return json
    }

    func bootstrap() async {
        if await state() != nil { external = true; await poll() }
        else { start() }
    }

    func start() {
        guard child == nil, !external, !quitting, config != nil else { return }
        guard FileManager.default.isExecutableFile(atPath: config.node),
              FileManager.default.fileExists(atPath: config.root + "/dist/index.html"),
              FileManager.default.fileExists(atPath: config.root + "/bridge/server.mjs") else {
            clearBusyStatus()
            status.title = "Companion needs setup"
            status.toolTip = "Rebuild the app from your project folder"
            return
        }
        external = false
        restarting = false
        let process = Process()
        process.executableURL = URL(fileURLWithPath: config.node)
        process.arguments = ["--env-file-if-exists=\(dataFolder?.appendingPathComponent("config.env").path ?? ".env")", config.root + "/bridge/server.mjs"]
        process.currentDirectoryURL = dataFolder ?? URL(fileURLWithPath: config.root)
        var env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        env["PATH"] = config.bundled == true ? "\(home)/.local/bin:\(home)/.nix-profile/bin:\(home)/.bun/bin:\(config.path)" : config.path
        if let dataFolder {
            env["STUDIO_SETTINGS_PATH"] = dataFolder.appendingPathComponent("studio-settings.json").path
            env["DISPLAY_SETTINGS_PATH"] = dataFolder.appendingPathComponent("display-settings.json").path
            env["ROON_PAIRING_PATH"] = dataFolder.appendingPathComponent("roon-pairing.json").path
            env["COMPANION_POINTER_HELPER"] = config.root + "/.tools/bin/herdr-pointer"
        }
        env["COMPANION_NATIVE_TOKEN"] = nativeToken
        env["PORT"] = String(config.port)
        process.environment = env
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = logHandle
        process.standardError = logHandle
        process.terminationHandler = { [weak self] process in
            let code = process.terminationStatus
            Task { @MainActor in self?.exited(code) }
        }
        do {
            try process.run()
            child = process
            startedAt = Date()
            showBusyStatus("Starting Companion...")
            status.toolTip = "Connecting to your device"
        } catch { clearBusyStatus(); status.title = "Could not start Companion"; status.toolTip = error.localizedDescription }
    }

    func exited(_ code: Int32) {
        child = nil
        if quitting { quitPulse?.invalidate(); NSApp.reply(toApplicationShouldTerminate: true); return }
        if restarting { start(); return }
        if Date().timeIntervalSince(startedAt) > 60 { failures = 0 }
        failures += 1
        clearBusyStatus()
        status.title = "Bridge stopped (\(code))"
        status.toolTip = failures <= 3 ? "Restarting shortly..." : "Check Logs or restart to try again"
        if failures <= 3 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.start() }
        }
    }

    func stopChild() {
        guard let process = child, process.isRunning else { return }
        process.terminate()
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
    }

    func poll() async {
        guard !polling, !quitting else { return }
        polling = true
        defer { polling = false }
        if child != nil { await syncAppSettings() }
        let snapshot = await state()
        guard !quitting else { return }
        if let json = snapshot, let device = json["device"] as? [String: Any] {
            clearBusyStatus()
            if child == nil { external = true }
            let connected = device["status"] as? String == "connected"
            let error = device["error"] as? String
            status.title = error == nil ? (connected ? "Device connected" : "Device disconnected") : "Device needs attention"
            status.toolTip = error ?? (external ? "Bridge managed outside this app" : "Companion is running")
            let symbol = error != nil ? "exclamationmark.triangle" : (connected ? "checkmark.circle.fill" : "cable.connector")
            let color: NSColor = error != nil ? .systemOrange : (connected ? .systemGreen : .secondaryLabelColor)
            status.image = menuIcon(symbol)?.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [color]))
            status.image?.isTemplate = false
            item.button?.toolTip = status.title
        } else if external {
            external = false
            start()
        } else if child != nil { showBusyStatus("Starting Companion...") }
    }

    func menuWillOpen(_ menu: NSMenu) {
        guard !quitting else { return }
        #if SPARKLE
        updatesItem.isEnabled = updater.updater.canCheckForUpdates
        #endif
        restartItem.isEnabled = !external && !restarting && config != nil
    }
    @objc func openDevice() {
        if config != nil { NSWorkspace.shared.open(URL(string: "#device", relativeTo: baseURL)!.absoluteURL) }
    }
    @objc func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Companion",
            .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown",
            .version: "",
            .credits: NSAttributedString(string: "Your desk companion for agents, updates and everyday tools.")
        ])
    }
    @objc func checkForUpdates() {
        NSApp.activate(ignoringOtherApps: true)
        #if SPARKLE
        updater.checkForUpdates(nil)
        #else
        let alert = NSAlert()
        alert.messageText = "Updates require a release build"
        alert.informativeText = "This is a local development build. Install a signed Companion release to receive automatic updates."
        alert.addButton(withTitle: "OK")
        alert.runModal()
        #endif
    }
    @objc func openDashboard() { if config != nil { NSWorkspace.shared.open(baseURL) } }
    @objc func openSettings() {
        if config != nil { NSWorkspace.shared.open(URL(string: "#app-settings", relativeTo: baseURL)!.absoluteURL) }
    }
    @objc func openLogs() {
        Task {
            if await state() != nil {
                NSWorkspace.shared.open(URL(string: "#logs", relativeTo: baseURL)!.absoluteURL)
            } else if let url = logURL { NSWorkspace.shared.open(url) }
        }
    }
    @objc func restart() {
        guard !external else { return }
        failures = 0
        if child != nil { restarting = true; stopChild() } else { start() }
    }
    func syncAppSettings() async {
        guard !quitting else { return }
        var state: [String: Any] = [
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown",
            "launchAtLogin": SMAppService.mainApp.status == .enabled,
            "loginNeedsApproval": SMAppService.mainApp.status == .requiresApproval,
            "updatesAvailable": false
        ]
        #if SPARKLE
        state["updatesAvailable"] = true
        state["automaticallyChecksForUpdates"] = updater.updater.automaticallyChecksForUpdates
        state["automaticallyDownloadsUpdates"] = updater.updater.automaticallyDownloadsUpdates
        #endif
        if let nativeResult { state["result"] = nativeResult }
        var request = URLRequest(url: baseURL.appendingPathComponent("api/native/sync"))
        request.httpMethod = "POST"
        request.timeoutInterval = 2
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(nativeToken, forHTTPHeaderField: "X-Companion-Token")
        request.httpBody = try? JSONSerialization.data(withJSONObject: state)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        guard !quitting else { return }
        guard let command = json["command"] as? [String: Any], let id = command["id"] as? String,
              let action = command["action"] as? String else { return }
        if nativeResult?["id"] as? String == id { return }
        var result: [String: Any] = ["id": id]
        do {
            switch action {
            case "launchAtLogin":
                if command["value"] as? Bool == true {
                    if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
                } else { try await SMAppService.mainApp.unregister() }
            case "openLoginSettings": SMAppService.openSystemSettingsLoginItems()
            case "about": showAbout()
            #if SPARKLE
            case "automaticallyChecksForUpdates": updater.updater.automaticallyChecksForUpdates = command["value"] as? Bool == true
            case "automaticallyDownloadsUpdates": updater.updater.automaticallyDownloadsUpdates = command["value"] as? Bool == true
            case "checkForUpdates": checkForUpdates()
            #endif
            default: result["error"] = "This setting is unavailable in this build."
            }
        } catch { result["error"] = error.localizedDescription }
        nativeResult = result
        // Acknowledge immediately with the actual OS/updater state.
        await syncAppSettings()
    }
    @objc func quitApp() { NSApp.terminate(nil) }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if quitting { return child?.isRunning == true ? .terminateLater : .terminateNow }
        quitting = true
        timer?.invalidate()
        showBusyStatus("Quitting Companion...")
        status.toolTip = "Closing the device connection and background services"
        item.button?.toolTip = status.title
        item.button?.setAccessibilityLabel(status.title)
        for entry in item.menu?.items ?? [] { entry.isEnabled = false }
        guard let child, child.isRunning else { return .terminateNow }
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            let started = Date()
            let pulse = Timer(timeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
                MainActor.assumeIsolated {
                    let phase = Date().timeIntervalSince(started) * .pi * 2 / 1.2
                    self?.item.button?.alphaValue = 0.7 + 0.3 * cos(phase)
                }
            }
            quitPulse = pulse
            RunLoop.main.add(pulse, forMode: .common)
        }
        // Keep AppKit responsive until the process termination handler replies.
        stopChild()
        return .terminateLater
    }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    application.setActivationPolicy(.accessory)
    let delegate = CompanionApp()
    application.delegate = delegate
    application.run()
}
