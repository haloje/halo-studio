import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers

/// JavaScript side: window.Capacitor.Plugins.SiteWatch (see docs/backend.js).
@objc(SiteWatchPlugin)
public class SiteWatchPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SiteWatchPlugin"
    public let jsName = "SiteWatch"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "askPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise)
    ]
    private var exportCall: CAPPluginCall?
    private var exportDelegate: ExportDelegate?

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

    /// Saves a file the app has written (file:// URI) wherever the user picks: a Save dialog on a Mac, Files on iPhone and iPad.
    @objc func exportFile(_ call: CAPPluginCall) {
        guard let raw = call.getString("path"), !raw.isEmpty else { call.reject("No file"); return }
        guard let url = raw.hasPrefix("file:") ? URL(string: raw) : URL(fileURLWithPath: raw) else { call.reject("Bad path"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("No view"); return }
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            let d = ExportDelegate { saved in
                call.resolve(["saved": saved])
                self.exportCall = nil; self.exportDelegate = nil
            }
            picker.delegate = d
            self.exportCall = call; self.exportDelegate = d
            vc.present(picker, animated: true)
        }
    }
}

final class ExportDelegate: NSObject, UIDocumentPickerDelegate {
    let done: (Bool) -> Void
    init(_ done: @escaping (Bool) -> Void) { self.done = done }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(true) }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done(false) }
}
