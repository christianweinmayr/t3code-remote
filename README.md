# T3 Code Remote

Use [T3 Code](https://github.com/pingdotgg/t3code) from your iPad. Connect to T3 Code instances running on your dev machines over your local network, Tailscale, or any VPN.

T3 Code Remote is a React Native app that wraps the T3 Code web UI in a native shell with connection management, QR code pairing, and a remote file browser for opening projects.

## How it works

```
  iPad                              Dev Machine
 ┌──────────────────┐              ┌────────────────────────────┐
 │                  │              │                            │
 │  ┌────────────┐  │   WebView   │  T3 Code server (:3773)    │
 │  │  T3 Code   │──│────────────▶│  AI chat, terminal, git    │
 │  │  Web UI    │  │              │                            │
 │  └────────────┘  │              ├────────────────────────────┤
 │                  │              │                            │
 │  ┌────────────┐  │  REST API   │  Companion server (:3774)  │
 │  │  File      │──│────────────▶│  File browsing, pairing,   │
 │  │  Browser   │  │              │  project creation          │
 │  └────────────┘  │              │                            │
 │                  │              └────────────────────────────┘
 └──────────────────┘
```

The companion server runs alongside T3 Code on your dev machine. It handles:

- **QR code pairing** with one-time codes for secure device enrollment
- **Auto-starting T3 Code** with remote access enabled
- **Remote file browsing** so you can open projects from the iPad
- **Project creation** via T3 Code's WebSocket RPC

The iPad app connects to the companion, authenticates via QR scan, and loads the full T3 Code web UI in a WebView with touch-optimized fixes (long-press context menus, always-visible buttons, etc).

## Quick start

### 1. On your dev machine

Make sure you have [Bun](https://bun.sh) installed, then:

```bash
git clone https://github.com/christianweinmayr/t3code-remote.git
cd t3code-remote/apps/companion
bun install
bun run start
```

This will:
- Start a T3 Code instance on port 3773 (if not already running)
- Start the companion server on port 3774
- Open your browser with a network interface picker

### 2. Choose your network

The browser shows all available network interfaces:

| Interface | When to use |
|-----------|-------------|
| **Wi-Fi** | iPad and Mac on the same local network |
| **Tailscale** | Accessing your machine from anywhere via Tailscale VPN |
| **VPN** | Any other VPN connection |

Pick the network your iPad can reach, and a QR code appears.

### 3. Pair your iPad

Open **T3 Code Remote** on your iPad, tap **+ Pair**, and scan the QR code. The app will:
- Exchange the one-time pairing code for a session token
- Save the connection with the correct host, ports, and credentials
- Show the server in your connection list

### 4. Start coding

Tap the connection to open T3 Code. You get the full web UI with all features:
- Chat with Claude and Codex agents
- Integrated terminal
- Git operations and diff viewing
- Project switching

## Features

### Connection management
- Multiple saved connections with status indicators (online/offline)
- Pull-to-refresh to check server status
- Swipe or tap X to delete connections

### Remote file browser
- Browse your dev machine's filesystem from the iPad
- Sort by name or last modified
- Create new folders
- Open any folder as a T3 Code project
- Quick-access bookmarks for common directories (~/Projects, ~/Code, etc.)

### Touch optimizations
- Long-press triggers right-click context menus
- Hover-only UI elements (like the new thread button) are always visible
- Native iOS back navigation

### Security
- One-time pairing codes that expire after 5 minutes
- Session tokens for authenticated API access
- Filesystem access restricted to home directory
- T3 Code auth tokens kept server-side, never exposed to clients

## Companion server options

```
bun run start -- [options]

Options:
  --port <number>      Companion server port (default: 3774)
  --t3-port <number>   T3 Code server port (default: 3773)
  --host <address>     Bind address (default: 0.0.0.0)
  --no-t3              Don't auto-start T3 Code
  --no-open            Don't open browser on startup
```

## Companion server API

All `/api/*` endpoints require `Authorization: Bearer <session-token>` obtained through QR pairing.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status |
| `/pair` | GET | Network interface picker (HTML) |
| `/pair/qr?ip=<addr>` | GET | QR code page with one-time code (HTML) |
| `/api/pair/redeem` | POST | Exchange pairing code for session token |
| `/api/discover` | GET | Find running T3 Code instances |
| `/api/fs/list?path=~` | GET | Browse directories |
| `/api/fs/quick-paths` | GET | Common dev directories |
| `/api/fs/mkdir` | POST | Create a new folder |
| `/api/fs/scan-projects` | GET | Find project roots |
| `/api/project/create` | POST | Create project in T3 Code |
| `/api/project/list` | GET | List T3 Code projects |

## Project structure

```
apps/
  companion/          Companion server (Bun + TypeScript)
    src/
      index.ts          HTTP server, auto-start, browser open
      pair.ts           QR pairing with one-time codes
      discovery.ts      Auto-detect running T3 Code instances
      filesystem.ts     Remote directory browsing with path validation
      t3bridge.ts       WebSocket RPC bridge to T3 Code

  mobile/             iPad app (React Native + Expo)
    app/
      _layout.tsx       Root layout
      index.tsx         Connection list (home screen)
      scan.tsx          QR code scanner for pairing
      connect/[id].tsx  WebView with T3 Code UI
      browse/[id].tsx   Remote file browser
    src/lib/
      connections.ts    Connection storage
      api.ts            Companion & T3 Code API client
```

## Development

### Companion server

```bash
cd apps/companion
bun install
bun run dev          # hot reload
```

### iPad app

```bash
cd apps/mobile
npm install
npx expo prebuild --platform ios
cd ios && pod install && cd ..

# Debug build (requires Metro)
npx expo start --dev-client

# Release build (standalone)
# Set scheme to Release in Xcode, then Cmd+R
```

### Building for your iPad

1. Open `apps/mobile/ios/T3CodeRemote.xcworkspace` in Xcode
2. Select your development team in Signing & Capabilities
3. Change the scheme's Run configuration to **Release**
4. Connect your iPad and press **Cmd+R**

## Requirements

- **Dev machine**: macOS/Linux with [Bun](https://bun.sh) and [T3 Code](https://github.com/pingdotgg/t3code)
- **iPad**: iOS 16+ with T3 Code Remote installed
- **Network**: Both devices on the same network, or connected via Tailscale/VPN

## License

[CC BY-NC 4.0](LICENSE) — free to use and modify for non-commercial purposes.
