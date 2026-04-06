const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const NATIVE_SOURCE = `#import <WebKit/WebKit.h>
#import <UIKit/UIKit.h>

@interface WebViewNoZoomDisabler : NSObject
@end

@implementation WebViewNoZoomDisabler

+ (void)load {
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(fixWebViews)
                                               name:UIApplicationDidBecomeActiveNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(fixWebViewsSoon)
                                               name:UIKeyboardDidShowNotification
                                             object:nil];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    [self fixWebViews];
  });
}

+ (void)fixWebViewsSoon {
  [self fixWebViews];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.15 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self fixWebViews];
  });
}

+ (void)fixWebViews {
  for (UIWindow *window in [UIApplication sharedApplication].windows) {
    [self fixInView:window];
  }
}

+ (void)fixInView:(UIView *)view {
  if ([view isKindOfClass:[WKWebView class]]) {
    UIScrollView *sv = [(WKWebView *)view scrollView];
    sv.minimumZoomScale = 1.0;
    sv.maximumZoomScale = 1.0;
    sv.bouncesZoom = NO;
    if (sv.zoomScale != 1.0) [sv setZoomScale:1.0 animated:NO];
  }
  for (UIView *sub in view.subviews) [self fixInView:sub];
}

@end
`;

module.exports = function withIosWebViewNoZoom(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const projectName = mod.modRequest.projectName;
      const dir = path.join(mod.modRequest.platformProjectRoot, projectName);
      const filePath = path.join(dir, "WebViewNoZoom.m");

      // Write the native file
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, NATIVE_SOURCE);

      // Add to Xcode project.pbxproj if not already there
      const pbxPath = path.join(
        mod.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        "project.pbxproj"
      );
      if (fs.existsSync(pbxPath)) {
        let pbx = fs.readFileSync(pbxPath, "utf-8");
        if (!pbx.includes("WebViewNoZoom.m")) {
          // Find the Sources build phase and add the file
          // Simple approach: add as a compile source by inserting into PBXBuildFile and PBXSourcesBuildPhase
          const fileRefId = "WVNZ000001";
          const buildFileId = "WVNZ000002";

          // Add PBXBuildFile entry
          pbx = pbx.replace(
            "/* End PBXBuildFile section */",
            `\t\t${buildFileId} /* WebViewNoZoom.m in Sources */ = {isa = PBXBuildFile; fileRef = ${fileRefId} /* WebViewNoZoom.m */; };\n/* End PBXBuildFile section */`
          );

          // Add PBXFileReference entry
          pbx = pbx.replace(
            "/* End PBXFileReference section */",
            `\t\t${fileRefId} /* WebViewNoZoom.m */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; path = WebViewNoZoom.m; sourceTree = "<group>"; };\n/* End PBXFileReference section */`
          );

          // Add to Sources build phase
          pbx = pbx.replace(
            /(\bfiles = \(\s*\n(?:\s*[A-Z0-9]+ \/\* .+ in Sources \*\/,\s*\n)*)/,
            `$1\t\t\t\t${buildFileId} /* WebViewNoZoom.m in Sources */,\n`
          );

          // Add to the main group's children
          const groupMatch = pbx.match(
            new RegExp(`(${projectName}" \\/\\*.*?\\*\\/; };\\s*\\n)(\\s*children = \\()`)
          );
          if (!groupMatch) {
            // Alternative: add to first PBXGroup children
            pbx = pbx.replace(
              /(children = \(\n)/,
              `$1\t\t\t\t${fileRefId} /* WebViewNoZoom.m */,\n`
            );
          }

          fs.writeFileSync(pbxPath, pbx);
        }
      }

      return mod;
    },
  ]);
};
