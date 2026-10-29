import Foundation
import Capacitor

/// JavaScript side: window.Capacitor.Plugins.SiteWatch (see docs/backend.js).
@objc(SiteWatchPlugin)
public class SiteWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SiteWatchPlugin"
    public let jsName = "SiteWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise)
    ]

    public override func load() {
        SiteWatchCore.shared.onEvent = { [weak self] name, data in self?.notifyListeners(name, data: data) }
    }

    @objc func configure(_ call: CAPPluginCall) {
        let o = call.options ?? [:]
        DispatchQueue.main.async {
            SiteWatchCore.shared.configure(apiUrl: o["apiUrl"] as? String, deviceKey: o["deviceKey"] as? String,
                                           enabled: o["enabled"] as? Bool, radius: (o["radius"] as? NSNumber)?.doubleValue)
            call.resolve(SiteWatchCore.shared.status())
        }
    }

    @objc func setSites(_ call: CAPPluginCall) {
        let list = (call.options?["sites"] as? [[String: Any]]) ?? []
        DispatchQueue.main.async {
            SiteWatchCore.shared.setSites(list)
            call.resolve(SiteWatchCore.shared.status())
        }
    }

    @objc func askPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            SiteWatchCore.shared.askPermission { _ in call.resolve(SiteWatchCore.shared.status()) }
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(SiteWatchCore.shared.status()) }
    }
}
