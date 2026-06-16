# Промпт для агента по порталу (varryal-portal-v2) — браузерная авторизация лаунчера

> Скопируй всё, что ниже разделителя, и дай агенту (Opus) в репозитории портала.
> Это **только портальная часть**. Java-лаунчер, Gravit-рантайм и `VarryalAuth`-модуль делаются отдельно (на стороне лаунчера) и состыкуются по контракту ниже.

---

# Задача: веб-авторизация нового десктоп-лаунчера Varryal (browser-based / OAuth-redirect)

## Контекст
Для Minecraft-сервера Varryal делается **новый десктопный лаунчер** (Tauri). Авторизация в нём — **браузерная, как в Claude Code / OAuth**: лаунчер открывает в системном браузере страницу портала, игрок логинится (email+пароль ИЛИ Discord) и **выбирает персонажа**, после чего портал **редиректит обратно в лаунчер** с токеном игровой сессии этого персонажа. Лаунчер ловит редирект (custom URL scheme `varryal://`), достаёт токен и валидирует его на сервере.

**Твоя зона — ТОЛЬКО портал** (этот репозиторий; на прод-VDS он лежит в `/opt/varryal-portal-v2`, монорепо `apps/api` + `apps/web` + `apps/worker`). Реализуй веб-страницу логина-для-лаунчера и контракт редиректа. **НЕ трогай** Java/launchserver/Gravit/`VarryalAuth`-модуль — это другая зона; тебе нужно лишь отдать токен по контракту ниже.

## Контракт лаунчер ↔ портал (это интерфейс — реализуй ровно так)

**1. Вход (лаунчер открывает в браузере):**
```
GET https://varryal.ru/launcher/login?redirect_uri=<URI>&state=<opaque>
```
- `redirect_uri` — куда вернуть результат. Допустимые форматы (ОБЯЗАТЕЛЬНО валидировать по allowlist):
  - `varryal://auth/callback` (custom scheme лаунчера) — основной;
  - `http://127.0.0.1:<port>/callback` (loopback) — опционально.
  Любой другой `redirect_uri` → **400 / страница ошибки, БЕЗ редиректа** (защита от open-redirect и утечки токена).
- `state` — непрозрачная строка от лаунчера; верни её **без изменений** в редиректе (CSRF/корреляция).

**2. Успех (после логина + выбора персонажа):**
```
302 → <redirect_uri>?token=<minecraftSessionToken>&state=<state>
```

**3. Ошибка/отмена:**
```
302 → <redirect_uri>?error=<code>&state=<state>
```
коды `error`: `access_denied` (отмена), `email_not_verified`, `password_login_unavailable` (Discord-аккаунт без пароля), `server_error`.

**4. `token`** — это **тот же per-character Minecraft session JWT**, который принимает уже существующий `GET /launcher/sessions/validate?token=...` (см. `launcher.service.validateSession` / `signMinecraftToken`). Короткий TTL, одноразовость желательна.

> Хочешь надёжнее — можешь отдавать одноразовый `code` вместо `token` и завести бекенд-обмен `code → token`; тогда задокументируй это в контракте, и лаунчер подстроится. По умолчанию — токен прямо в редиректе (короткоживущий).

## Что уже есть в портале (изучи и переиспользуй, не дублируй)
- Better Auth (`@varryal/auth/server`): `auth.api.signInEmail({ email, password })`, `auth.api.getSession({ headers })`. Провайдеры: `credential` (email+пароль) и `discord`. БД Postgres через drizzle `@varryal/db` (таблицы `user`/`account`, snake_case; `user.email_verified`, `account.provider_id`, `account.password`).
- Лаунчер-API в `apps/api/src/launcher/`:
  - `launcher-auth.controller.ts` — `POST /launcher/auth/login` (email+password → `accountAccessToken` = Better Auth session cookie). Классификация ошибок через `@varryal/shared` `LAUNCHER_AUTH_ERROR_CODES` (`EMAIL_NOT_VERIFIED` / `PASSWORD_LOGIN_UNAVAILABLE` / `INVALID_CREDENTIALS`). Есть rate-limit.
  - `launcher.service.ts` — `login`, `resolveAccountId(accountAccessToken)`, `listCharacters(accountId)`, **`createSession(accountId, characterId) → { minecraftAccessToken, uuid, username, ... }`**, `validateSession(token)`, `profileBy*`.
  - `launcher-account-gateway.ts` — граница Better Auth (`BetterAuthAccountGateway`).
  - `launcher-token.ts` — `signMinecraftToken(claims, jwtSecret, ttl)` / `verifyMinecraftToken`. Claims: `{ accountId, characterId, uuid, username }`, `iss: "varryal-portal"`.
  - `launcher-me.controller.ts`, `launcher-service.controller.ts`, `launcher.store.ts`, `launcher.module.ts`.
- Персонажи: у аккаунта несколько персонажей; у каждого `generatedNickname` (= ник в игре), `minecraftUuid`, name/surname/alias, race, skinPreviewUrl/skinUrl/skinModel. Игровая сессия = per-character.
- `apps/web` — фронтенд портала (там уже есть UI логина Better Auth — переиспользуй его).

> ВАЖНО: эти факты собраны быстрым осмотром. **Сначала сам пройдись по репозиторию** и подтверди реальную структуру/имена, потом реализуй по конвенциям проекта.

## Что сделать
1. **Изучи** существующий portal-логин в `apps/web` и лаунчер-API в `apps/api/src/launcher`. Максимально переиспользуй Better Auth и `createSession`.
2. **Страница/route `/launcher/login`** в `apps/web`:
   1. Прочитай `redirect_uri` + `state`. **Провалидируй `redirect_uri` по allowlist** — иначе страница ошибки без редиректа. Сохрани `redirect_uri`+`state` на время флоу (signed cookie / server-side session), чтобы не доверять им из формы напрямую на шаге минта.
   2. Если пользователь уже залогинен в портал (Better Auth session) — **пропусти логин**; иначе покажи вход: email+пароль **и кнопку «Войти через Discord»** (переиспользуй существующий Better Auth UI). Discord-вход уводит на OAuth Discord и возвращается на эту же страницу.
   3. После логина — экран **выбора персонажа** (список через существующий character-механизм; для каждого: ник `generatedNickname`, раса, превью скина).
   4. По выбору персонажа — сминти токен (шаг 3) и сделай **302 на `redirect_uri?token=...&state=...`**.
   5. Кейсы: `EMAIL_NOT_VERIFIED` и `PASSWORD_LOGIN_UNAVAILABLE` (аккаунт через Discord без пароля) — понятные сообщения и/или `error=...` редирект; кнопка «Отмена» → `error=access_denied`.
3. **Минт токена** (если подходящего эндпоинта ещё нет): авторизован **портал-сессией** (Better Auth cookie), вход `{ characterId }`; проверь, что персонаж принадлежит этому аккаунту и «живой»; сминти через существующий `createSession`/`signMinecraftToken`; верни/редиректни с токеном. TTL — как у обычной игровой сессии (короткий).
4. (Опц.) Поддержка `http://127.0.0.1:<port>` redirect — тоже строго через allowlist.

## Безопасность (обязательно)
- **Строгий allowlist `redirect_uri`**: только `varryal://...` и (опц.) `http://127.0.0.1[:\d+]/...`. Никогда не редиректить на произвольный хост — это утечка токена.
- `state` обязателен, эхо без изменений; используй для CSRF/корреляции.
- Токен короткоживущий и желательно одноразовый (раз он летит в query редиректа). **Не логируй токен** (в pino-redact добавь `token`, `*.minecraftAccessToken`).
- Минт токена — только под аутентифицированной портал-сессией и только для персонажа этого аккаунта. Rate-limit (как в существующем launcher-auth).
- Не доверяй `redirect_uri` со страницы на шаге минта — бери из сохранённого server-state.

## Definition of Done / ограничения
- Прод-портал: следуй существующим конвенциям (NestJS-модули, drizzle, Better Auth, pino). **Не ломай** существующие лаунчер-эндпоинты (`/launcher/auth/login`, `/launcher/sessions/validate`, `/launcher/me/*`).
- **Не трогай** Java/launchserver/Gravit/`VarryalAuth` — вне твоей зоны.
- Тесты по образцу существующих `*.test.ts`: allowlist-валидация `redirect_uri`; полный успешный флоу (login → выбор персонажа → токен → редирект с эхо `state`); ошибки (`email_not_verified`, `password_login_unavailable`, отмена); чужой/несуществующий персонаж отклоняется.
- Атомарные коммиты. Никаких секретов в коде.
- В конце создай **`docs/LAUNCHER-WEBAUTH.md`** с ФИНАЛЬНЫМ контрактом: точный URL входа и параметры, формат успешного редиректа и ошибок, формат/TTL токена, allowlist `redirect_uri`, и (если выбрал) схему `code → token`. Этот документ нужен команде лаунчера, чтобы состыковать клиент.
