# AI Hub — native Android client

Kotlin + Jetpack Compose. Claude-style chat is the home screen. Every AI Provider Hub collection is a full-screen page from the drawer.

There is **no bundled model catalog, no sample chats, and no seeded prompts**. The first frame is Connect. The app stays empty until `GET /api/ping` and `GET /v1/models` succeed.

This work lives on the Arena session branch `arena/01a03c3f-ai-provider-hub` (this session cannot open a second git branch).

## Open in Android Studio

1. Install [Android Studio](https://developer.android.com/studio) with SDK 35.
2. **File → Open** → `ai-provider-hub/android` (the folder with `settings.gradle.kts`, not the repo root).
3. Gradle sync. If asked for a wrapper, use **Gradle 8.9**.
4. Run on a Pixel emulator (API 34+) or a phone.

Package id: `com.aihub.android`.

## Point it at the live hub

1. Start the web hub so `/api/ping` and `/v1/models` work.
2. In the web UI create a gateway key (`ah-…`), or create one later from **Gateway keys** on a local hub.
3. Launch **AI Hub**. Paste:

   | Field | Phone on Wi‑Fi | Emulator |
   | --- | --- | --- |
   | Hub URL | `http://<pc-ip>:3000` or `https://your-domain.com` | `http://10.0.2.2:3000` |
   | Gateway key | `ah-…` | `ah-…` |

   Use the hub **root**, not `/chat`.

## Screens (drawer → Hub)

| Screen | Source |
| --- | --- |
| Chat + recents | `POST /v1/chat/completions` SSE; chats cached locally and `/api/data?key=chats` |
| Providers | `/api/data?key=providers` |
| Models + Customize | `/v1/models` + `/api/data?key=models` |
| Combos + logs | `/api/data?key=combos` + `combo_logs` |
| Compress Studio | on-device extractive compress |
| Prompts | `/api/data?key=prompts` |
| Gateway keys | `GET/POST/DELETE /api/keys` |
| Key store | `/api/data?key=keystore` |
| Cookies | cookie-mode providers from hub |
| Quota | `GET /api/quota` |
| Usage | `/api/data?key=usage` |
| Trash / Settings / backup | local + `/api/data?key=settings` |

`/api/data` and `/api/keys` work on a **local** hub (no Firebase). If the hub requires a Firebase ID token those pages show the 401 and chat via `ah-…` still works.

## Build from CLI (optional)

```bash
cd android
gradle wrapper --gradle-version 8.9
./gradlew :app:assembleDebug
```
