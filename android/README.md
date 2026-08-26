# AI Hub — native Android client

Kotlin + Jetpack Compose app that talks to **this** AI Provider Hub over the live OpenAI-compatible gateway.

There is **no bundled model catalog, no sample chats, and no seed prompts**. Until the app can reach your hub, the screen stays empty.

## Open in Android Studio

1. Install [Android Studio](https://developer.android.com/studio) (Hedgehog / Koala / Ladybug or newer) with SDK 35.
2. **File → Open** and select this folder: `ai-provider-hub/android` (the directory that contains `settings.gradle.kts`).
3. Let Gradle sync. If asked for a Gradle wrapper, use **Gradle 8.9** (matches Android Gradle Plugin 8.7).
4. Run on a Pixel emulator (API 34+) or a physical phone.

Package id: `com.aihub.android`.

## Point it at the live hub

1. Start the web hub (`npm start` / PM2 / Docker) so `GET /api/ping` and `GET /v1/models` work.
2. In the **web** app: add a provider + API key, then **More → Gateway Keys** and create a key (`ah-…`).
3. Launch **AI Hub** on the phone. First frame is the connect screen (nothing is pre-filled).
4. Enter:

   | Field | Example |
   | --- | --- |
   | Hub URL | `https://your-domain.com` or LAN `http://192.168.1.10:3000` |
   | Gateway key | `ah-…` from the web app |

   Use the **hub root**, not `/chat` and not a Vite preview URL.

5. **Connect**. The app calls `GET /api/ping` then `GET /v1/models` with `Authorization: Bearer ah-…`. Models in the picker are whatever the hub returns. Chat is `POST /v1/chat/completions` (SSE).

### Emulator vs phone

- **Physical phone on the same Wi‑Fi** as the VPS/PC: `http://<LAN-ip>:3000` (cleartext HTTP is allowed).
- **Android emulator → hub on your computer**: `http://10.0.2.2:3000` (not `localhost`).
- **Public HTTPS hub**: paste the https URL as-is.

If connect fails with an HTML page, the URL is the website path, not the API root.

## What lives where

| In this Android app | Still in the web hub |
| --- | --- |
| Connect (URL + `ah-` key) | Providers, raw API keys, custom models |
| Live model list + chat | Combos, gateway key create/revoke |
| On-device prompt/history compress, max tokens, context prompt | Compress Studio, prompt library, quota |

Drawer: New chat, Refresh models, Reconnect, Disconnect. Gear: context prompt, token limit, compress mode.

## Build from CLI (optional)

```bash
cd android
# Android Studio can generate the wrapper on first open.
# Or, with Gradle 8.9 installed:
gradle wrapper --gradle-version 8.9
./gradlew :app:assembleDebug
```

APK: `app/build/outputs/apk/debug/app-debug.apk`.
