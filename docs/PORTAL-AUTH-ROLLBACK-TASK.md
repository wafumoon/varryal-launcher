# Задача для агента сайта: откат браузерного launcher web-auth

> Это самодостаточный промпт. У тебя нет памяти о предыдущих обсуждениях — действуй только по этому тексту.

## Контекст и цель

Лаунчер Varryal **отказался от браузерного входа** (флоу `varryal://` deep-link).
Причина: браузер молча блокировал программный переход на внешний протокол
(`window.location.replace('varryal://…')`) — у пользователя даже не появлялось
окно «Открыть приложение», и токен в лаунчер не доходил.

Теперь лаунчер логинится **напрямую по email+паролю** через уже существующий
нативный JSON-API (`POST /api/launcher/auth/login` → `accountAccessToken` →
`/api/launcher/me/*`). Браузер в авторизации больше не участвует.

**Цель:** убрать с прод-сайта весь браузерный launcher-webauth слой
(страницы `/launcher/login|authorize|complete`, flow-куку, редирект на
`varryal://`), **НЕ трогая** нативный API, на который лаунчер теперь опирается.

---

## ❌ УДАЛИТЬ / ОТКАТИТЬ (браузерный launcher-webauth)

Это всё, что добавлялось в ветке `feat/launcher-webauth` (последний релиз
`20260616-135737-v13-launcher-webauth-fix3`) и описано в `docs/LAUNCHER-WEBAUTH.md`:

1. **Страницы/роуты в `apps/web`:**
   - `/launcher/login` (v1) и `/launcher/authorize` (v2) — страница входа,
     принимавшая `redirect_uri` + `state`.
   - `/launcher/complete` — страница с `window.location.replace('varryal://auth/callback?token=…&state=…')`.
   - `/launcher/select` + компонент `LauncherCharacterOption` (если остались).
2. **Серверный редирект** на `varryal://auth/callback?token=<account_token>&state=<…>`
   (и любой `redirect_uri`-allowlist: `varryal://auth/callback`,
   `http://127.0.0.1:<port>/callback`).
3. **Flow-кука `varryal_launcher_flow`** — её выпуск, HMAC-подпись/проверка,
   middleware/guard, `path=/launcher`, TTL 900с и т.п. Полностью убрать.
4. **`POST /launcher/web-auth/session`** (внутренний минт токена для лаунчера),
   если он использовался только этим браузерным флоу.
5. **`docs/LAUNCHER-WEBAUTH.md`** — удалить или пометить как obsolete.
6. **Деплой:** выкатить прод без перечисленного (фактически — состояние до
   `feat/launcher-webauth` по этим файлам).

---

## ✅ ОБЯЗАТЕЛЬНО ОСТАВИТЬ (нативный API — лаунчер на нём держится)

⚠️ **НЕ делай сплошной `git revert` всей ветки `feat/launcher-webauth`**, если
нативные эндпоинты лежат в ней — удаляй точечно только браузерные куски выше.
Эти эндпоинты ДОЛЖНЫ продолжать работать без изменений:

- `POST /api/launcher/auth/login` — body `{ "email", "password" }` →
  `{ accountId, displayName, accountAccessToken, accountAccessExpiresAt }`.
  Классификация ошибок (`EMAIL_NOT_VERIFIED` / `PASSWORD_LOGIN_UNAVAILABLE` /
  `INVALID_CREDENTIALS`) и человекочитаемое поле `message` — **сохранить**
  (лаунчер показывает `message` пользователю напрямую).
- `GET /api/launcher/me/characters` — `Authorization: Bearer <accountAccessToken>`.
- `POST /api/launcher/me/characters/{id}/session` — `Authorization: Bearer <…>` →
  `{ minecraftAccessToken, uuid, username, … }`.
- `GET /api/launcher/sessions/validate?token=<minecraftAccessToken>` — этим
  валидирует токен сам LaunchServer при `authorize`. Ломать нельзя.
- Нативная аккаунт-сессия (Better Auth), выдающая `accountAccessToken` как
  Bearer — без изменений.

Также: основной вход/логаут на сайте (Better Auth) не должен пострадать.

---

## Критерии приёмки (выполни и приложи вывод)

Браузерный слой удалён:
- `GET https://varryal.ru/launcher/login` → 404
- `GET https://varryal.ru/launcher/authorize` → 404
- `GET https://varryal.ru/launcher/complete` → 404
- Нигде не выставляется кука `varryal_launcher_flow`; нет редиректов на `varryal://`.

Нативный API жив (проверь curl'ом на реальном тестовом аккаунте):
```bash
# 1) логин — должен вернуть accountAccessToken
curl -s -X POST https://varryal.ru/api/launcher/auth/login \
  -H "Content-Type: application/json" \
  --data '{"email":"<EMAIL>","password":"<PASSWORD>"}'
# ожидаем 200 + {accountId, displayName, accountAccessToken, accountAccessExpiresAt}
# неверный пароль → 401 + {"message":"Неверная почта или пароль.", ...}

# 2) персонажи по Bearer
curl -s https://varryal.ru/api/launcher/me/characters \
  -H "Authorization: Bearer <accountAccessToken>"
# ожидаем 200 + {"items":[ … ]}

# 3) сессия персонажа
curl -s -X POST https://varryal.ru/api/launcher/me/characters/<CHAR_ID>/session \
  -H "Authorization: Bearer <accountAccessToken>" -H "Content-Type: application/json" --data '{}'
# ожидаем 200 + {"minecraftAccessToken": "…", …}
```

Регресс основного сайта:
- Обычный вход/логаут аккаунта на сайте работает как раньше.

Когда всё зелёное — отпиши, что откатил, какой релиз сейчас на проде, и приложи
вывод трёх curl-проверок (токены замазать).
