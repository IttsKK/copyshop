import Cocoa
import WebKit

// usage: wkrun <url> <steps.json> <outdir> [w] [h]
// steps: [{"js": "...", "wait": 1.5, "shot": "name"}]
let args = CommandLine.arguments
let url = URL(string: args[1])!
let steps = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: args[2]))) as! [[String: Any]]
let outdir = args[3]
let W = args.count > 4 ? Double(args[4])! : 1600
let H = args.count > 5 ? Double(args[5])! : 1000

class D: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
  var win: NSWindow!; var wv: WKWebView!; var i = 0
  func applicationDidFinishLaunching(_ n: Notification) {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .nonPersistent()
    wv = WKWebView(frame: NSRect(x: 0, y: 0, width: W, height: H), configuration: cfg)
    wv.navigationDelegate = self; wv.uiDelegate = self
    let sel = NSSelectorFromString("_setWindowOcclusionDetectionEnabled:")
    if wv.responds(to: sel) { wv.perform(sel, with: false) }
    win = NSWindow(contentRect: NSRect(x: -5000, y: -5000, width: W, height: H), styleMask: [.borderless], backing: .buffered, defer: false)
    win.contentView = wv; win.orderBack(nil)
    wv.load(URLRequest(url: url))
    DispatchQueue.main.asyncAfter(deadline: .now() + (Double(ProcessInfo.processInfo.environment["WKTIMEOUT"] ?? "120") ?? 120)) { exit(2) }
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { if i == 0 { DispatchQueue.main.asyncAfter(deadline: .now() + 3) { self.next() } } }
  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler c: @escaping () -> Void) { print("ALERT:", m); c() }
  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler c: @escaping (Bool) -> Void) { print("CONFIRM:", m); c(true) }
  func next() {
    if i >= steps.count { exit(0) }
    let s = steps[i]; i += 1
    let js = s["js"] as? String ?? ""
    let wait = s["wait"] as? Double ?? 0.5
    let run = {
      DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
        if let shot = s["shot"] as? String {
          self.wv.takeSnapshot(with: nil) { img, err in
            if let img = img, let t = img.tiffRepresentation, let r = NSBitmapImageRep(data: t), let p = r.representation(using: .png, properties: [:]) {
              try! p.write(to: URL(fileURLWithPath: outdir + "/" + shot + ".png"))
            } else { print("shot err", err as Any) }
            self.next()
          }
        } else { self.next() }
      }
    }
    if js.isEmpty { run() } else {
      wv.evaluateJavaScript(js) { r, e in
        if let r = r { print("JS[\(self.i)]:", r) }
        if let e = e { print("JSERR[\(self.i)]:", e) }
        run()
      }
    }
  }
}
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let d = D(); app.delegate = d; app.run()
