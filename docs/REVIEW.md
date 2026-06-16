# Varryal Launcher — Review (Opus), 2026-06-16

Ревью реализации Sonnet. Гейты перепроверены независимо.

## Вердикт
- ✅ **Gate B** (`gradle clean build` в `bridge/`) — зелёный, перепроверен лично. Bridge реально компилируется против настоящего `com.gravitlauncher.launcher:launcher-runtime:5.7.10`. Это доказывает, что API-маппинг не выдуман.
- ✅ **Gate C** (`pnpm build` в `apps/ui`) — зелёный, перепроверен лично (349 KB).
- ⏳ **Gate D** (Tauri/Rust) — не компилируется (cargo не установлен), код написан, ревью по чтению.

## Качество (хорошо)
- **Bridge** (`IpcDispatcher`, `WsBridgeServer`, `BridgeRuntimeProvider`, `BridgeRuntimeModule`): аккуратно, все методы §3 замаплены, сигнатуры сверены с jar через `javap`. Race на порту реально починен (порт берётся в `onStart()` + `awaitStart()` латч). Регистрация через `ClientPreGuiPhase → phase.runtimeProvider` корректна.
- **Frontend**: полная структура (ipc, 5 сторов, 5 сцен, темы, i18n, титлбар), собирается.
- **Согласованность handshake-пути** Java↔Rust проверена: оба пишут/читают `%APPDATA%\Varryal` (Win) и `~/Varryal` (unix) — совпадает. ✓

## Находки (все — Phase 2 интеграция, требуют компиляции Rust + живого сервера)
| # | Severity | Файл | Проблема | Фикс |
|---|---|---|---|---|
| F1 | **medium** | `main.rs` `bootstrap` | Провижинит Java **21**, а профиль `varryal_main` требует **25** (`minJavaVersion:25`). Игра не получит нужную Java. | Провижинить 25 (или версию из профиля). `ensure_version()` уже параметризован. |
| F2 | **medium** | `runner.rs` `resolve_jar` | `Varryal.jar` нигде не скачивается и не бандлится — `resolve_jar` упадёт в рантайме. | Скачивать `https://launcher.varryal.ru/Varryal.jar` (+ self-update), либо бандлить как resource. |
| F3 | low | `jre.rs` | sha1 JRE не проверяется, хотя комментарий говорит обратное. | Проверять sha из ответа Liberica API. |
| F4 | low | `config.rs` vs `ipc_proxy.rs` | `shell-config.json`/`jre` лежат в `app_data_dir` (с identifier), handshake — в `%APPDATA%\Varryal`. Не баг, но непоследовательно. | Унифицировать базовый путь. |
| F5 | low | интеграция | JRE, скачанные оболочкой, должны быть видимы ядру (`JavaHelper.findJava`) или выставлены как `selectedJava`. | Проверить при first integration test. |

## Что осталось и чьё это
- **Sonnet** (можно автономно, без сервера): закрыть F1–F4, дописать скачивание `Varryal.jar`, проверить, что титлбар реально дёргает window-controls через capabilities.
- **Opus (я)**: (a) CI → реальная компиляция Tauri под Win/Mac/Linux; (b) аккуратный smoke-test моста на сервере **без замены боевого лаунчера**; (c) генерация логотипа; (d) push на GitHub.
- ⚠️ **Прод-риск**: серверная команда `build` перезапишет боевой `updates/Varryal.jar`, который качают игроки. Полную вкатку делаем только в окно обслуживания с твоего ведома, не втихую.

---

## Pass 2 — addressed (Sonnet, 2026-06-16)

| # | Статус | Детали |
|---|---|---|
| F1 | **CLOSED** | `LAUNCHER_JAVA_MAJOR = 25` в `main.rs`; `ensure_version` параметризован; TODO для per-profile provisioning после login задокументирован в коде. |
| F2 | **CLOSED** | `runner.rs`: `VARRYAL_JAR_URL` константа; `resolve_jar` async — скачивает если нет или старее 7 дней; SHA-1 логируется; `cfg.jar_downloaded_at` сохраняется. |
| F3 | **CLOSED** | `LibericaRelease.sha1` десериализуется; `download_file_with_sha1` считает digest через `sha1` crate (RustCrypto); mismatch → delete + bail. `sha1 = "0.10"` добавлен в Cargo.toml (компилируется в CI). |
| F4 | **CLOSED** | `paths.rs` — `varryal_data_dir()`: Windows `%APPDATA%\Varryal`, Unix `~/Varryal`. Используется в `config.rs`, `jre.rs`, `runner.rs`, `ipc_proxy.rs`. Совпадает с `WsBridgeServer.writeHandshake()` побайтово. |
| Window controls | **CLOSED** | `Titlebar.tsx` — `import('@tauri-apps/api/window').getCurrentWindow()` lazy import; `@tauri-apps/api 2.11.0` добавлен в `package.json`; `capabilities/default.json` — добавлены `allow-maximize`, `allow-unmaximize`. Gate C зелёный (350.52 kB). |
| F5 | **DEFERRED** | JRE-пути видимости ядру (`JavaHelper.findJava`) — требует live-интеграционного теста с реальным сервером. Для Opus при Phase 2. |
