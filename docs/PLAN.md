# Varryal Launcher — МЕГА-подробный план

> Замена JavaFX-рантайма GravitLauncher на нативный кросс-платформенный лаунчер на **Tauri** (Rust + веб-фронтенд), сохраняющий весь функционал и защиту дефолтного Gravit.
>
> Основано на исследовании [docs/research/gravit-architecture.md](research/gravit-architecture.md) (факты проверены по исходникам GravitLauncher на GitHub, ветка master, июнь 2026).
>
> Дата: 2026-06-16 · Статус: **черновик плана, ждёт утверждения**

---

## 1. Executive summary

**Что делаем.** Пользователь скачивает один нативный бинарник под свою ОС (Windows `.exe`/`.msi`, macOS `.dmg` universal, Linux `.AppImage`/`.deb`). При первом запуске бинарник сам скачивает нужную JRE (если её нет), запускает подписанное Java-ядро GravitLauncher как фоновый процесс и показывает красивый веб-интерфейс. Функционал — как у дефолтного Gravit: вход, выбор сервера/профиля с онлайн-статусом, скачивание и хэш-проверка клиента, настройки (RAM/Java/папка), консоль/логи, запуск игры. JavaFX выкидывается полностью.

**Архитектура одним абзацем.** Ядро Gravit уже отвязано от GUI: вся морда подключается через SPI `RuntimeProvider` (3 метода) и работает через единый фасад `pro.gravit.launcher.core.backend.LauncherBackendAPI`. Мы НЕ трогаем ядро, протокол, guard, подпись, ECDSA-secure-level и HWID. Вместо JavaFX-модуля мы добавляем тонкий Java-модуль **`BridgeRuntimeProvider`**, который поднимает локальный WebSocket-сервер и пробрасывает весь `LauncherBackendAPI` наружу. Сверху — Tauri-оболочка (Rust): она занимается провижинингом JRE, запуском подписанного Java-jar и проксированием IPC, а веб-UI (React) рисует интерфейс и общается с Rust через `invoke`/события.

**Почему риск ниже, чем кажется.**
1. **Команда Gravit уже сделала Tauri 2 + Rust + Svelte** — репозиторий `LauncherPrestarter`, ветка `rust/5.7.x`. Это готовый официальный шаблон под наш Rust↔Java мост: скачивание JRE (BellSoft Liberica), распаковка, `spawn` Java. Берём его как референс.
2. **Ядро GUI-агностично by design** — мы подключаемся «по шву», не переписывая защиту.
3. **Лицензии чистые** при архитектуре «отдельный процесс + IPC»: ядро — GPL-3.0 (остаётся отдельным подписанным процессом), Rust-оболочка общается с ним на расстоянии вытянутой руки. Весь проект делаем под GPL-3.0 — совместимо.

### Goals (MVP)
- Один бинарник на ОС, авто-провижининг JRE (несколько версий: 21 для старых профилей, 25 для новейших типа «фабрик» 26.1.2).
- Вход (логин/пароль Gravit) → выбор сервера/профиля + онлайн → скачивание/обновление с хэш-проверкой → запуск.
- Настройки: RAM, Java-аргументы, директория игры. Консоль/логи запуска.
- Сохранение защиты Gravit (signed jar, secure-level, HWID, guard) — без ослабления.
- Современный тёмный дизайн в духе Modrinth/GDLauncher/Prism, безрамочное окно.
- Авто-обновление самой оболочки.

### Non-goals (вне MVP, заложить расширяемость)
- Новости/changelog-лента, скины/плащи, соц-ссылки.
- Microsoft/Ely.by авторизация (только стандартный Gravit-логин сейчас).
- Полноценный drag-drop визуальный редактор лаунчера (делаем систему тем/токенов, а не WYSIWYG).
- Code-signing сертификаты (их нет — обходим предупреждения ОС, см. §8).

---

## 1.1 Факты боевого LaunchServer (разведка по SSH, 2026-06-16)

Прочитано напрямую с VDS (`/var/lib/pelican/volumes/LAUNCHER`). На этом строим реализацию:

| Параметр | Значение | Влияние на план |
|---|---|---|
| Версия ядра | `com.gravitlauncher.launcher:launcher-runtime:5.7.10` (репо `https://maven.gravitlauncher.com`) | bridge-модуль компилируется **локально** против артефакта — VDS для сборки не нужен |
| Текущая морда | форк `LauncherRuntime` в `srcRuntime/` → `JavaRuntime.jar` (JavaFX 22, `pro.gravit.launcher.gui.*`) | наш bridge — drop-in замена `JavaRuntime.jar` |
| Манифест модуля | `Module-Main-Class=pro.gravit.launcher.gui.JavaRuntimeModule`, `Module-Config-Name=JavaRuntime` | зеркалим (или новое имя + правка `modules.json`) |
| protectHandler | `advanced`, **HWID выключен** (`enableHardwareFeature:false`) | secure-level ECDSA + checkSign нужны; HardwareReport НЕ нужен |
| Подпись | `sign.enabled:true` (PKCS12 `VarryalCodeSign`, SHA256withRSA) | jar обязан остаться подписанным сервером — не пересобираем/не переподписываем |
| ProGuard | `enabled:true`, `modeAfter:MainBuild`, `mappings:true` | обфускация: entrypoint/рефлексия моста должны быть obfuscation-safe + keep-правила |
| pinning/encrypt | `certificatePinning:false`, `encryptRuntime:false` | проще: без пиннинга и шифрования рантайма |
| classLoaderConfig | профиль = `LAUNCHER` (не BRIDGE) | запуск пишет параметры в localhost-сокет `clientPort`; authlib-bridge не задействован |
| Профиль | `varryal_main`, **Fabric** (`KnotClient`), MC **26.1.2**, `minJavaVersion:25` | «фабрик» = Fabric; нужна **Java 25**; есть optional-моды + auto macOS `-XstartOnFirstThread` |
| Java-провижининг | `customJavaDownload:{}`, `forceUseCustomJava:false` | Java качает **оболочка/престартер** (Liberica) — путь (B) из §5; ядро Java само не тянет |
| Гард игры | `LauncherGuard_lmodule` — **нативный** (`GravitGuard2.exe`+`GuardDLL`, `protectLauncher:false`) | защищает ИГРУ, не лаунчер; работает в процессе игры — наша оболочка не мешает |
| Прочие lmodule | `DiscordGame_lmodule` (Rich Presence) | отдельный модуль, не трогаем |
| Auth | кастомный core `varryal` (`https://varryal.ru/api`), `std` login/password по умолчанию | bridge зовёт `authorize(login,password)`; сервер обрабатывает через `VarryalAuth` |
| Дистрибуция | `Varryal.jar` + `Varryal.exe` на `https://launcher.varryal.ru/`; уже лежит официальный `Prestarter.exe` | добавляем mac/linux-бинари; апдейт «как у Gravit» |
| netty | `wss://launcher.varryal.ru/api`, download `https://launcher.varryal.ru/%dirname%/`, bind `:9274` | адреса инжектятся в jar |

**Вывод:** вся защита (advanced, signed jar, нативный LauncherGuard игры) сохраняется без изменений; bridge собирается локально против публичного Maven; все операции с боевым сервером (вкатка модуля, ребилд, тест) делает Opus вручную.

## 2. Архитектура

```
┌──────────────────────── Varryal Launcher (нативный бинарник) ────────────────────────┐
│                                                                                       │
│  ┌─────────────────────────────┐        invoke / event        ┌────────────────────┐ │
│  │   Web UI (React+Vite+TS)     │  ◄──────────────────────────►│   Rust core (Tauri)│ │
│  │   сцены, дизайн, темы        │                              │                    │ │
│  └─────────────────────────────┘                              │  • JRE provisioning│ │
│                                                                │  • spawn jar       │ │
│                                                                │  • WS-клиент к Java│ │
│                                                                │  • окно/титлбар    │ │
│                                                                │  • авто-апдейт     │ │
│                                                                └─────────┬──────────┘ │
└──────────────────────────────────────────────────────────────────────── │ ───────────┘
                                                                            │
                        localhost WebSocket  ws://127.0.0.1:<port>          │
                        (random high port + per-session token)             │
                                                                            ▼
┌─────────── Java-сайдкар = НЕИЗМЕНЁННОЕ подписанное ядро Gravit (граница безопасности) ──┐
│                                                                                         │
│  НОВОЕ (наш код, тонкий слой):                                                          │
│    BridgeRuntimeModule  (extends LauncherModule)                                        │
│      └─ устанавливает BridgeRuntimeProvider (implements RuntimeProvider)                │
│           run(args): поднять embedded WS-сервер,                                        │
│                      пробросить LauncherBackendAPI + события callback'ов                │
│                                                                                         │
│  ИСПОЛЬЗУЕМ КАК ЕСТЬ (подписано, GPL, не трогаем):                                       │
│    ClientLauncherWrapper / LauncherEngine        — guard, self-relaunch                 │
│    LauncherBackendImpl                            — init/auth/profiles/download/verify   │
│    ClientDownloadImpl, ReadyProfileImpl           — скачивание + запуск                  │
│    ClientLauncherProcess                          — сборка JVM игры                      │
│    ECKeyHolder, HWIDProvider, secure-level, CertificatePinningTrustManager              │
│    ClientLauncherEntryPoint + DirWatcher          — целостность внутри JVM игры          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Граница безопасности и почему это GPL-safe
- **Подписанный Java-jar остаётся ровно тем, что собирает LaunchServer.** Мы НЕ пересобираем и НЕ переподписываем его своим ключом. Сервер пинит ключ LaunchServer; `client.checkSign` гейтит всё. Наш bridge-модуль попадает в этот jar через стандартный build-pipeline LaunchServer (он подписывает целиком).
- **Tauri-оболочка не встраивает GPL-код** — она запускает Java как отдельный процесс и общается через IPC. Это «arm's-length» граница: Rust-оболочка не становится производной работой от GPL-ядра. Весь репозиторий всё равно делаем под **GPL-3.0** (пользователь согласен), так что вопрос снимается полностью, но архитектурно мы и так чисты.
- **Вся защита исполняется внутри Java**, не в оболочке: secure-level ECDSA-challenge, HWID-репорт, guard-релонч `ClientLauncherWrapper`, проверка целостности `verifyHDir`/`DirWatcher` в JVM игры. Оболочка их только «оркеструет».

### Почему WebSocket, а не stdio/named pipe
Решение: **localhost WebSocket внутри Java-процесса** (рекоменд. исследования).
- API ядра асинхронный и callback-heavy (`CompletableFuture` + push-события `MainCallback`/`DownloadCallback`/`RunCallback`) — WS идеально ложится на двунаправленные сообщения.
- Guard `ClientLauncherWrapper` **перезапускает себя в дочерней JVM** — владеть stdin/stdout через этот релонч хрупко. Фиксированный/детектируемый localhost-порт переживает релонч (в Gravit уже есть конвенция localhost-порта `clientPort`).
- Безопасность: bind строго на `127.0.0.1`, случайный высокий порт, **per-session токен** в каждом сообщении (защита от локального CSRF другими процессами).
- Альтернативы (на будущее): stdio JSON-RPC (проще, но проблема релонча), named pipe / unix socket (безопаснее, больше платформенного кода) — отложено.

---

## 3. Java bridge-модуль (сторона LaunchServer/лаунчера)

Заменяет JavaFX-морду. Это **отдельный Gradle-модуль** по образцу репозитория `LauncherRuntime` (MIT), но без JavaFX. Зависит от `com.gravitlauncher.launcher:launcher-runtime:<версия ядра>`.

### Регистрация модуля
По образцу `JavaRuntimeModule`:
```java
public class BridgeRuntimeModule extends pro.gravit.launcher.modules.LauncherModule {
    // имя модуля, версия; подписка на события жизненного цикла лаунчера
    // ClientPreGuiPhase -> phase.setRuntimeProvider(new BridgeRuntimeProvider(...))
    // ClientEngineInitPhase, ClientExitPhase, ClientUnlockConsoleEvent
}
```
Manifest jar (как у `LauncherRuntime`):
```
Module-Main-Class   = <our.pkg>.BridgeRuntimeModule
Module-Config-Class = <our.pkg>.config.BridgeModuleConfig
Module-Config-Name  = VarryalRuntime
```

### SPI, который реализуем
`pro.gravit.launcher.runtime.gui.RuntimeProvider` — всего 3 метода:
```java
void preLoad();                       // ранняя инициализация
void init(boolean clientInstance);    // подготовка
void run(String[] args);              // ВМЕСТО Application.launch(...):
                                      //   1) поднять embedded WS-сервер на 127.0.0.1:<port>
                                      //   2) записать port+token в файл хендшейка для оболочки
                                      //   3) получить LauncherBackendAPIHolder.getApi()
                                      //   4) api.setCallback(new WsMainCallback(...))
                                      //   5) блокироваться, пока UI не закроется
```

### Хендшейк оболочка ↔ мост
Java стартует первым (оболочка его запускает), выбирает свободный порт и генерит токен. Чтобы Rust узнал порт/токен, мост пишет файл `${data_dir}/Varryal/ipc-handshake.json`:
```json
{ "port": 53187, "token": "b3f1...", "pid": 12345, "protocolVersion": 1 }
```
Rust ждёт появления/обновления файла (или читает строку из stdout вида `VARRYAL_IPC port=.. token=..`), затем коннектится по WS. Альтернатива на будущее — оболочка передаёт желаемый порт через `-Dvarryal.ipc.port=`.

### WS-протокол (полный каталог, 1:1 к `LauncherBackendAPI`)

**Конверт запроса (UI → Java):**
```json
{ "id": "uuid-v4", "type": "request", "method": "<name>", "token": "<session>", "params": { } }
```
**Конверт ответа (Java → UI):**
```json
{ "id": "uuid-v4", "type": "response", "ok": true,  "result": { } }
{ "id": "uuid-v4", "type": "response", "ok": false, "error": { "code": "...", "message": "..." } }
```
**Конверт события (Java → UI, push):**
```json
{ "type": "event", "channel": "main|download|run", "name": "<callbackName>", "data": { } }
```

**Методы (request → result):**

| method | params | result | маппинг на ядро |
|---|---|---|---|
| `init` | — | `{ authMethods: AuthMethod[], updateRequired: bool }` | `api.init()` → `LauncherInitData` |
| `selectAuthMethod` | `{ method }` | `{}` | `api.selectAuthMethod` → `changeAuthId` |
| `tryAuthorize` | — | `{ user: SelfUser \| null }` | `api.tryAuthorize()` (restore/refresh токена) |
| `authorize` | `{ login, password }` | `{ user: SelfUser }` | `api.authorize(login, AuthMethodPassword)` |
| `userExit` | — | `{}` | `api.userExit()` |
| `fetchProfiles` | — | `{ profiles: ClientProfile[] }` | `api.fetchProfiles()` |
| `makeClientProfileSettings` | `{ profileUuid }` | `{ settings: ClientProfileSettings }` | `api.makeClientProfileSettings(profile)` |
| `saveClientProfileSettings` | `{ settings }` | `{}` | `api.saveClientProfileSettings` |
| `downloadProfile` | `{ profileUuid, settings }` | `{ readyProfileId }` (события идут по `download`) | `api.downloadProfile(...)` → `ReadyProfile` (держим в реестре по id) |
| `runProfile` | `{ readyProfileId }` | `{}` (события идут по `run`) | `readyProfile.run(RunCallback)` |
| `cancelDownload` | `{ readyProfileId }` | `{}` | `DownloadCallback.onCanCancel` Runnable |
| `terminateGame` | `{ readyProfileId }` | `{}` | `RunCallback.onCanTerminate` Runnable |
| `getAvailableJava` | — | `{ java: Java[] }` | `api.getAvailableJava()` |
| `pingServer` | `{ profileUuid }` | `{ ping: ServerPingInfo }` | `api.pingServer` |
| `pingProfileServers` | `{ profileUuid }` | `{ ping: ServerPingInfo }` | `api.pingProfileServers` |
| `getUserSettings` | `{ name }` | `{ settings }` | `api.getUserSettings` |
| `getSelfUser` | — | `{ user, permissions, username }` | `getSelfUser/getPermissions/getUsername` |
| `isTestMode` | — | `{ testMode }` | `api.isTestMode` |
| `shutdown` | — | `{}` | `api.shutdown()` |

**События `channel:"main"` (из `MainCallback`):** `onChangeStatus{status}`, `onProfiles{profiles}`, `onAuthorize{user}`, `onNotify{header,description}`, `onExit{}`, `onShutdown{}`.

**События `channel:"download"` (из `DownloadCallback`):** `onStartPhase{phase}` (`JAVA|ASSETS|CLIENT|LAUNCH`), `onStage{stage}` (`assetVerify|hashing|diff|download|deleteExtra|done.part|done`), `onTotalDownload{bytes}`, `onCurrentDownloaded{bytes}`, `onCanCancel{}`.

**События `channel:"run"` (из `RunCallback`):** `onStarted{}`, `onCanTerminate{}`, `onNormalOutput{base64}`, `onErrorOutput{base64}`, `onFinished{code}`, `onReadyToExit{}`.

> Реестр `readyProfileId → ReadyProfile` и `→ DownloadCallback.cancel/RunCallback.terminate` Runnable'ы держим в мосте, чтобы UI мог отменять/убивать по id.

### Аутентификация (детали)
- `api.authorize(login, password)`: пароль шифруем по правилу ядра — `AuthAESPassword` если `passwordEncryptKey != null` (инжектится сервером), иначе `AuthPlainPassword`. Эту логику переносим из `core/service/AuthService` JavaFX-морды (она тонкая).
- Токены (access/refresh/expire) сохраняются ядром в `BackendSettings.auth` через `SettingsManager` — нам персистить ничего не нужно, `tryAuthorize()` сам восстановит сессию.

### Что нужно сделать пользователю на стороне LaunchServer
1. Положить наш собранный bridge-модуль в `LaunchServer/launcher-modules/` (туда, где сейчас лежит JavaFX-рантайм-модуль) **вместо** `StdJavaRuntime`.
2. Пересобрать лаунчер (`build` в консоли LaunchServer) — pipeline сам инжектит `@LauncherInject`-значения (`clientPort`, `passwordEncryptKey`, сертификат, URL'ы) и **подпишет** jar.
3. Сверить ключи `@LauncherInject("modules.javaruntime.*")`: если build pipeline жёстко ждёт имя модуля `StdJavaRuntime`/ключи `modules.javaruntime.*` — наш модуль либо переиспользует те же ключи, либо заводит свои `modules.varryalruntime.*`. **Это пункт Phase 0 — проверить по `LaunchServer.json` и build-логу.**

---

## 4. Rust / Tauri оболочка

Референс — `LauncherPrestarter/rust/5.7.x/src-tauri`. Берём структуру и расширяем.

### Обязанности
1. **First-run / провижининг JRE** (см. §5): скачать нужную версию Liberica per OS/arch, распаковать, закэшировать.
2. **Запуск подписанного jar** как фонового процесса:
   ```rust
   Command::new(<jre>/bin/{javaw.exe|java})
     .arg("-Dlauncher.noJavaCheck=true")   // не искать системную Java
     .arg("-Dvarryal.ipc=1")               // сигнал мосту поднять WS
     .arg("-jar").arg(launcher_jar)
     .spawn()                              // не ждём — это долгоживущий процесс
   ```
   На Windows — `javaw.exe` + флаг `CREATE_NO_WINDOW`, чтобы не было консольного окна.
3. **WS-клиент к Java**: прочитать `ipc-handshake.json`, подключиться, проксировать сообщения между Tauri-фронтом (`invoke`/`emit`) и Java. Вся логика протокола — в Rust; граница JS↔Rust тонкая.
4. **Окно/титлбар**: безрамочное окно (`decorations:false`), кастомный титлбар в UI с drag-region и кнопками min/max/close (платформенные нюансы — §7).
5. **Авто-обновление оболочки** (см. §8).
6. **Сплэш/индикатор** пока качается JRE и стартует ядро.

### Крейты (Cargo.toml)
```toml
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell    = "2"     # spawn + стрим stdout/stderr
tauri-plugin-updater  = "2"     # авто-апдейт оболочки
tauri-plugin-opener   = "2"     # внешние ссылки
reqwest = { version = "0.12", features = ["json", "stream"] }  # скачивание JRE
tokio   = { version = "1", features = ["full"] }
tokio-tungstenite = "0.24"      # WS-клиент к Java
serde = { version = "1", features = ["derive"] }
serde_json = "1"
zip = "2"            # распаковка Windows JRE
tar = "0.4"          # распаковка Unix JRE
flate2 = "1"         # gzip
dirs-next = "2"      # пути данных/кэша
sha2 = "0.10"        # проверка целостности JRE
```
Release-профиль как у престартера: `lto`, `opt-level="s"`, `panic="abort"`, `strip=true`.

### Хранение конфигурации оболочки
`${data_dir}/Varryal/shell-config.json`: установленные JRE (версия, путь, дата, sha), выбранная локаль/тема, путь к скачанному `Launcher.jar`, дата последней проверки апдейта. По образцу престартеровского `config.rs` (refresh если старше N дней).

### Владение IPC через guard-релонч
`ClientLauncherWrapper` перезапускает себя в дочерней JVM. Поэтому:
- WS-сервер должен подниматься в **финальной** (wrapped) JVM, а не в первой. Решение: мост проверяет системку `launcher.wrappedLaunch` — поднимает WS только когда `true` (т.е. уже внутри дочерней JVM). До этого Rust ждёт `ipc-handshake.json` с таймаутом и ретраями.
- Альтернатива: запускать с `-Dlauncher.noJavaCheck=true` и сконфигурировать запуск так, чтобы релонч не происходил (если build это позволяет). **Уточнить в Phase 1.**

---

## 5. Провижининг Java (несколько версий)

**Требование пользователя:** профили с разными версиями игры и Java; старые — Java 21, новейшие (профиль «фабрик», игра 26.1.2) — Java 25. Версия Java задаётся **per-profile на сервере** (фича Gravit). Значит лаунчер должен уметь ставить НЕСКОЛЬКО JRE и выбирать нужную под профиль.

**Важно:** раз GUI больше не JavaFX, **ядру лаунчера JavaFX не нужно** → можно ставить обычный JRE (не обязательно `-full` с JavaFX). Но «как у Gravit» и для совместимости с серверным `customJavaDownload` берём **BellSoft Liberica** (она же используется официальным престартером и гарантированно совпадает с тем, что ждёт ядро).

### Источник (Liberica API, проверено в престартере)
```
GET https://api.bell-sw.com/v1/liberica/releases
    ?version-modifier=latest
    &version-feature=<21|25>
    &bitness=64
    &os={windows|linux|macos}
    &arch={x86|aarch64}
    &package-type={zip|tar.gz}
    &bundle-type=jre          # JavaFX не нужен -> обычный jre (или jre-full если профиль требует)
```
→ JSON `[{ downloadUrl, version, filename, size, sha1 }]`. Fallback — хардкод GitHub-релиз BellSoft.
Temurin как резерв: `https://api.adoptium.net/v3/binary/latest/<feature>/ga/{windows|linux|mac}/{x64|aarch64}/jre/hotspot/normal/eclipse`.

### Алгоритм
1. UI/мост сообщает требуемую версию Java для выбранного профиля (`ClientProfileSettings.getRecommendedJava()` / `getSelectedJava()` / `isCompatible()`).
2. Rust смотрит в `shell-config.json`: есть ли уже эта major-версия под текущую OS/arch?
3. Нет → скачать (стрим + прогресс в UI), проверить sha, распаковать (`zip` на Win / `tar.gz` на Unix) в `${data_dir}/Varryal/jre/<version>-<os>-<arch>/`, записать в конфиг.
4. Передать путь к JRE в команду запуска ядра (для лаунчера) — а для **игры** версия выбирается ядром через профиль.

### Разделение «JRE лаунчера» vs «JRE игры»
- **JRE лаунчера** (на которой крутится Java-ядро Gravit): любая свежая (например Liberica 25) — ядру всё равно.
- **JRE игры**: диктуется профилем. Тут возможны два пути:
  - **(A) Пусть ядро само качает Java** через свой `UpdatePhase.JAVA` (если сервер публикует `customJavaDownload`). Минимум кода у нас, максимум «как у Gravit». **Рекомендуется**, если сервер уже отдаёт `customJavaDownload`.
  - **(B) Оболочка качает все нужные версии сама** и подсовывает их ядру как доступные (`getAvailableJava`).
- **Решение:** проверить в Phase 0, отдаёт ли сервер `customJavaDownload`. Если да → путь (A) (ядро тянет Java игры, оболочка тянет только JRE для запуска самого лаунчера). Если нет → путь (B).

---

## 6. Фронтенд-стек

### Выбор: **React + Vite + TypeScript**
Пользователь делегировал выбор. Берём React: крупнейшая экосистема готовых компонентов/иконок/инструментов под темизируемый UI, проще нанять/найти помощь, идеально под требование «удобный стек для редактирования внешнего вида». Runner-up — **Svelte** (легче бандл, и именно его использует престартер Gravit), но переиспользовать из престартера почти нечего (там крошечный UI), а экосистема React выигрывает для полноценного лаунчера.

### Стек
- **React 18 + TypeScript + Vite** (Tauri официально дружит с Vite).
- **State**: **Zustand** (лёгкий, без бойлерплейта; идеален под потоковые события download/run).
- **Роутинг**: лёгкий стейт-машинный роутер по сценам (не нужен полноценный URL-роутер в desktop-приложении) — `react-router` в memory-режиме либо свой `scene`-свитч.
- **Стили**: **CSS-переменные (дизайн-токены) + CSS Modules / vanilla-extract**. НЕ Tailwind как основа темизации — токены через CSS custom properties удобнее для не-разработчиков (см. §7). Утилитарные классы — опционально.
- **Иконки**: `lucide-react`.
- **i18n**: `i18next` + `react-i18next`, языки **RU + EN**.
- **Анимации**: `framer-motion` (плавные переходы сцен/прогресса).

### Структура проекта (монорепо)
```
E:\Varryal Runtime\
├─ docs/                      # план, исследование
├─ apps/
│  ├─ shell/                  # Tauri (Rust) — src-tauri/ + tauri.conf.json
│  └─ ui/                     # React+Vite+TS фронтенд
│     ├─ src/
│     │  ├─ ipc/              # типизированный клиент IPC (invoke/event враппер)
│     │  ├─ store/            # zustand-сторы (auth, profiles, download, run, settings)
│     │  ├─ scenes/           # login, server-menu, server-info, update, settings, console
│     │  ├─ components/       # кнопки, поля, прогресс, титлбар, модалки
│     │  ├─ theme/            # токены, theme.json loader, css-vars
│     │  └─ i18n/             # ru.json, en.json
├─ bridge/                    # Java bridge-модуль (Gradle) — BridgeRuntimeProvider
├─ .github/workflows/         # CI сборка под 3 ОС
└─ scripts/                   # хелперы сборки/подписи/раскладки
```

### Типизированный слой IPC
```
React  ──invoke("ipc_request",{method,params})──►  Rust  ──WS──►  Java
React  ◄──listen("ipc_event",{channel,name,data})── Rust ◄──WS──  Java
```
- В `apps/ui/src/ipc/` — обёртки `request<TReq,TRes>(method, params)` и `on(channel, name, handler)` с TypeScript-типами под каждый метод/событие из §3.
- Все доменные типы (`ClientProfile`, `SelfUser`, `ClientProfileSettings`, `ServerPingInfo`, `Java`, перечисления фаз/стадий) описываем в `ipc/types.ts` строго по каталогу §3.

### Сцены MVP (поток)
`login` → `server-menu` (список профилей + онлайн-пинг) → `server-info`/`update` (прогресс скачивания по событиям `download`) → `running` (консоль по событиям `run`) ; `settings` доступна из меню (RAM-слайдер, Java-аргументы, директория, выбор Java, флаги fullscreen/auto-enter). Состояния loading/error/empty для каждой сцены.

---

## 7. Дизайн-система и темизация

### Палитра «Neutral Dark» (тёмная тема) — предложение
Нейтральная, современная, без кричащего бренда: графитовая шкала (семейство Linear/Vercel/Raycast) + один спокойный сине-индиго акцент. Светлую тему закладываем как второй набор токенов на будущее.

| Токен | Hex | Назначение |
|---|---|---|
| `--bg-base` | `#0B0B0C` | фон окна (нейтральный почти-чёрный) |
| `--bg-elev-1` | `#141517` | панели/сурфейсы |
| `--bg-elev-2` | `#1B1D21` | карточки/поднятые блоки |
| `--bg-elev-3` | `#23262B` | инпуты/ховер-фон |
| `--border` | `#2A2D33` | бордеры/разделители |
| `--border-strong` | `#3A3E46` | акцентные бордеры/фокус-границы |
| `--primary` | `#5B8DEF` | акцент (спокойный сине-индиго) |
| `--primary-hover` | `#6E9BF2` | ховер |
| `--primary-press` | `#4A7CDE` | нажатие |
| `--success` | `#3FB66B` | успех/онлайн |
| `--warn` | `#E0A93B` | предупреждение |
| `--error` | `#E5575C` | ошибка |
| `--text-hi` | `#F4F4F5` | основной текст |
| `--text-mid` | `#A1A1AA` | вторичный текст |
| `--text-lo` | `#6B6F76` | подписи/disabled |

- **Типографика**: UI — **Inter** (variable); консоль/моно — **JetBrains Mono**. Шкала: 12 / 14 / 16 / 20 / 28 / 36.
- **Радиусы**: 8 (контролы) / 12 (карточки) / 16 (модалки). **Сетка/отступы**: 4-pt (4/8/12/16/24/32). **Тени**: мягкие + 1px бордер `--border` для «glassy» вида.
- Логотип Varryal — **сгенерировать** (через GPT Image, см. Roadmap), пока плейсхолдер-монограмма «V».

### Пайплайн темизации (для не-разработчиков)
1. Тема живёт в `apps/ui/src/theme/themes/<name>/theme.json`:
   ```json
   { "name": "Varryal Dark",
     "colors": { "bgBase": "#0B0D12", "primary": "#6D5EF6", "...": "..." },
     "font": { "ui": "Inter", "mono": "JetBrains Mono" },
     "radius": { "control": 8, "card": 12 },
     "assets": { "logo": "assets/logo.svg", "background": "assets/bg.png" } }
   ```
2. Загрузчик `theme/applyTheme.ts` раскладывает `theme.json` в **CSS custom properties** на `:root` (`--primary`, `--bg-base`, …). Все компоненты читают только переменные → не-разработчик меняет `theme.json` и получает новый вид без правки кода.
3. **Hot-reload** в dev (Vite watch на `theme.json`). В проде темы пакуются как ресурсы; возможна установка темы «извне» (папка `themes/` рядом с бинарником) — это и есть «удобный стек редактирования внешнего вида».
4. Документируем токены в `docs/THEMING.md` (Phase 4).

### Безрамочное окно (UX)
- `decorations:false` в `tauri.conf.json`; кастомный титлбар-компонент с `data-tauri-drag-region`.
- Кнопки окна: **Windows/Linux** — справа (min/max/close), **macos** — нативные «светофоры» слева (используем `titleBarStyle: "Overlay"`/transparent + отступ под светофоры). Один компонент `Titlebar` с платформенной раскладкой (детект через Tauri `platform()`).
- Скруглённые углы окна + тень (`transparent:true` где поддерживается).

---

## 8. Сборка и дистрибуция

### Таргеты бандлинга (`tauri build`)
| ОС | Форматы |
|---|---|
| Windows | `.exe` (NSIS) + `.msi` (WiX) |
| macOS | `.app` + `.dmg`, **universal** (`--target universal-apple-darwin`, Intel+ARM) |
| Linux | `.AppImage` + `.deb` (+ опц. `.rpm`) |

### Авто-обновление
- **Оболочка**: `tauri-plugin-updater` + `@tauri-apps/plugin-updater`. Ключи подписи апдейтов — **minisign** (`tauri signer generate`), `bundle.createUpdaterArtifacts=true`. Манифест апдейта (`latest.json`) и артефакты раздаём **с сервера пользователя рядом с LaunchServer** (как у Gravit) или GitHub Releases.
- **Java-jar лаунчера**: у Gravit свой путь обновления (`LauncherUpdater`, `CoreFeatureAPI.checkUpdates`, `UpdateVariant`). Оставляем его работать «как у Gravit» — оболочка либо тонкий престартер, либо проверяет jar-апдейт и перекачивает. Два контура апдейта независимы.

### Реальность без сертификатов (нет code-signing) — митигации
- **Windows**: будет SmartScreen «Unknown publisher». Митигация: подписать хотя бы self-signed/постепенно набрать репутацию; в инструкции по установке — «Подробнее → Выполнить в любом случае». На будущее — Azure Trusted Signing (дёшево) или EV-сертификат.
- **macOS**: Gatekeeper заблокирует неподписанное. Митигация: **ad-hoc подпись** (`codesign -s -`) + инструкция «ПКМ → Открыть» / `xattr -dr com.apple.quarantine`. На будущее — Apple Developer ID + нотаризация (`APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID`).
- **Linux**: AppImage/deb обычно без проблем; целостность через minisign-подпись апдейтера.
- Всё это документируем в `docs/INSTALL.md` с понятными скринами/шагами для игроков.

### CI (GitHub Actions)
- Матрица `windows-latest / macos-latest / ubuntu-latest`.
- Шаги: setup Rust + Node + Java 21 (для сборки bridge), `tauri build`, сборка bridge-jar, загрузка артефактов, (опц.) публикация релиза + `latest.json`.
- Кэш Cargo/npm/Gradle.

### Версионирование
SemVer для оболочки (`apps/shell`); bridge-модуль пинится к major-версии ядра Gravit (`5.7.x`). Тег `vX.Y.Z` триггерит релиз.

---

## 9. Чеклист безопасности/целостности (что НЕЛЬЗЯ ломать)
1. ✅ Запускать **именно подписанный LaunchServer'ом jar**; не пересобирать/не переподписывать своим ключом.
2. ✅ Не встраивать ядро в оболочку — только отдельный процесс + IPC.
3. ✅ Bridge-модуль попадает в jar через штатный build-pipeline LaunchServer (подпись целиком).
4. ✅ WS строго `127.0.0.1`, случайный порт, per-session токен в каждом сообщении.
5. ✅ Не глушить guard-релонч `ClientLauncherWrapper`, secure-level ECDSA, HWID-репорт, `verifyHDir`/`DirWatcher` — всё исполняется внутри Java/JVM игры как есть.
6. ✅ Инжектируемые `@LauncherInject` (clientPort, passwordEncryptKey, cert, URL) не трогать — они в бинарнике.
7. ⚠️ Перед запуском игры в BRIDGE-режиме помнить про `MinecraftAuthlibBridge` и фиксированный `clientPort`.

---

## 10. Риски и митигации

| # | Риск | Митигация |
|---|---|---|
| 1 | **Secure-level / AdvancedProtect**: сервер примет только подписанный, прошедший ECDSA+HWID клиент | Оболочка запускает настоящий подписанный jar; bridge внутри него; вся защита исполняется в Java. Никогда не модифицируем/переподписываем jar |
| 2 | **Guard self-relaunch** ломает владение IPC | WS поднимается в wrapped-JVM (`launcher.wrappedLaunch==true`); Rust ждёт `ipc-handshake.json` с ретраями; фиксированный localhost-порт переживает релонч |
| 3 | **GPL-3.0 ядра** | Arm's-length процесс+IPC + весь репозиторий под GPL-3.0 (пользователь согласен) → полностью совместимо |
| 4 | **Дрейф API** «modern core» (`LauncherBackendAPI` новый, `fetchTexture` бросает Unsupported, артефакт под новым groupId) | Пинимся к конкретной версии ядра; bridge изолирует UI от изменений; следим за релизами 5.7.x |
| 5 | **Сборка без JavaFX**: часть `core/service/*` JavaFX-морды тянет `javafx.beans`/`Platform` | Эти классы НЕ переиспользуем, а переписываем без JavaFX в bridge; проверяем, что путь движка (`launcher-runtime`/`-start`/`-client`) не импортит JavaFX (по исследованию — не импортит) |
| 6 | **Имя модуля/inject-ключи** build-pipeline ждёт `StdJavaRuntime` | Phase 0: прочитать `LaunchServer.json`+build-лог; при необходимости переиспользовать ключи `modules.javaruntime.*` или завести свои |
| 7 | **Нет сертификатов** → предупреждения ОС | §8 митигации + понятная инструкция игрокам; путь к подписи на будущее |

---

## 11. Roadmap по фазам

**Исполнение:** реализацию ведёт **Sonnet** автономно (по этому плану); **ревью — Opus** (я) после готовности или при блокере. Все операции с боевым VDS/LaunchServer (чтение конфигов, сборка bridge на сервере, рестарт, E2E-проверки) делает **Opus лично** — у Sonnet только локальный код, VDS он НЕ трогает. Если Sonnet упирается в блокер (нужен сервер / неясная деталь) — переключается на другую часть и продолжает; блокеры разбираем потом вместе. Метки **EASY/HARD** ниже = относительная сложность/риск задачи.

### Phase 0 — Pre-flight & скелет  · лейн: HARD(скелет)/EASY(шаблоны)
- Прочитать `LaunchServer.json` пользователя: protect-handler (No/Std/Advanced), HWID on/off, подпись jar, `clientPort`, `passwordEncryptKey`, auth-method id(ы), `customJavaDownload`.
- `git init` в `E:\Varryal Runtime`, создать GitHub-репозиторий (под аккаунтом пользователя), `.gitignore`, GPL-3.0 LICENSE.
- Скелет монорепо (§6): `apps/shell` (tauri init), `apps/ui` (vite react-ts), `bridge` (Gradle модуль по образцу `LauncherRuntime`), `.github/workflows` заготовка.
- **Acceptance**: `apps/ui` запускается (`vite dev`), `apps/shell` собирается пустым окном, bridge-модуль компилируется, известны все параметры сервера.

### Phase 1 — Java bridge-модуль + WS-протокол  · лейн: HARD
- `BridgeRuntimeModule` + `BridgeRuntimeProvider` (реализует `RuntimeProvider`), embedded WS-сервер (Java-WebSocket/Javalin), хендшейк-файл.
- Полный маппинг `LauncherBackendAPI` ↔ WS (§3): все методы + проброс `MainCallback`/`DownloadCallback`/`RunCallback`.
- Перенос логики `AuthService` (шифрование пароля) без JavaFX.
- Собрать модуль через LaunchServer, проверить headless-клиентом (временный CLI/JS-скрипт): `init → authorize → fetchProfiles`.
- **Acceptance**: с тестового WS-клиента проходит логин и приходит список профилей с реального LaunchServer.

### Phase 2 — Rust-оболочка: JRE + spawn + IPC  · лейн: HARD(spawn/guard/WS) / EASY(download/extract — порт престартера)
- Перенести из престартера: `download.rs`/`extract.rs`/`config.rs`; расширить на **мульти-версию** (21 и 25).
- `runner.rs`: запуск подписанного jar (`-Dlauncher.noJavaCheck`, `javaw`+no-console на Win).
- WS-клиент к Java + проксирование в Tauri `invoke`/`emit`; обработка guard-релонча (ожидание хендшейка).
- Сплэш/прогресс провижининга.
- **Acceptance**: бинарник на Windows скачивает JRE, поднимает ядро, фронт получает `init`-данные через мост.

### Phase 3 — Фронтенд MVP (поток логин→сервер→скачивание→запуск)  · лейн: HARD(IPC/состояние) / EASY(разметка сцен после паттерна)
- Типизированный `ipc/` слой + zustand-сторы.
- Сцены: `login`, `server-menu` (+онлайн-пинг), `update`/прогресс (события `download`), `running`/консоль (события `run`), `settings` (RAM/Java/dir/флаги).
- i18n RU/EN, состояния loading/error.
- **Acceptance (= граница MVP)**: на Windows полный путь **вход → выбор профиля → скачивание с хэш-проверкой → запуск игры**, видна консоль, игра стартует через настоящий guard.

### Phase 4 — Дизайн-система и темизация  · лейн: EASY(токены) / designer-проход
- Токены §7, `theme.json`→CSS-vars пайплайн, безрамочный титлбар (платформенный), полировка тёмной темы, анимации.
- Сгенерировать логотип Varryal (GPT Image) и иконки приложения (все размеры/форматы под 3 ОС).
- `docs/THEMING.md`.
- **Acceptance**: смена `theme.json` меняет вид без правки кода; UI выглядит на уровне Modrinth/GDLauncher; есть логотип/иконки.

### Phase 5 — Сборка, дистрибуция, авто-апдейт  · лейн: HARD(CI/updater) / EASY(конфиги)
- `tauri build` под Win/macOS(universal)/Linux; CI-матрица; minisign-ключи + `latest.json`; хостинг артефактов «как у Gravit»; митигации без сертификатов (§8); `docs/INSTALL.md`.
- **Acceptance**: собираются артефакты под 3 ОС; авто-апдейт оболочки работает на тестовом релизе.

### Phase 6 — Харднинг и кросс-платформенная проверка  · лейн: HARD
- E2E против защищённого сервера: secure-level + HWID реально проходят на всех ОС.
- Edge-cases: обрыв сети при скачивании, отмена/терминирование, повреждённый кэш JRE, повторный вход, истёкший токен.
- Полировка ошибок/уведомлений, финальный QA.
- **Acceptance**: чистый прогон логин→запуск на Windows, macOS, Linux против боевого LaunchServer.

---

## 12. Статус открытых вопросов (закрыто разведкой — см. §1.1)
1. ✅ Protect-handler = **advanced**, **HWID выключен**.
2. ✅ jar **подписывается** (PKCS12); гард — **нативный `LauncherGuard`** для игры (`protectLauncher:false`), хост-процесс роли не играет.
3. ✅ Auth = кастомный `varryal` (login/password), `clientPort`/cert инжектятся; `certificatePinning:false`, `encryptRuntime:false`.
4. ✅ `customJavaDownload` пуст → Java качает оболочка/престартер (путь B, §5).
5. ⏳ Имя модуля: текущий — `JavaRuntime`. Наш bridge либо берёт то же имя (drop-in), либо своё + правка `modules.json` (тривиально, сервер наш). Подтвердить при первой вкатке.

---

> **Следующий шаг:** утвердить план (или скорректировать), затем Phase 0 — дай путь к `LaunchServer.json`, и я инициализирую репозиторий и скелет.
