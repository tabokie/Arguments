# Arguments

Arguments uses AI to highlight arguments and discover novelty on web pages.

**Highlight arguments.** Mark the sentences that express substantive ideas or claims, regardless of novelty. Identify distinct arguments across unrelated discussions and within individual blocks of text, without limiting the number of highlights. Select the claims themselves, excluding background, intermediate reasoning, and supporting material unless those passages express independent ideas.

**Discover novelty.** Briefly point out novel or insightful content that a reader might miss from highlights alone, explaining what makes the content valuable.

Based on [AI Summary Helper](https://github.com/philffm/ai-summary-helper).

## Install and build

Requires Git, Node.js, and npm. Clone the repository and install dependencies:

```bash
git clone https://github.com/tabokie/Arguments.git
cd Arguments
npm ci
```

### Chrome / Edge / Opera / Brave

```bash
npm run build
```

Open the browser's extensions page (`chrome://extensions` in Chrome or `edge://extensions` in Edge), enable **Developer mode**, and choose **Load unpacked**. Select `plugin/dev/aish-extension-chrome/`. See [Chrome's manual installation guide](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

After changing the source, rebuild, reload the extension from the extensions page, and refresh the webpage.

### Firefox

```bash
npm run build:firefox
```

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `plugin/dev/aish-extension-firefox/manifest.json`. [Temporary installations](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/) must be loaded again after restarting Firefox.

### Safari (macOS / iOS)

Requires macOS and Xcode. Build the extension and generate an Xcode project:

```bash
npm run build:ios
xcrun safari-web-extension-converter ./plugin/dev/aish-extension-ios \
  --project-location plugin/dist/ios \
  --app-name "Arguments" \
  --bundle-identifier "com.example.arguments" \
  --copy-resources
```

Replace `com.example.arguments` with a unique bundle identifier. In Xcode, select the same signing team for the containing app and extension. The extension's bundle identifier must begin with the containing app's bundle identifier. Build and run the appropriate macOS or iOS target. See [Apple's Safari packaging guide](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari).

On macOS, allow unsigned extensions in Safari's developer settings when using an unsigned build, then enable the extension under **Safari → Settings → Extensions**. On iOS, open Safari's **Manage Extensions** menu and enable the extension. Allow website access when prompted.
