# GravitLauncher Architecture Research — for a Tauri-based Runtime Replacement

Research date: 2026-06-15. Target: replace the JavaFX `LauncherRuntime` GUI with a Tauri (Rust + webview) front-end while reusing the Java core (auth protocol, file download/hash verification, JVM launch, security guard).

All facts below were verified against the actual source on GitHub (master branch) via the GitHub API and `raw.githubusercontent.com`. Uncertain items are flagged explicitly.

---

## 0. TL;DR of the most important finding

**The GravitLauncher team has already shipped a Tauri 2 + Rust + Svelte program in their own org**: `LauncherPrestarter`, branch [`rust/5.7.x`](https://github.com/GravitLauncher/LauncherPrestarter/tree/rust/5.7.x). It is a "prestarter": a small Rust/Tauri exe that downloads a JRE (BellSoft Liberica JRE-full v25) and then `spawn`s `javaw -jar Launcher.jar`. It does **not** replace the GUI — it bootstraps the existing JavaFX launcher. But it is direct, authoritative prior art for the Rust↔Java sidecar pattern, JRE provisioning, and Tauri bundling, by the same team.

The core is cleanly layered behind one GUI-agnostic facade interface: **`pro.gravit.launcher.core.backend.LauncherBackendAPI`** (in `launcher-core`), implemented by **`LauncherBackendImpl`** (in `launcher-runtime`). The JavaFX runtime drives only this interface plus a tiny `RuntimeProvider` SPI. That facade is the contract a Tauri front-end must drive.

---

## 1. Module map

### Repositories (GitHub org `GravitLauncher`)
| Repo | Role | License | Current version (Jun 2026) |
|---|---|---|---|
| [`Launcher`](https://github.com/GravitLauncher/Launcher) | Core monorepo (LaunchServer + launcher core + client + API) | **GPL-3.0** | **v5.7.12** (May 29 2026) |
| [`LauncherRuntime`](https://github.com/GravitLauncher/LauncherRuntime) | The JavaFX GUI module (the thing being replaced) | **MIT** | **v5.0.8** (Mar 29 2026) |
| [`LauncherModules`](https://github.com/GravitLauncher/LauncherModules) | Optional LaunchServer/launcher modules (Sentry, etc.) | mixed | tracks core |
| [`LauncherPrestarter`](https://github.com/GravitLauncher/LauncherPrestarter) | JRE bootstrapper. **`rust/5.7.x` = Tauri/Rust/Svelte** | (see §7) | rust branch active |

`5.x is the modern line` — confirmed. Current stable core is **5.7.x**; the "modern core" rewrite (the `LauncherBackendAPI` facade, `pro.gravit.launcher.core.*`) is what 5.x ships. (Note: the legacy Maven artifact `pro.gravit.launcher:launcher-modern-core` is frozen at 5.5.4; the live build now publishes under `com.gravitlauncher.launcher:launcher-runtime`, see §2/§7.)

### The `Launcher` monorepo (Gradle, Kotlin DSL, Java 21)
`settings.gradle.kts` auto-includes every dir under `components/` and `modules/` that has a build file. The `components/` subprojects:

| Component | Root package | Contents |
|---|---|---|
| `components/launcher-api` | `pro.gravit.launcher.base.*` | Wire protocol: requests/events (`pro.gravit.launcher.base.request.*`, `...events.request.*`), profiles (`ClientProfile`, `PlayerProfile`), VFS, secure-level request types. This is the "LauncherAPI". |
| `components/launcher-core` | `pro.gravit.launcher.core.*` + `pro.gravit.utils.helper.*` | **The modern facade**: `backend.LauncherBackendAPI`, `api.LauncherAPIHolder`, `api.features.*` (Auth/Profile/Core/User/Hardware/TextureUpload), `api.method.*` (auth methods), `hasher.*` (`HashedDir`, `HashedFile`, `FileNameMatcher`), `CertificatePinningTrustManager`, helpers `JavaHelper`, `JVMHelper`, `SecurityHelper`. |
| `components/launcher-client` | `pro.gravit.launcher.client.*` | Runs **inside the game JVM**: `ClientLauncherEntryPoint` (the launched client's main), `ClientParams`, `ClientModuleManager`, client events (`ClientProcessInitPhase`, `ClientProcessReadyEvent`, ...), `api.{CertificateService,DialogService,SystemService}`, `MinecraftAuthlibBridge`, `DirWatcher`. |
| `components/launcher-runtime` | `pro.gravit.launcher.runtime.*` | **The launcher process core (no JavaFX)**: `LauncherEngine`, `LauncherEngineWrapper`, `gui.RuntimeProvider` (the GUI SPI), `backend.LauncherBackendImpl` + `ClientDownloadImpl` + `ReadyProfileImpl` (the real download/launch engine), `client.ClientLauncherProcess`, `client.DirBridge`, `managers.SettingsManager`, `utils.{LauncherUpdater,HWIDProvider}`. |
| `components/launcher-start` | `pro.gravit.launcher.start.*` | **Process entry / guard**: `ClientLauncherWrapper` (self-relaunch guard), `RuntimeModuleManager`. |
| `components/launchserver` | `pro.gravit.launchserver.*` | Server side: build pipeline (`binary.*`, sign/obfuscate tasks), auth (`auth.*`, `auth.protect.*`), netty socket server, commands. |
| `components/serverwrapper` | `pro.gravit.launcher.server.*` | Agent wrapper to run a protected Minecraft **server** with authlib injection. Not relevant to client GUI. |

### `LauncherRuntime` repo structure (the GUI module being replaced)
- Build: `build.gradle.kts`, Java 21, plugin `org.openjfx.javafxplugin`, **JavaFX 22** modules `javafx.fxml, javafx.controls, javafx.web` (a WebView is already available).
- Single dependency on the core: `implementation("com.gravitlauncher.launcher:launcher-runtime:5.7.10")`.
- Packaged as a **module jar**, NOT an app. Manifest attrs:
  - `Module-Main-Class = pro.gravit.launcher.gui.JavaRuntimeModule`
  - `Module-Config-Class = pro.gravit.launcher.gui.core.config.GuiModuleConfig`
  - `Module-Config-Name = JavaRuntime`
- Source tree `src/main/java/pro/gravit/launcher/gui/`:
  - `JavaRuntimeModule.java` — module entry (extends `LauncherModule`).
  - `core/JavaFXApplication.java` — the `javafx.application.Application`.
  - `core/StdJavaRuntimeProvider.java` — implements `RuntimeProvider`.
  - `core/service/` — **`AuthService`, `ProfileService`, `BackendCallbackService`, `PingService`, `OfflineService`** (the thin wrappers around `LauncherBackendAPI`).
  - `scenes/` (login, servermenu, serverinfo, update, settings, options, console, debug, internal/browser), `overlays/`, `dialogs/`, `components/`, `stage/`.
- `runtime/` directory = the **design pack** shipped to clients: `.fxml` + `.css` per scene/overlay/component, `styles/`, `themes/dark/`. This is the branding/customization surface today (FXML + CSS; JS only via the bundled `javafx.web` WebView in `BrowserScene`/`WebAuthMethod`).

---

## 2. Runtime ↔ core integration (THE contract)

### Entry/registration (not what you'd guess)
The GUI's "entry point" is **not** `JavaFXApplication`. The launcher process entry is `ClientLauncherWrapper.main` → `LauncherEngine`. The GUI plugs in as a **module via a service-provider pattern**:

1. `JavaRuntimeModule extends pro.gravit.launcher.modules.LauncherModule` (module name `"StdJavaRuntime"`, `RUNTIME_NAME = "stdruntime"`). It subscribes to launcher lifecycle events:
   - `ClientPreGuiPhase` → installs a `StdJavaRuntimeProvider` into `phase.runtimeProvider` (located by reflection; it Base64-decodes `"start"` and verifies `JavaFXApplication` overrides `Application.start`).
   - `ClientEngineInitPhase`, `ClientExitPhase`, `ClientUnlockConsoleEvent`.
2. `RuntimeProvider` (interface `pro.gravit.launcher.runtime.gui.RuntimeProvider`) is the **whole GUI SPI** — only 3 methods:
   ```java
   void run(String[] args);   // StdJavaRuntimeProvider does Application.launch(JavaFXApplication.class, args)
   void preLoad();
   void init(boolean clientInstance);
   ```
   A Tauri front-end replaces `StdJavaRuntimeProvider` with one whose `run()` spawns/attaches the webview process instead of `Application.launch`.

### The single facade every GUI must drive: `LauncherBackendAPI`
`pro.gravit.launcher.core.backend.LauncherBackendAPI` (interface) — obtained via `LauncherBackendAPIHolder.getApi()`. Implemented by `LauncherBackendImpl` in `launcher-runtime`. **This is the entire job of any GUI.** Full method list (verified):

```java
void setCallback(MainCallback callback);
CompletableFuture<LauncherInitData> init();                 // checks launcher updates + returns List<AuthMethod>
void selectAuthMethod(AuthMethod method);
CompletableFuture<SelfUser> tryAuthorize();                 // restore saved token / refresh
CompletableFuture<SelfUser> authorize(String login, AuthMethodPassword password);
CompletableFuture<Void> userExit();
CompletableFuture<List<ProfileFeatureAPI.ClientProfile>> fetchProfiles();
ClientProfileSettings makeClientProfileSettings(ClientProfile profile);
void saveClientProfileSettings(ClientProfileSettings settings);
CompletableFuture<ReadyProfile> downloadProfile(ClientProfile, ClientProfileSettings, DownloadCallback);
CompletableFuture<byte[]> fetchTexture(Texture);            // (impl currently throws Unsupported)
CompletableFuture<List<Java>> getAvailableJava();
CompletableFuture<ServerPingInfo> pingServer(ClientProfile);
CompletableFuture<ServerPingInfo> pingProfileServers(ClientProfile);
void registerUserSettings(String name, Class<? extends UserSettings>);
UserSettings getUserSettings(String name, Function<String,UserSettings> ifAbsent);
UserPermissions getPermissions(); boolean hasPermission(String); String getUsername(); SelfUser getSelfUser();
boolean isTestMode();
ResourceLayer makeResourceLayer(List<Path> overlay);
<T extends Extension> T getExtension(Class<T>);
void shutdown();
```

Nested callback classes (the front-end subscribes; backend pushes status):
- `MainCallback`: `onChangeStatus`, `onProfiles(List<ClientProfile>)`, `onAuthorize(SelfUser)`, `onNotify(header,desc)`, `onExit`, `onShutdown`.
- `DownloadCallback`: phases enum `UpdatePhase {JAVA, ASSETS, CLIENT, LAUNCH}`; stages strings `assetVerify, hashing, diff, download, deleteExtra, done.part, done`; `onStartPhase`, `onStage`, `onCanCancel(Runnable)`, `onTotalDownload(long)`, `onCurrentDownloaded(long)`.
- `RunCallback`: `onStarted`, `onCanTerminate(Runnable)`, `onFinished(int code)`, `onNormalOutput(byte[],off,len)`, `onErrorOutput(...)`, `onReadyToExit`.
- `ReadyProfile`: `getClientProfile()`, `getSettings()`, `run(RunCallback)` — **this is the actual game launch**.
- `ClientProfileSettings`: memory (`getReservedMemoryBytes/setReservedMemoryBytes` with `MemoryClass.TOTAL`), `Flag {AUTO_ENTER, FULLSCREEN, LINUX_WAYLAND_SUPPORT, DEBUG_SKIP_FILE_MONITOR}`, optional mods (`OptionalMod`, `enableOptional/disableOptional`), Java selection (`getSelectedJava/getRecommendedJava/setSelectedJava/isCompatible`).

The JavaFX `core/service/*` classes are thin: `AuthService` wraps password encryption (`AuthAESPassword` if `config.passwordEncryptKey != null`, else `AuthPlainPassword`) and holds `SelfUser`; `ProfileService` just stores the profile list; `BackendCallbackService extends LauncherBackendAPI.MainCallback` and bridges callbacks to the FX thread. **A Tauri front-end reimplements exactly these in Rust-driven form** — the Java side keeps `LauncherBackendImpl`.

### Auth, profiles, download, launch — concrete flow inside `LauncherBackendImpl`
- Auth uses `LauncherAPIHolder.auth()` (an `AuthFeatureAPI`): `auth(login, password)`, `refreshToken(refresh)`, `restore(accessToken, true)`, `exit()`. Tokens (access/refresh/expire) persist in `BackendSettings.auth` via `SettingsManager`. `selectAuthMethod` calls `LauncherAPIHolder.changeAuthId(method.getName())`.
  - Auth method detail types: `AuthLoginOnlyDetails`, `AuthPasswordDetails`, `AuthTotpDetails`, `AuthWebDetails`. Password types: `AuthPlainPassword`, `AuthAESPassword`/`AuthOAuthPassword`/`AuthTotpPassword`/`AuthChainPassword`. (Legacy names like `GetAvailabilityAuthRequest`/`AuthRequest` exist in `launcher-api` `base.request.auth.*` but the modern path goes through `AuthFeatureAPI`.)
- Profiles via `LauncherAPIHolder.profile()` (`ProfileFeatureAPI`): `getProfiles()`, `changeCurrentProfile(profile)`, `fetchUpdateInfo(dirName)`.
- **Download + hash verification** (`ClientDownloadImpl`): per phase CLIENT→ASSETS→JAVA, it calls `fetchUpdateInfo(dir)` to get a `HashedDir` + base URL, diffs against the local `DirBridge.dirUpdates.resolve(dirName)` directory, and downloads via `pro.gravit.launcher.base.Downloader` (`Downloader.SizedFile`, multi-threaded). Asset index handled specially (`indexes/<index>.json`, `AssetIndexHelper`). Integrity = `HashedFile.isSame(path, true)`.
- **Launch** (`ReadyProfileImpl.run`): builds a `pro.gravit.launcher.runtime.client.ClientLauncherProcess`:
  - constructor args: client dir, asset dir, selected `JavaHelper.JavaVersion`, resourcepacks dir, `ClientProfile`, `new PlayerProfile(selfUser)`, `OptionalView`, `selfUser.getAccessToken()`, the three `HashedDir`s (client/asset/java), `OAuthRequestEvent`, authId.
  - `params.ram` → `-Xms/-Xmx`; flags map to `params.fullScreen/autoEnter/lwjglGlfwWayland`.
  - Main class = `pro.gravit.launcher.client.ClientLauncherEntryPoint` (or `profile.getMainClass()` in BRIDGE mode).
  - **Two classloader modes** (`ClientProfile.ClassLoaderConfig`): default writes encrypted launch params over a localhost socket (`runWriteParams(127.0.0.1:Launcher.getConfig().clientPort)`); **BRIDGE** mode starts `MinecraftAuthlibBridge` server (`runAuthlibBridgeServer`) on the same port and passes `-Dlauncher.authlib.host=127.0.0.1 -Dlauncher.authlib.port=<clientPort>`.
  - **Runtime integrity enforcement**: in BRIDGE mode, `DirWatcher`/`BridgeDirWatcher` watch client/asset/java dirs and `ClientLauncherEntryPoint.verifyHDir(...)` re-verifies hashes against the `HashedDir` before/while running. Tampering kills the client.
  - Process I/O is streamed back through `RunCallback.onNormalOutput`.

### How the runtime gets config / branding today
- **No GUI-read `config.json`.** Module config is `GuiModuleConfig`, fields annotated `@LauncherInject("modules.javaruntime.<key>")` (e.g. `createaccounturl`, `forgotpassurl`, `lazy`, `disableofflinemode`, `autoauth`, `locale`, `downloadthreads`). These values are **injected into the launcher jar at LaunchServer build time** from the server's config — they are baked into bytecode, not read at runtime. Same `@LauncherInject` mechanism injects `launcher.memory`, `launcher.customJvmOptions`, `passwordEncryptKey`, `clientPort`, certificate, etc. (see `LauncherConfig`).
- User-mutable settings (`RuntimeSettings`, theme, locale, `updatesDir`, per-profile memory/flags/optionals) persist via `LauncherBackendAPI.getUserSettings(...)` / `UserSettings.providers.register("stdruntime", RuntimeSettings.class)`.
- Branding = the `runtime/` FXML+CSS pack (themeable via `themes/<name>/`), swappable per server.

---

## 3. Headless / alternative-UI feasibility

- **The core is GUI-agnostic by design.** The only GUI coupling is the 3-method `RuntimeProvider` SPI + the `LauncherBackendAPI` facade. `launcher-runtime` (the engine + `LauncherBackendImpl`) has **no JavaFX dependency**; JavaFX lives only in the `LauncherRuntime` module jar and in `LauncherEngineWrapper`'s module list. So a non-JavaFX GUI is architecturally supported: provide a `RuntimeProvider` whose `run()` launches your UI and drives `LauncherBackendAPIHolder.getApi()`.
- **Prior art — official Tauri/Rust:** `LauncherPrestarter` branch [`rust/5.7.x`](https://github.com/GravitLauncher/LauncherPrestarter/tree/rust/5.7.x) is Tauri 2 + Rust + Svelte. It downloads Liberica JRE-full and `spawn`s the Java launcher. README is RU; it documents `yarn tauri dev` / `yarn tauri build`. It is a *bootstrapper*, not a GUI replacement — but proves the team's direction and gives a working Rust download/extract/spawn template (see §5/§6). It even patches `tao` from a fork `GravitLauncher6/tao`.
- The launcher already embeds a **JavaFX WebView** (`javafx.web`, `scenes/internal/BrowserScene`, `overlays`/`WebAuthMethod`) — i.e. servers already do HTML/JS UI inside the Java process today. That is the closest existing "web UI" path and an alternative to Tauri if you wanted to stay in-JVM.
- No evidence found of a third-party Electron/Tauri **full GUI replacement** that reuses the Java core via IPC. The community is largely RU (Discord/`gravit-launcher.ru`); the docs site returns 403 to automated fetches, so a manual pass of the RU Discord/forum is an open item. **Flag: unverified that nobody has done this; only that it is not visible via web search/GitHub search.**

---

## 4. Security & integrity (what a protected server requires)

### The "guard" is the wrapper, not a native anticheat
- `pro.gravit.launcher.start.ClientLauncherWrapper.main` is the real process entry. It performs: `JVMHelper.checkStackTrace(...)` (anti-tamper of the call chain), `JVMHelper.verifySystemProperties(Launcher.class, true)`, `EnvHelper.checkDangerousParams()`, blocks self-attach (`MAGIC_ARG = -Djdk.attach.allowAttachSelf`), then **re-launches itself in a child JVM** with `launcher.wrappedLaunch=true` and the JavaFX modules added (`LauncherEngineWrapper.main` builds the `ModuleLaunch` with `javafx.*` from `$JAVA_HOME/lib`). The Rust prestarter sidesteps the Java search with `-Dlauncher.noJavaCheck=true`.
- There is also a separate native guard option in some builds (the historical `LauncherGuard`/`wrapper`/`nativeguard`); **the current master uses the Java wrapper described above as the default guard. Flag: confirm whether your target server enables a native guard component.**

### Launcher signing
- `launchserver/binary/tasks/SignJarTask` signs the built launcher jar with **BouncyCastle CMS** (`CMSSignedDataGenerator`, `SignHelper.createSignedDataGenerator`, keystore via `LaunchServerConfig.JarSignerConf` — `keyStore/keyStorePass/keyAlias/keyPass/signAlgo`). If signing is disabled, `autoSign` uses an autogenerated cert (`CertificateAutogenTask`). The build pipeline (`BinaryPipeline`, `MainBuildTask`, `PrepareBuildTask`, optional `ProGuardComponent` for obfuscation) also injects the `@LauncherInject` config values and the server's public key/certificate into the jar.
- `EXELauncherBinary` produces a Windows `.exe` variant (`UpdateVariant.EXE_WINDOWS_X86_64`) — a wrapped exe around the jar (Launch4j-style). `JARLauncherBinary` is the plain jar.

### Server-side trust model (`auth.protect`)
- Handlers: `NoProtectHandler` (none), `StdProtectHandler` (basic), **`AdvancedProtectHandler`** (strict: implements `SecureProtectHandler` + `HardwareProtectHandler` + `JoinServerProtectHandler`).
- `AdvancedProtectHandler`:
  - `allowGetSecureLevelInfo(client)` returns `client.checkSign` — **only a correctly-signed launcher passes**. Secure-level uses an **ECDSA challenge**: server sends 128 random bytes (`generateSecureLevelKey`), client signs with its EC private key (`VerifySecureLevelKeyRequest`), server verifies with `SecurityHelper.toPublicECDSAKey` / `newECVerifySignature`. The client EC key is `ECKeyHolder` (`launcher-runtime/backend/ECKeyHolder`, `readKeys()`).
  - Issues JWTs signed with `server.keyAgreementManager.ecdsaPrivateKey`: a **publicKey token** and (if `enableHardwareFeature`) a **hardware token** (HWID). `HWIDProvider` (client) gathers hardware; `HardwareReportRequest` reports it; bans enforced server-side; `onJoinServer` refuses if hardware not verified.
- Transport: `CertificatePinningTrustManager` (cert pinning) + the injected server certificate. Requests go over the LaunchServer netty socket / WebSocket.

### Does swapping JavaFX→Tauri break security?
**The security surface is independent of the GUI**, IF you keep the Java core (`launcher-start` + `launcher-runtime` + `launcher-client`) intact and signed. What MUST be preserved for a protected (Advanced) server to accept the client:
1. The **signed launcher jar** (the Java payload) must remain the LaunchServer-built, signed artifact — `client.checkSign` gates everything. Do not re-sign with your own key; the server pins the LaunchServer key.
2. The **EC keypair / `ECKeyHolder`** flow and the secure-level challenge response must run inside the genuine Java process.
3. The **HWID report** flow (if `enableHardwareFeature`).
4. The **wrapper/guard relaunch** (`ClientLauncherWrapper`) and `ClientLauncherEntryPoint` integrity (`verifyHDir`, `DirWatcher`) must execute as built — these run in the launched-client JVM, not the GUI.
5. The injected `@LauncherInject` config (clientPort, passwordEncryptKey, cert, server URLs) is baked into that jar.

**Implication:** the Tauri shell must NOT replace the signed Java jar; it must *drive* it. The safe design keeps `LauncherBackendImpl` and the entire `launcher-runtime`/`-start`/`-client` chain as the signed Java sidecar, and replaces only the JavaFX `LauncherRuntime` module (MIT, unsigned-sensitive UI layer) with a Java↔Tauri bridge module. (Flag: confirm with the server owner whether the launcher jar is signed/Advanced-protected — if `NoProtectHandler`, constraints relax.)

---

## 5. Java provisioning

### How the core handles JRE today
- `pro.gravit.utils.helper.JavaHelper.findJava()` discovers JREs: current JVM, every `PATH` entry, then OS-specific dirs: Windows `C:\Program Files\{Java, AdoptOpenJDK, Eclipse Foundation, Eclipse Adoptium, BellSoft}`; Linux `/usr/lib/jvm`. It records `JavaVersion{jvmDir, version, build, arch, enabledJavaFX}` and detects bundled OpenJFX via `tryGetOpenJFXPath` (looks for sibling `openjfx`/`openjdk→openjfx` dirs, Debian `/usr/share/openjfx`). `JavaHelper.javaFxModules = {javafx.base, .graphics, .fxml, .controls, .swing, .media, .web}`.
- `ClientLauncherWrapper` prefers the **highest version with JavaFX enabled**.
- **In-launcher / server-provided Java**: `LauncherBackendImpl.getCustomJava()` reads `Launcher.getConfig().customJavaDownload` (a `Map<dirName, "Java <v> b<build> <os> <arch> javafx <bool>">`), resolving each under `DirBridge.dirUpdates`. If `forceUseCustomJava`, only these are used. The JRE is then downloaded as a normal hashed dir (DownloadCallback `UpdatePhase.JAVA`) and integrity-watched like any other dir.
- `JVMHelper` enumerates OS (`MUSTDIE`=Windows, `LINUX`, `MACOSX`) and ARCH (`X86`, `X86_64`, `ARM64`), with x86_64-on-ARM64 / Rosetta allowances.

### Recommended/required Java
- **Launcher itself & LaunchServer: Java 21** (both `build.gradle.kts` set `VERSION_21`; LaunchServer requires 21).
- **Minecraft 1.21.1: Java 21** (Mojang requirement). The launched client uses the selected/recommended Java from the profile; for 1.21.1 that must be **21**.
- The official prestarter downloads **BellSoft Liberica JRE 25 "full"** (JavaFX-bundled) — newer than 21 but backward-compatible for running the launcher, and `-full` guarantees JavaFX is present so the current GUI works. For 1.21.1 game launch you still want a 21 runtime in the profile (or 25 if the server profile allows).

### Vendors & programmatic per-OS/arch download
- The official prestarter uses **BellSoft Liberica** specifically because `jre-full` bundles JavaFX. API used (verified in `download.rs`):
  `GET https://api.bell-sw.com/v1/liberica/releases?version-modifier=latest&version-feature=<N>&bitness=64&os={windows|linux|macos}&arch={x86|aarch64}&package-type={zip|tar.gz}&bundle-type=jre-full`
  → JSON array of `{downloadUrl, featureVersion, packageType, version, filename, size}`. Emergency fallback hardcodes a GitHub release URL `https://github.com/bell-sw/Liberica/releases/download/<tag>/bellsoft-jre<tag>-<os>-<amd64|aarch64>-full.<ext>`.
- Other vendors detected/usable: **Temurin/Adoptium** (`https://api.adoptium.net/v3/binary/latest/21/ga/{windows|linux|mac}/{x64|aarch64}/jre/hotspot/normal/eclipse`), Microsoft Build of OpenJDK, Azul Zulu (`api.azul.com/zulu/download/...`). **Only Liberica/Zulu ship a JavaFX-bundled distribution** — relevant only while the current JavaFX GUI is in play. Once the GUI is Tauri, the launcher core itself does NOT need JavaFX (see §3), so a plain Temurin 21 JRE suffices for the launcher; the game profile dictates the game JRE.

---

## 6. Tauri + Java sidecar patterns

### Reference implementation (official, in-repo)
From `LauncherPrestarter/rust/5.7.x/src-tauri`:
- `Cargo.toml`: `tauri = {version="2", features=["tray-icon"]}`, `tauri-plugin-opener`, `reqwest {blocking, json}`, `zip`, `tar`, `flate2`, `dirs-next`, `chrono`. Release profile: `lto`, `opt-level="s"`, `panic="abort"`, `strip`.
- `download.rs`: per-OS/arch BellSoft fetch + streamed `download_file` with progress callback.
- `extract.rs`: zip (Windows) / tar.gz (Unix).
- `runner.rs`: `relaunch_using_java(java_dir)` → `Command::new(<java_dir>/bin/{javaw.exe|java}).arg("-Dlauncher.noJavaCheck=true").arg("-jar").arg(current_exe).spawn()` (intentionally not waited).
- `config.rs`: stores `prestarter-config.json` (java_version, feature_version, install_date; refresh if >30 days) under `dirs_next::data_dir()/GravitLauncherStore`.

### Best-practice patterns for the full replacement (Tauri v2 docs)
- **Bundling the JRE + jar as Tauri resources/sidecar.** Two options:
  1. **`externalBin` (sidecar):** declare in `tauri.conf.json` `bundle.externalBin`; Tauri appends the target triple to the binary name and bundles it; invoke from Rust via `tauri_plugin_shell` `app.shell().sidecar("name")`. Good for a single launcher exe. Docs: https://v2.tauri.app/develop/sidecar/
  2. **`resources`:** ship the JRE folder + jar as `bundle.resources`, resolve at runtime with `app.path().resolve("jre", BaseDirectory::Resource)`. Better for a whole JRE tree. Docs: https://v2.tauri.app/develop/resources/
  - Given JRE size (~50–120 MB), the prestarter's **download-on-first-run** approach (don't bundle the JRE) keeps the installer small and is the team's chosen pattern.
- **Spawning Java from Rust:** `tauri_plugin_shell::Command`/`std::process::Command`; stream stdout/stderr via the plugin's event channel; on Windows use `javaw.exe` + `CREATE_NO_WINDOW` to avoid a console. Docs: https://v2.tauri.app/plugin/shell/
- **IPC: web UI ↔ Java backend.** Three candidate transports (recommendation: localhost WS):
  1. **Localhost HTTP + WebSocket inside the Java process** — the Java side already runs an embedded netty stack; expose `LauncherBackendAPI` over a local WS (JSON messages mapping 1:1 to the facade methods + callbacks). Push `MainCallback`/`DownloadCallback`/`RunCallback` events over the socket. **Recommended**: matches the async, callback-heavy API; survives the launcher's self-relaunch if the port is fixed (`Launcher.getConfig().clientPort` is already a localhost-port convention). Bind to `127.0.0.1`, random high port, with a per-session token to prevent local CSRF.
  2. **stdio JSON-RPC** — Rust spawns Java, line-delimited JSON over stdin/stdout. Simple, no port, but the launcher's wrapper *re-launches itself* (child JVM), which complicates owning stdio across the relaunch. Workable if you set `noJavaCheck`/`wrappedLaunch` to avoid the relaunch and own the final JVM directly.
  3. **Named pipe / Unix socket** — most secure (no TCP), but more platform code. Reasonable v2 hardening step.
  - The Tauri front-end (JS) talks to Rust via Tauri `invoke`/events; Rust proxies to the Java transport. Keep the JS↔Rust boundary thin and put protocol logic in Rust.
- **Tauri auto-updater:** `@tauri-apps/plugin-updater` + `tauri-plugin-updater`, signed update manifests (minisign keypair via `tauri signer generate`), `bundle.createUpdaterArtifacts=true`. Docs: https://v2.tauri.app/plugin/updater/ . Note: this updates the *Tauri shell*; the *Java launcher jar* has its own update path (`LauncherUpdater`, `CoreFeatureAPI.checkUpdates`, `UpdateVariant`) — keep both, or let the shell be a thin prestarter and let the jar self-update as today.
- **Cross-platform bundling** (`tauri build`, docs https://v2.tauri.app/distribute/): Windows `.exe`(NSIS)/`.msi`(WiX); macOS `.app`/`.dmg`, **universal** via `--target universal-apple-darwin`; Linux `.AppImage`/`.deb`/`.rpm`. Per-platform extract logic already in prestarter.
- **Code signing per platform** (docs https://v2.tauri.app/distribute/sign/): Windows Authenticode (EV cert / Azure Trusted Signing); macOS Developer ID + **notarization** (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`); Linux relies on the updater minisign signature. This is separate from and additional to the Java jar's CMS signing in §4.

---

## 7. Licensing

- **Core monorepo `Launcher` (LaunchServer + launcher-core/runtime/client/api/start): GPL-3.0.** Confirmed on the repo and on the published artifact `pro.gravit.launcher:launcher-modern-core` (GPL-3.0). The live artifact you depend on, `com.gravitlauncher.launcher:launcher-runtime`, is built from this GPL-3.0 source.
- **`LauncherRuntime` (the JavaFX GUI module): MIT** (Copyright 2019 GravitLauncherTeam). You may freely rewrite/relicense the GUI layer.

**Implications for a Tauri replacement (important):**
- The Tauri front-end *replaces the MIT GUI* — that part is unrestricted.
- BUT a working launcher must **link against the GPL-3.0 `launcher-runtime`/`launcher-core`** (you call `LauncherBackendAPI`, `ClientLauncherProcess`, etc.). Under GPL-3.0, a program that combines with GPL code and is distributed must itself be **GPL-3.0** (and provide source). The Rust/Tauri shell that merely *spawns* a separate Java process (arms-length, like the official prestarter) is the cleanest way to avoid your front-end becoming a derivative work — the Java side stays GPL (source available), the Rust shell communicates over IPC at arm's length. **A fully proprietary/closed build that statically combines or tightly embeds the GPL core is not compatible with GPL-3.0.** (Flag: this is a legal judgment — the "arm's-length process + IPC" boundary is the standard mitigation but get counsel if shipping closed-source commercially. GravitLauncher's own model is open-source.)
- The BellSoft Liberica JRE you ship/download is GPLv2+CE (OpenJDK) — fine to redistribute.

---

## (a) Recommended high-level architecture

```
┌──────────────────────────── Tauri shell (Rust + webview) ────────────────────────────┐
│  Web UI (Svelte/React/Vue → HTML/CSS/JS)  ── Tauri invoke/events ──►  Rust core         │
│                                                                                         │
│  Rust core responsibilities:                                                            │
│   • First-run: download JRE (BellSoft Liberica jre-full or Temurin 21) per OS/arch,     │
│     extract (zip/tar.gz), cache under data_dir()/GravitLauncherStore  [reuse prestarter]│
│   • Spawn the SIGNED Java launcher jar as a sidecar process                             │
│     (javaw -Dlauncher.noJavaCheck=true -jar Launcher.jar  --headless-bridge)            │
│   • Hold the IPC client to the Java backend                                             │
└─────────────────────────────────────────────────────────────────────────────────────┘
                              │ localhost WebSocket (127.0.0.1:<port>, session token)
                              ▼
┌──────────────── Java sidecar = unchanged signed GPL core (the security boundary) ──────┐
│  NEW thin module: "BridgeRuntimeProvider" implements RuntimeProvider                    │
│    run(args): start embedded WS server, expose LauncherBackendAPI + push callbacks      │
│  REUSED AS-IS: LauncherEngine / ClientLauncherWrapper (guard, self-relaunch)            │
│                LauncherBackendImpl (init/auth/profiles/download/hash-verify)            │
│                ClientDownloadImpl, ReadyProfileImpl, ClientLauncherProcess              │
│                ECKeyHolder, HWIDProvider, secure-level challenge, CertificatePinning    │
│                ClientLauncherEntryPoint + DirWatcher (runs in the launched game JVM)    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```
- Replace ONLY the JavaFX `LauncherRuntime` module with a small `BridgeRuntimeProvider` Java module (≈ the `core/service/*` classes re-expressed as a WS protocol). Keep everything signed/GPL untouched.
- IPC protocol maps 1:1 to `LauncherBackendAPI`: requests `init/selectAuthMethod/authorize/tryAuthorize/fetchProfiles/downloadProfile/run/userExit/...`; server-push events for `onChangeStatus/onProfiles/onAuthorize/onNotify` + `DownloadCallback` progress + `RunCallback` stdout/exit.
- Phase 1 = ship the existing official Rust **prestarter** (already done by the team) to validate JRE download + spawn. Phase 2 = add the WS bridge module + full web UI. This staged path de-risks the security/guard interaction.

## (b) Top 5 technical risks
1. **Signing/secure-level (Advanced protect).** If the target server uses `AdvancedProtectHandler`, the Java jar must be the LaunchServer-signed artifact and pass `client.checkSign` + ECDSA secure-level + HWID. Any tampering, re-signing, or running the bridge in an unsigned jar fails auth. The Tauri shell must spawn the genuine signed jar, never embed/modify it.
2. **The self-relaunch guard.** `ClientLauncherWrapper` re-spawns a child JVM (stack-trace check, dangerous-param check, JavaFX module add). Owning IPC/stdio across that relaunch is fragile — must use `-Dlauncher.noJavaCheck`/control `wrappedLaunch` and likely a fixed localhost WS port that survives the relaunch.
3. **GPL-3.0 of the core.** A closed/proprietary launcher that tightly links the GPL core is non-compliant; only an arm's-length process+IPC boundary keeps the Rust shell out of the GPL derivative-work scope. Legal review needed for any commercial closed build.
4. **API churn.** The "modern core" (`LauncherBackendAPI`) is comparatively new and still evolving (`fetchTexture` throws Unsupported; legacy Maven artifact frozen at 5.5.4 vs live 5.7.x under a different group id). The bridge module pins to a specific core version and may need maintenance per release.
5. **JavaFX-free core packaging.** Today the launcher build assumes JavaFX (the GUI module + `LauncherEngineWrapper` add `javafx.*`). Stripping JavaFX so a plain Temurin 21 JRE suffices requires building a runtime without the JavaFX module list — verify nothing else in the engine path imports JavaFX (the `core/service/*` use `javafx.beans`/`Platform`, so they must be rewritten, not just bypassed).

## (c) Open questions only Gravit internals / the server owner can answer
1. Which protect handler does the target server run (`No`/`Std`/`Advanced`) and is hardware-feature/HWID enabled? This sets the entire security constraint envelope.
2. Is the production launcher jar CMS-signed and is a native guard component enabled (beyond the Java `ClientLauncherWrapper`)? If a native guard exists, can it run when the host process is a Tauri shell?
3. Exact protocol/auth-method config the server expects (OAuth vs password vs TOTP vs web), the `passwordEncryptKey` presence, and `clientPort`/cert injection — needed to script the bridge.
4. Does the server already publish `customJavaDownload` (server-provided JRE) and what version/arch matrix? Determines whether the Tauri shell should download Java at all or defer to the core's `UpdatePhase.JAVA` download.
5. Is replacing the GUI module officially supportable, or does the LaunchServer build pipeline assume the `StdJavaRuntime` module by name (`@LauncherInject("modules.javaruntime.*")` keys)? Confirm the build accepts a custom `RuntimeProvider` module without regenerating those injected config keys.

---

### Key source references (all GitHub master unless noted)
- Facade: `components/launcher-core/.../core/backend/LauncherBackendAPI.java`
- Impl: `components/launcher-runtime/.../runtime/backend/{LauncherBackendImpl,ClientDownloadImpl,ReadyProfileImpl}.java`
- GUI SPI: `components/launcher-runtime/.../runtime/gui/RuntimeProvider.java`
- Launch: `components/launcher-runtime/.../runtime/client/ClientLauncherProcess.java`; client main `components/launcher-client/.../client/ClientLauncherEntryPoint.java`
- Guard/entry: `components/launcher-start/.../start/ClientLauncherWrapper.java`; `components/launcher-runtime/.../runtime/LauncherEngineWrapper.java`
- Security: `components/launchserver/.../auth/protect/AdvancedProtectHandler.java`, `.../auth/protect/interfaces/SecureProtectHandler.java`, `components/launchserver/.../binary/tasks/SignJarTask.java`, `components/launcher-core/.../core/CertificatePinningTrustManager.java`
- Java: `components/launcher-core/.../utils/helper/{JavaHelper,JVMHelper}.java`
- GUI module: `LauncherRuntime` `src/main/java/pro/gravit/launcher/gui/{JavaRuntimeModule,core/JavaFXApplication,core/StdJavaRuntimeProvider,core/service/*,core/config/GuiModuleConfig}.java`; `build.gradle.kts`
- Tauri prior art: `LauncherPrestarter` branch `rust/5.7.x` `src-tauri/src/{config,download,extract,runner,main}.rs`, `Cargo.toml`
- Tauri v2 docs: sidecar https://v2.tauri.app/develop/sidecar/ · resources https://v2.tauri.app/develop/resources/ · shell https://v2.tauri.app/plugin/shell/ · updater https://v2.tauri.app/plugin/updater/ · distribute https://v2.tauri.app/distribute/ · signing https://v2.tauri.app/distribute/sign/
