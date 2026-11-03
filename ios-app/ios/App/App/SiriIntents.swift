import AppIntents
import Foundation

/// Siri commands for halo.je Studio. They talk to the Studio server with this phone's device key,
/// so they work without opening the app. Say, for example, "Clock on in Studio".
@available(iOS 16.0, *)
enum StudioSiri {
    private struct Config: Codable { var apiUrl: String; var deviceKey: String; var enabled: Bool; var radius: Double }

    static func stamp() -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_GB_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.string(from: Date())
    }

    static func call(_ path: String, _ body: [String: Any] = [:]) async -> String {
        guard let data = UserDefaults.standard.data(forKey: "halo.sw.cfg"),
              let c = try? JSONDecoder().decode(Config.self, from: data),
              !c.apiUrl.isEmpty, !c.deviceKey.isEmpty else {
            return "Open Studio once and sign in, then try again."
        }
        let base = c.apiUrl.replacingOccurrences(of: "/functions/v1/api", with: "/functions/v1/siri")
        guard let url = URL(string: base + path) else { return "Studio isn't set up yet." }
        var req = URLRequest(url: url, timeoutInterval: 20)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(c.deviceKey, forHTTPHeaderField: "X-Device-Key")
        var b = body; b["at"] = stamp()
        req.httpBody = try? JSONSerialization.data(withJSONObject: b)
        do {
            let (d, _) = try await URLSession.shared.data(for: req)
            let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
            if let m = j?["message"] as? String { return m }
            if let e = (j?["error"] as? [String: Any])?["message"] as? String { return e }
            return "Done."
        } catch {
            return "I couldn't reach Studio. Check your signal and try again."
        }
    }
}

@available(iOS 16.0, *)
struct ClockOnIntent: AppIntent {
    static var title: LocalizedStringResource = "Clock on"
    static var description = IntentDescription("Clock on to today's job in Studio.")
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await StudioSiri.call("/clock", ["action": "on"])))
    }
}

@available(iOS 16.0, *)
struct ClockOffIntent: AppIntent {
    static var title: LocalizedStringResource = "Clock off"
    static var description = IntentDescription("Clock off and log the time to the job in Studio.")
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await StudioSiri.call("/clock", ["action": "off"])))
    }
}

@available(iOS 16.0, *)
struct AddTodoIntent: AppIntent {
    static var title: LocalizedStringResource = "Add a to-do"
    static var description = IntentDescription("Add a to-do in Studio. Say “tomorrow” to set it for tomorrow.")
    @Parameter(title: "To-do", requestValueDialog: "What do you need to do?")
    var text: String
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await StudioSiri.call("/todo", ["text": text])))
    }
}

@available(iOS 16.0, *)
struct MyDayIntent: AppIntent {
    static var title: LocalizedStringResource = "What's my day"
    static var description = IntentDescription("Hear today's visits and to-dos from Studio.")
    func perform() async throws -> some IntentResult & ProvidesDialog {
        .result(dialog: IntentDialog(stringLiteral: await StudioSiri.call("/day")))
    }
}

@available(iOS 16.0, *)
struct StudioShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ClockOnIntent(), phrases: ["Clock on in \(.applicationName)", "\(.applicationName) clock on", "Start the clock in \(.applicationName)"])
        AppShortcut(intent: ClockOffIntent(), phrases: ["Clock off in \(.applicationName)", "\(.applicationName) clock off", "Stop the clock in \(.applicationName)"])
        AppShortcut(intent: AddTodoIntent(), phrases: ["Add a to-do in \(.applicationName)", "Add a \(.applicationName) to-do", "New \(.applicationName) to-do"])
        AppShortcut(intent: MyDayIntent(), phrases: ["What's my day in \(.applicationName)", "\(.applicationName) what's my day", "What's on today in \(.applicationName)"])
    }
}
