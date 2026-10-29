import Foundation
import CoreLocation
import UserNotifications
import UIKit

/// Watches the addresses of today's job visits. When the phone arrives at one during the booked
/// time it clocks on to that job in Studio; when it leaves, it clocks off. Works with the app closed:
/// iOS relaunches the app in the background for region events, and AppDelegate calls `boot()`.
// Found from AppDelegate as "SiteWatchPlugin.SiteWatchCore".
public final class SiteWatchCore: NSObject, CLLocationManagerDelegate, UNUserNotificationCenterDelegate {
    @objc public static let shared = SiteWatchCore()
    @objc public static func boot() { _ = shared }

    struct Site: Codable { var id: String; var jobId: String; var jobNumber: String; var name: String; var address: String; var date: String; var start: String; var end: String; var lat: Double?; var lng: Double? }
    struct Config: Codable { var apiUrl: String; var deviceKey: String; var enabled: Bool; var radius: Double }

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private let store = UserDefaults.standard
    private let prefix = "hs|"
    var onEvent: ((String, [String: Any]) -> Void)?
    private var permissionDone: ((String) -> Void)?

    private override init() {
        super.init()
        manager.delegate = self
        UNUserNotificationCenter.current().delegate = self
        refreshRegions()
    }

    // MARK: stored state
    private var config: Config? {
        get { (store.data(forKey: "halo.sw.cfg")).flatMap { try? JSONDecoder().decode(Config.self, from: $0) } }
        set { store.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "halo.sw.cfg") }
    }
    private var sites: [Site] {
        get { (store.data(forKey: "halo.sw.sites")).flatMap { try? JSONDecoder().decode([Site].self, from: $0) } ?? [] }
        set { store.set(try? JSONEncoder().encode(newValue), forKey: "halo.sw.sites") }
    }
    /// Remembers coordinates for addresses so each one is only looked up once.
    private var geoCache: [String: [Double]] {
        get { store.dictionary(forKey: "halo.sw.geo") as? [String: [Double]] ?? [:] }
        set { store.set(newValue, forKey: "halo.sw.geo") }
    }
    private var inside: Set<String> {
        get { Set(store.stringArray(forKey: "halo.sw.inside") ?? []) }
        set { store.set(Array(newValue), forKey: "halo.sw.inside") }
    }

    // MARK: called from the web app
    func configure(apiUrl: String?, deviceKey: String?, enabled: Bool?, radius: Double?) {
        var c = config ?? Config(apiUrl: "", deviceKey: "", enabled: false, radius: 150)
        if let v = apiUrl { c.apiUrl = v }
        if let v = deviceKey { c.deviceKey = v }
        if let v = enabled { c.enabled = v }
        if let v = radius, v >= 50 { c.radius = v }
        config = c
        refreshRegions()
    }

    func setSites(_ list: [[String: Any]]) {
        let cache = geoCache
        sites = list.compactMap { d in
            guard let id = d["id"] as? String, let jobId = d["jobId"] as? String, let date = d["date"] as? String else { return nil }
            let address = (d["address"] as? String) ?? ""
            var s = Site(id: id, jobId: jobId, jobNumber: (d["jobNumber"] as? String) ?? "", name: (d["name"] as? String) ?? "", address: address,
                         date: date, start: (d["start"] as? String) ?? "", end: (d["end"] as? String) ?? "", lat: d["lat"] as? Double, lng: d["lng"] as? Double)
            if s.lat == nil, let c = cache[address.lowercased()], c.count == 2 { s.lat = c[0]; s.lng = c[1] }
            return s
        }
        geocodeMissing()
        refreshRegions()
    }

    func askPermission(_ done: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        let st = manager.authorizationStatus
        if st == .notDetermined { permissionDone = done; manager.requestWhenInUseAuthorization(); return }
        if st == .authorizedWhenInUse { permissionDone = done; manager.requestAlwaysAuthorization(); return }
        done(authName(st))
    }

    func status() -> [String: Any] {
        let c = config
        return ["permission": authName(manager.authorizationStatus), "enabled": c?.enabled ?? false, "linked": !(c?.deviceKey ?? "").isEmpty,
                "sites": sites.count, "located": sites.filter { $0.lat != nil }.count,
                "watching": manager.monitoredRegions.filter { $0.identifier.hasPrefix(prefix) }.count,
                "inside": Array(inside)]
    }

    // MARK: regions
    private func authName(_ s: CLAuthorizationStatus) -> String {
        switch s { case .authorizedAlways: return "always"; case .authorizedWhenInUse: return "whenInUse"; case .denied: return "denied"; case .restricted: return "restricted"; default: return "notDetermined" }
    }
    private func today(_ offset: Int = 0) -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_GB_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date().addingTimeInterval(Double(offset) * 86400))
    }
    private func nowStamp() -> String {
        let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_GB_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.string(from: Date())
    }
    private func minutes(_ t: String) -> Int? {
        let p = t.split(separator: ":").compactMap { Int($0) }; return p.count >= 1 ? p[0] * 60 + (p.count > 1 ? p[1] : 0) : nil
    }

    func refreshRegions() {
        for r in manager.monitoredRegions where r.identifier.hasPrefix(prefix) { manager.stopMonitoring(for: r) }
        guard let c = config, c.enabled, !c.deviceKey.isEmpty, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        let days = [today(), today(1)]
        var seen = Set<String>(), count = 0
        for s in sites where days.contains(s.date) {
            guard let lat = s.lat, let lng = s.lng, count < 19 else { continue }
            let key = String(format: "%.4f,%.4f", lat, lng); if seen.contains(key) { continue }; seen.insert(key)
            let radius = min(max(c.radius, 100), manager.maximumRegionMonitoringDistance)
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lng), radius: radius, identifier: prefix + key)
            region.notifyOnEntry = true; region.notifyOnExit = true
            manager.startMonitoring(for: region); count += 1
            manager.requestState(for: region)
        }
    }

    private func geocodeMissing() {
        guard let s = sites.first(where: { $0.lat == nil && !$0.address.isEmpty && geoFailed[$0.address.lowercased()] == nil }) else { return }
        let address = s.address.replacingOccurrences(of: "\n", with: ", ")
        geocoder.geocodeAddressString(address.lowercased().contains("jersey") ? address : address + ", Jersey") { [weak self] marks, _ in
            guard let self = self else { return }
            let key = s.address.lowercased()
            if let loc = marks?.first?.location {
                var cache = self.geoCache; cache[key] = [loc.coordinate.latitude, loc.coordinate.longitude]; self.geoCache = cache
                self.sites = self.sites.map { var x = $0; if x.address.lowercased() == key { x.lat = loc.coordinate.latitude; x.lng = loc.coordinate.longitude }; return x }
                self.refreshRegions()
            } else { self.geoFailed[key] = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.geocodeMissing() }
        }
    }
    private var geoFailed: [String: Bool] = [:]

    /// The visit at this place that is happening now (from 90 minutes before its start to 3 hours after its end).
    private func visitNow(for region: CLRegion) -> Site? {
        let key = String(region.identifier.dropFirst(prefix.count)), day = today()
        let now = minutes(String(nowStamp().suffix(5))) ?? 0
        return sites.filter { s in
            guard s.date == day, let lat = s.lat, let lng = s.lng, String(format: "%.4f,%.4f", lat, lng) == key else { return false }
            let a = (minutes(s.start) ?? 0) - 90, b = (minutes(s.end) ?? 24 * 60) + 180
            return now >= a && now <= b
        }.sorted { (minutes($0.start) ?? 0) < (minutes($1.start) ?? 0) }.first
    }

    private func arrived(_ region: CLRegion) {
        guard region.identifier.hasPrefix(prefix), let s = visitNow(for: region) else { return }
        if inside.contains(region.identifier) { return }
        var i = inside; i.insert(region.identifier); inside = i
        store.set([s.jobId, s.jobNumber, s.name], forKey: "halo.sw.job." + region.identifier)
        send(action: "on", jobId: s.jobId, label: s.name)
    }
    private func left(_ region: CLRegion) {
        guard region.identifier.hasPrefix(prefix), inside.contains(region.identifier) else { return }
        var i = inside; i.remove(region.identifier); inside = i
        guard let saved = store.stringArray(forKey: "halo.sw.job." + region.identifier), saved.count >= 3 else { return }
        send(action: "off", jobId: saved[0], label: saved[2])
    }

    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) { arrived(region) }
    public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) { left(region) }
    public func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        if state == .inside { arrived(region) } else if state == .outside { left(region) }
    }
    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let st = manager.authorizationStatus
        if st == .authorizedWhenInUse, permissionDone != nil { manager.requestAlwaysAuthorization(); return }
        if st != .notDetermined, let done = permissionDone { permissionDone = nil; done(authName(st)) }
        refreshRegions()
        onEvent?("status", status())
    }

    // MARK: talk to Studio
    private func send(action: String, jobId: String, label: String) {
        guard let c = config, !c.apiUrl.isEmpty, !c.deviceKey.isEmpty, let url = URL(string: c.apiUrl + "/clock") else { return }
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "clock") { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        var req = URLRequest(url: url, timeoutInterval: 25)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(c.deviceKey, forHTTPHeaderField: "X-Device-Key")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["jobId": jobId, "action": action, "at": nowStamp()])
        URLSession.shared.dataTask(with: req) { [weak self] data, resp, _ in
            let j = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            let msg = ok ? ((j["message"] as? String) ?? "Updated \(label).")
                         : (((j["error"] as? [String: Any])?["message"] as? String) ?? "Couldn't \(action == "on" ? "clock on at" : "clock off at") \(label). Open Studio to check.")
            self?.notify(title: action == "on" ? "Arrived on site" : "Left site", body: msg)
            DispatchQueue.main.async { self?.onEvent?("clock", ["action": action, "jobId": jobId, "ok": ok, "message": msg]) }
            if task != .invalid { UIApplication.shared.endBackgroundTask(task); task = .invalid }
        }.resume()
    }

    private func notify(title: String, body: String) {
        let content = UNMutableNotificationContent(); content.title = title; content.body = body; content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
    }
    public func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
