# halo.je Studio – iPhone app

A thin iPhone app around the Studio website (https://haloje.github.io/halo-studio/), plus one native
feature: **automatic clock on/off**. The app watches the addresses of today's and tomorrow's booked
visits (iOS region monitoring, max 19 sites). Arriving during a visit's time clocks on to that job;
leaving clocks off and logs the time. A notification confirms each one. It works with the app closed.

Because the app loads the website, almost every Studio change goes live without a new build.
Only changes in `ios/` or `plugins/` need a new TestFlight build.

## First build (on the iMac)

1. Install **Xcode** from the Mac App Store and open it once to finish setup.
2. Install Node.js (https://nodejs.org, LTS).
3. In Terminal:
   ```
   git clone https://github.com/haloje/halo-studio.git
   cd halo-studio/ios-app
   npm install
   npx cap sync ios
   npx cap open ios
   ```
4. In Xcode: select the **App** target → **Signing & Capabilities** → tick *Automatically manage signing*,
   choose your Apple Developer team. Bundle identifier is `je.halo.studio`.
5. Plug in the iPhone (or pick it from the device list) and press ▶︎ to try it.
6. For TestFlight: **Product → Archive**, then **Distribute App → App Store Connect → Upload**.
   In App Store Connect (appstoreconnect.apple.com) create the app first (My Apps → + → New App,
   bundle ID `je.halo.studio`), then add yourself under TestFlight → Internal Testing.

## Pieces
- `capacitor.config.json` – app id, name, and the website it loads.
- `plugins/site-watch` – the native Swift code (`SiteWatchCore.swift` does the watching and calls the server).
- `ios/App/App/AppDelegate.swift` – starts the watcher at launch so arrive/leave events work in the background.
- Server: `POST /functions/v1/api/clock` with header `X-Device-Key` (from `/device/register`, made when you switch the feature on in Studio › Jobs › Reports).
