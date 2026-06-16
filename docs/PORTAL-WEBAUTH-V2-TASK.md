# Промпт для агента по порталу (varryal-portal-v2) — web-auth v2: возвращать ACCOUNT-токен

> Скопируй блок ниже агенту портала. Это ИЗМЕНЕНИЕ существующего launcher web-auth (ветка `feat/launcher-webauth`).
> Цель: убрать выбор персонажа из браузера. Браузер делает ТОЛЬКО логин аккаунта и возвращает в лаунчер **account-токен**; персонажей лаунчер показывает и переключает уже у себя нативно.

---

# Задача: web-auth v2 — браузер возвращает account-токен (выбор персонажа уходит в лаунчер)

## Зачем
Текущий флоу делает в браузере и логин, И выбор персонажа, и отдаёт per-character токен. Нужно иначе: **браузер только логинит аккаунт сайта**, а список/переключение персонажей делает сам десктоп-лаунчер (через уже существующие `GET /launcher/me/characters` и `POST /launcher/me/characters/{id}/session`). Это также убирает текущий баг с Next.js Server Action на странице выбора персонажа (страница выбора в браузере больше не нужна).

## Что изменить в контракте
Точки входа и валидация `redirect_uri`/`state` — **без изменений** (см. `docs/LAUNCHER-WEBAUTH.md` §1–§2; allowlist `varryal://auth/callback` и `http://127.0.0.1:<port>/callback`, `state` эхо).

**Меняется ТОЛЬКО результат:** после **успешного логина аккаунта** (email+пароль ИЛИ Discord) портал сразу делает серверный redirect:
```
302 → <redirect_uri>?token=<ACCOUNT_TOKEN>&state=<state>
```
где **`ACCOUNT_TOKEN`** — это account access token (та же строка, что выдаёт `POST /launcher/auth/login` как `accountAccessToken` и которую принимают `GET /launcher/me/*` как `Authorization: Bearer <...>`). **НЕ** per-character minecraft-токен.

Ошибки/отмена — как раньше: `302 → <redirect_uri>?error=<code>&state=<state>` (`access_denied`, `email_not_verified`, `password_login_unavailable`, `server_error`).

## Конкретно
1. **`/launcher/authorize`**: оставить логин (email+пароль + Discord, возврат на эту же страницу). **Убрать экран выбора персонажа** (`LauncherCharacterOption`, форму на `/launcher/select`). Как только в этом флоу есть валидная flow-cookie И активная портал-сессия — **сразу серверный redirect** на `redirect_uri?token=<account_token>&state=...`.
   - Делай redirect **серверно** (route handler / `redirect()` в server component), **без Server Action и без клиентских форм-экшенов** — это и чинит баг «Failed to find Server Action».
2. **account_token**: возьми текущую портал-сессию (Better Auth) и преврати в строку, пригодную как `Bearer` для `/launcher/me/*` (та же, что отдаёт `accountAccessToken` в `launcher-account-gateway` / `extractSessionCookie`). Короткий TTL (как у обычной сессии аккаунта).
3. **Можно удалить/задеприкейтить**: `/launcher/select` route и `POST /launcher/web-auth/session` (минт per-character) — лаунчер теперь сам минтит через нативные `/launcher/me/characters/{id}/session`. (Если проще оставить — оставь, но из флоу убери.)
4. **Не трогай** нативные `/launcher/auth/login`, `/launcher/me/characters`, `/launcher/me/characters/{id}/session`, `/launcher/sessions/validate` — лаунчер на них опирается.

## Безопасность
- `redirect_uri` allowlist + `state` эхо — без изменений.
- account_token летит в `varryal://`/loopback redirect (как и раньше токен) — кастомная схема/loopback, не уходит на удалённый origin; не логировать (pino redact уже есть).
- redirect только при валидной портал-сессии этого флоу.

## Definition of Done
- После логина в браузере портал редиректит `varryal://auth/callback?token=<account_token>&state=...` (без шага выбора персонажа).
- Серверный redirect (без Server Action) — баг «Failed to find Server Action» уходит.
- Обнови `docs/LAUNCHER-WEBAUTH.md`: token теперь = **account access token** (Bearer для `/launcher/me/*`), per-character минт делает лаунчер. Тесты под новый флоу.
- Не ломать нативные launcher-эндпоинты.
