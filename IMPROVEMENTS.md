# Аудит и план улучшений

Репозиторий: `chromolom` (Chrome-расширение Flow Local Test Runner, MV3).
Исходная точка — коммит `230f5b4`, версия **4.0.0**.

---

## Часть 1. Что было не так (аудит от 2026-09-14)

### 🔴 Критично

| # | Проблема | Доказательство |
| --- | --- | --- |
| 1 | `npm test` выполнял **8 тестов из 17** | `node --experimental-vm-modules tests/*.test.js` — Node берёт как entry point только первый файл, остальное уходит в `argv`. Все 9 тестов `security.test.js` молча пропускались, exit code = 0. |
| 2 | `npm run validate` падал | `node -c manifest.json` → `SyntaxError: Unexpected token ':'`. Флага `-c` не существует. |
| 3 | `config.js`, `security.js`, `metrics.js` — мёртвый код; ни одна проверка безопасности не работала | Гrep по runtime-коду: `validateUrl`, `validateBundleSize`, `sanitizeErrorMessage`, `isIncognitoTab`, `metricsTracker`, `STORAGE_KEYS` — **0 вызовов**. CHANGELOG 4.0.0 обещал всё это. |
| 4 | `patch.test.js` почти не тестировал `patch.js` | Из 8 тестов настоящих — 2. Остальные: `assert.strictEqual(31, 31)`, `assert.strictEqual(null, null)`, `assert.strictEqual(isKeyword, true)` (только что посчитан тем же выражением). Покрытие 5 стратегий патча = **0%**. |

### 🟠 Важно

5. **`patch.js` — IIFE + `globalThis` вместо ESM.** Побочный эффект при импорте,
   тесты невозможно изолировать, forced callee передавался через глобальную
   переменную `__flowPatchForceCallee`.
6. **8 разделяемых `/g`-регулярок на уровне модуля** с ручным сбросом `lastIndex`
   в 5 местах. Один забытый сброс — стратегия молча пропускает совпадение.
7. **Нет CI.** CONTRIBUTING требовал «Tests must pass», но ничего не запускалось.
8. **Недостижимый обработчик `_execute_action`.** Зарезервированные команды не
   приходят в `commands.onCommand`, они диспатчат `action.onClicked` — ~20 строк
   мёртвого дубля `toggleAutomaticMode`.
9. **`initializeEnabledState()` вызывался 3 раза** и каждый раз глобально
   перезатирал per-tab статус активной сессии.

### 🟡 Консистентность

10. `status.html` показывал **«Version 3.1.0»** при версии расширения 4.0.0.
11. README: захардкожен Windows-путь `E:\HeroSMS\flow-chrome-addon`.
12. `homepage_url` = заглушка `your-org`; `"optional_permissions": []` — пустой массив.
13. `.gitignore` — проза вместо паттернов.
14. CHANGELOG ссылался на несуществующие «Architecture diagram», «API documentation».
15. Смешанные CRLF/LF, нет trailing newline в 5 файлах, `npm run lint` = `echo`.

---

## Часть 2. Что сделано

### Тесты и проверки

- `npm test` → `node --test tests/*.test.js`: **все файлы выполняются**.
- Переписан `tests/patch.test.js`: **20 тестов**, реальное покрытие всех пяти
  стратегий (успех, «не уникально», «не найдено»), плюс регрессионный тест на
  утечку `lastIndex` между вызовами.
- Добавлены `tests/metrics.test.js` (9) и `tests/config.test.js` (6).
- **Итого 43 теста (было 8 рабочих), 43 pass.**
- `npm run validate` → `scripts/validate-manifest.js`: JSON, обязательные ключи,
  существование всех файлов из манифеста, синхронизация версии с `package.json`.
- `npm run lint` → `scripts/check-syntax.js`: `node --check` для каждого `.js`
  + проверка CRLF / trailing newline / табов. **Без зависимостей.**
- `npm run check` — всё вместе. CI: `.github/workflows/ci.yml` на Node 18/20/22.

### Модули подключены (вместо удаления)

`background.js` теперь импортирует `config.js`, `security.js`, `metrics.js`:

- константы больше **не дублируются** — один источник истины;
- `validateBundleSize()` проверяет размер **до** декодирования бандла
  (новый `estimateByteLength()` учитывает base64);
- `validateUrl()` отклоняет URL бандла вне `https` + allowlist;
- `sanitizeErrorMessage()` применяется ко всему, что попадает в
  `chrome.storage.local` и в подсказку иконки (был сырой `error.message`);
- `metricsTracker.recordAttempt()` вызывается в `completeSession` / `failSession`
  / `recordFailure`, метрики персистятся и **показываются на странице состояния**.

### Архитектура

- `patch.js` — чистый ESM, без глобальных побочных эффектов. Регулярки
  хранятся как **строки-источники** и компилируются на месте: состояние
  `lastIndex` больше не может протечь между вызовами.
- forced callee передаётся параметром `patchSource(source, { forcedCallee })` —
  глобальный канал `__flowPatchForceCallee` удалён.
- Удалён недостижимый блок `_execute_action`.
- `ensureInitialized()` — идемпотентная инициализация, не сбрасывает статус
  активных сессий.
- Вынесен `recordFailure()` — убрано тройное дублирование записи ошибки.

### Мелочи

Версия на странице состояния берётся из манифеста, README без чужих путей,
`homepage_url` исправлен, пустой `optional_permissions` убран, настоящий
`.gitignore`, `.editorconfig`, все файлы в LF с trailing newline.

---

## Часть 3. Что осталось (не делал — нужно решение)

| Задача | Почему отложено |
| --- | --- |
| **Подключить `isIncognitoTab()` и `createTimeoutController()`** | Решение продуктовое: блокировать ли патч в инкогнито. Сейчас функции подключены частично — эти две остаются неиспользуемыми. |
| **`MAX_DECODE_ATTEMPTS`** | Константа по-прежнему нигде не используется (не было и раньше). Либо реализовать повторные попытки декодирования, либо удалить. |
| **ESLint + Prettier** | Требуют `devDependencies`; репозиторий намеренно без зависимостей. `npm run lint` сейчас делает честную проверку синтаксиса и гигиены — этого хватает до появления реальной нужды. |
| **ESM-моки для `background.js`** | Самый крупный файл (700+ строк) не покрыт тестами: нужен мок `chrome.*`. Окупается только если логика сессий будет меняться. |
| **i18n** | README на русском, UI на английском, `<html lang="ru">`. Выровнять язык или добавить локализацию для Web Store. |
| **Диаграмма архитектуры / API-документация** | Обещаны CHANGELOG 4.0.0, отсутствуют. |
