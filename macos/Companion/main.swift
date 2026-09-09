import AppKit
import ServiceManagement
#if SPARKLE
import Sparkle
#endif

#if SPARKLE
final class GentleUpdateDriver: NSObject, SPUStandardUserDriverDelegate {
    var availabilityChanged: (@MainActor (Bool) -> Void)?
    var supportsGentleScheduledUpdateReminders: Bool { true }

    func standardUserDriverShouldHandleShowingScheduledUpdate(
        _ update: SUAppcastItem, andInImmediateFocus immediateFocus: Bool
    ) -> Bool { false }

    func standardUserDriverWillHandleShowingUpdate(
        _ handleShowingUpdate: Bool, forUpdate update: SUAppcastItem,
        state: SPUUserUpdateState
    ) {
        guard !handleShowingUpdate else { return }
        DispatchQueue.main.async { self.availabilityChanged?(true) }
    }

    func standardUserDriverWillFinishUpdateSession() {
        DispatchQueue.main.async { self.availabilityChanged?(false) }
    }

    func standardUserDriverDidReceiveUserAttention(forUpdate update: SUAppcastItem) {
        DispatchQueue.main.async { self.availabilityChanged?(false) }
    }
}
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
    let updateReminder = NSMenuItem(title: "A new update is available...", action: #selector(checkForUpdates), keyEquivalent: "")
    let updateSeparator = NSMenuItem.separator()
    var updateBadge: NSView?
    var aboutWindow: NSWindow?
    var config: Configuration!
    var dataFolder: URL?
    #if SPARKLE
    let updateDriver = GentleUpdateDriver()
    lazy var updater = SPUStandardUpdaterController(startingUpdater: true, updaterDelegate: nil, userDriverDelegate: updateDriver)
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
        item.button?.image = Self.menuBarImage()
        item.button?.setAccessibilityLabel("Companion")
        if let button = item.button {
            let dot = NSView()
            dot.wantsLayer = true
            dot.layer?.backgroundColor = NSColor.systemOrange.cgColor
            dot.layer?.cornerRadius = 2.5
            dot.isHidden = true
            dot.translatesAutoresizingMaskIntoConstraints = false
            button.addSubview(dot)
            NSLayoutConstraint.activate([
                dot.widthAnchor.constraint(equalToConstant: 5),
                dot.heightAnchor.constraint(equalToConstant: 5),
                dot.centerXAnchor.constraint(equalTo: button.centerXAnchor, constant: 7.5),
                dot.centerYAnchor.constraint(equalTo: button.centerYAnchor, constant: -6.5)
            ])
            updateBadge = dot
        }
        let menu = NSMenu()
        menu.delegate = self
        menu.autoenablesItems = false
        updateReminder.target = self
        updateReminder.image = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
            NSColor.systemOrange.setFill()
            NSBezierPath(ovalIn: NSRect(x: 5, y: 5, width: 6, height: 6)).fill()
            return true
        }
        updateReminder.isHidden = true
        updateSeparator.isHidden = true
        menu.addItem(updateReminder)
        menu.addItem(updateSeparator)
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
        restartItem.keyEquivalentModifierMask = [.command]
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
        #if SPARKLE
        updateDriver.availabilityChanged = { [weak self] available in
            self?.setUpdateAvailable(available)
        }
        _ = updater
        #endif
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
            let statusTimer = Timer(timeInterval: 3, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.poll() }
            }
            timer = statusTimer
            RunLoop.main.add(statusTimer, forMode: .common)
        } catch { clearBusyStatus(); status.title = "Setup failed"; status.toolTip = error.localizedDescription }
    }

    static func menuBarImage(badged: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setFill()
            for (x, y, height) in [(4.8, 8.0, 9.0), (12.7, 10.0, 8.0)] {
                let eye = NSBezierPath(roundedRect: NSRect(x: -1.575, y: -height / 2, width: 3.15, height: height), xRadius: 1.575, yRadius: 1.575)
                let tilt = AffineTransform(rotationByDegrees: 16)
                eye.transform(using: tilt)
                eye.transform(using: AffineTransform(translationByX: x, byY: y))
                eye.fill()
            }
            if badged {
                NSGraphicsContext.current?.compositingOperation = .destinationOut
                NSBezierPath(ovalIn: NSRect(x: 13, y: 12, width: 7, height: 7)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }

    func setUpdateAvailable(_ available: Bool) {
        guard !quitting else { return }
        updateReminder.isHidden = !available
        updateSeparator.isHidden = !available
        updateBadge?.isHidden = !available
        item.button?.image = Self.menuBarImage(badged: available)
        item.button?.setAccessibilityLabel(available ? "Companion, update available" : "Companion")
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
        label.textColor = .disabledControlTextColor
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
            RunLoop.main.perform(inModes: [.common]) {
                MainActor.assumeIsolated { self?.exited(code) }
            }
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
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 5) {
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
            if child == nil { external = true }
            let deviceState = device["status"] as? String
            let connected = deviceState == "connected"
            let connection = device["connection"] as? [String: Any]
            let error = device["error"] as? String ?? connection?["error"] as? String
            if !connected && error == nil && (connection == nil || connection?["scanning"] as? Bool == true || deviceState == "connecting" || deviceState == "waiting") {
                showBusyStatus("Connecting to device...")
                return
            }
            clearBusyStatus()
            let browserOnly = connection?["mode"] as? String == "off"
            status.title = error == nil ? (connected ? "Device connected" : browserOnly ? "Browser only" : "Device disconnected") : "Device needs attention"
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
        updateReminder.isEnabled = updater.updater.canCheckForUpdates
        #endif
        restartItem.isEnabled = !external && !restarting && config != nil
    }
    @objc func openDevice() {
        if config != nil { NSWorkspace.shared.open(URL(string: "#device", relativeTo: baseURL)!.absoluteURL) }
    }
    @objc func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        if let aboutWindow { aboutWindow.makeKeyAndOrderFront(nil); return }
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 437),
                              styleMask: [.titled, .closable, .fullSizeContentView],
                              backing: .buffered, defer: false)
        window.title = "About Companion"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        let content = NSView()
        window.contentView = content

        func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular,
                   color: NSColor = .labelColor) -> NSTextField {
            let field = NSTextField(wrappingLabelWithString: text)
            field.font = .systemFont(ofSize: size, weight: weight)
            field.textColor = color
            field.alignment = .center
            field.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(field)
            return field
        }
        let icon = NSImageView()
        icon.image = NSApp.applicationIconImage
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(icon)
        let name = label("Companion", size: 22, weight: .bold)
        let description = label("Your desk companion for agents,\nupdates and everyday tools.", size: 11, color: .secondaryLabelColor)
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? version
        let commit = Bundle.main.object(forInfoDictionaryKey: "CompanionCommit") as? String
        func detailField(_ text: String, monospaced: Bool = false) -> NSTextField {
            let field = NSTextField(labelWithString: text)
            field.font = monospaced ? .monospacedSystemFont(ofSize: 12, weight: .regular) : .systemFont(ofSize: 12)
            field.textColor = monospaced ? .secondaryLabelColor : .labelColor
            return field
        }
        let commitButton = NSButton(title: commit.map { String($0.prefix(8)) } ?? "Local build",
                                    target: self, action: #selector(openCommit))
        commitButton.isBordered = false
        commitButton.focusRingType = .none
        commitButton.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        commitButton.contentTintColor = commit == nil ? .secondaryLabelColor : .linkColor
        commitButton.isEnabled = commit != nil
        commitButton.setAccessibilityLabel(commit.map { "View commit " + String($0.prefix(8)) + " on GitHub" } ?? "Local build")
        let details = NSGridView(views: [
            [detailField("Version"), detailField(version, monospaced: true)],
            [detailField("Build"), detailField(build, monospaced: true)],
            [detailField("Commit"), commitButton]
        ])
        details.columnSpacing = 8
        details.rowSpacing = 2
        details.column(at: 0).xPlacement = .trailing
        details.column(at: 1).xPlacement = .leading
        details.rowAlignment = .firstBaseline
        details.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(details)
        let docs = NSButton(title: "Docs", target: self, action: #selector(openDocs))
        let github = NSButton(title: "GitHub", target: self, action: #selector(openGitHub))
        for button in [docs, github] {
            button.bezelStyle = .rounded
            button.controlSize = .large
        }
        let links = NSStackView(views: [docs, github])
        links.orientation = .horizontal
        links.spacing = 8
        links.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(links)
        NSLayoutConstraint.activate([
            icon.topAnchor.constraint(equalTo: content.topAnchor, constant: 80),
            icon.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            icon.widthAnchor.constraint(equalToConstant: 108), icon.heightAnchor.constraint(equalToConstant: 108),
            name.topAnchor.constraint(equalTo: icon.bottomAnchor, constant: 20),
            name.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            description.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 8),
            description.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            description.widthAnchor.constraint(equalToConstant: 260),
            details.topAnchor.constraint(equalTo: description.bottomAnchor, constant: 30),
            details.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            links.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -30),
            links.centerXAnchor.constraint(equalTo: content.centerXAnchor)
        ])
        window.center()
        aboutWindow = window
        window.makeKeyAndOrderFront(nil)
    }
    @objc func openDocs() {
        NSWorkspace.shared.open(URL(string: "https://github.com/ahkohd/companion#readme")!)
    }
    @objc func openGitHub() {
        NSWorkspace.shared.open(URL(string: "https://github.com/ahkohd/companion")!)
    }
    @objc func openCommit() {
        guard let commit = Bundle.main.object(forInfoDictionaryKey: "CompanionCommit") as? String,
              commit.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil else { return }
        NSWorkspace.shared.open(URL(string: "https://github.com/ahkohd/companion/commit/" + commit)!)
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
