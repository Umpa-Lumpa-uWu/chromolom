# Аудит: что можно улучшить

Репозиторий: `chromolom` (Chrome-расширение Flow Local Test Runner, MV3), ветка `arena/01a09bd4-chromolom`.
Состояние на момент аудита: `manifest.json` / `package.json` = **4.0.0**, ~2000 строк JS.

Вывод коротко: функциональное ядро (`background.js` + `patch.js`) написано аккуратно —
сессии, таймауты, защита от редирект-циклов, корректная работа с CDP. Проблемы
сконцентрированы вокруг него: **мёртвый код из релиза 4.0.0, неработающие скрипты
проверки и тесты, которые почти ничего не проверяют.**

---

## 🔴 Приоритет 1 — реальные баги и сломанная инфраструктура

### 1. `npm test` выполняет меньше половины тестов

```json
"test": "node --experimental-vm-modules tests/*.test.js"
```

Node исполняет как entry point **только первый файл**, остальные уходят в `process.argv`.
Проверено на Node 22 в этом репозитории:

| Команда | Тестов выполнено |
| --- | --- |
| `npm test` (текущая) | **8** |
| `node --test tests/*.test.js` | **17** |

То есть все 9 тестов `tests/security.test.js` молча пропускаются, при этом npm
возвращает exit code 0 — CI и разработчик видят «зелёный» прогон.

**Фикс:** `"test": "node --test tests/*.test.js"`. Флаг `--experimental-vm-modules`
не нужен (в репозитории нет `vm`-моков, ESM нативный). Проверено: 17/17 pass.

---

### 2. `npm run validate` падает

```json
"validate": "node -c manifest.json && echo \"Manifest valid\""
```

`node -c` — несуществующий флаг:

```
SyntaxError: Unexpected token ':'
  at wrapSafe (node:internal/modules/cjs/loader:1713:18)
```

Кроме того, `--check` проверял бы JS-синтаксис, а не JSON.

**Фикс:** `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"` —
проверено, работает. Лучше вынести в `scripts/validate-manifest.js` и попутно
проверять совпадение версий в `manifest.json` и `package.json`.

---

### 3. `config.js`, `security.js`, `metrics.js` — мёртвый код. Ни одна проверка безопасности не выполняется

Единственный импорт в `background.js` — `import { FlowPatch } from "./patch.js"`.
Греп подтверждает: ни `validateUrl`, ни `validateBundleSize`, ни `sanitizeErrorMessage`,
ни `isIncognitoTab`, ни `createTimeoutController`, ни `metricsTracker`, ни `STORAGE_KEYS`
**ни разу не вызываются** в runtime-коде. `config.js` импортируется только этими двумя
мёртвыми модулями.

Последствия:

- `CHANGELOG.md` 4.0.0 обещает «URL Validation», «Bundle Size Limits», «Error Message
  Sanitization», «Incognito Mode Detection», «Timeout Controls», «Metrics & Monitoring»
  и «Configuration module» — в продакшене из этого ничего не работает.
- `MAX_BUNDLE_SIZE_BYTES` (5 МБ) нигде не проверяется: `decodeResponseBody()`
  (`background.js:176`) декодирует ответ любого размера прямо в память service worker'а.
- Ошибки попадают в `chrome.storage.local` и в тултип иконки **без санитизации**
  (`errorMessage()` в `background.js:51` вместо `sanitizeErrorMessage()`).
- Все константы (`FLOW_HOME`, `TARGET_HOST`, `CDP_VERSION`, `INTERCEPT_TIMEOUT_MS`,
  `STATUS`, цвета бейджей) **задублированы** вручную в `background.js:4-49`. Два источника
  истины уже рассинхронизировались: в `config.js` есть `UNSUPPORTED_COUNTRY_PATTERN`,
  `AGE_RESTRICTED_PATTERN`, `STORAGE_KEYS`, `MAX_DECODE_ATTEMPTS` — в `background.js`
  паттерн `unsupported-country` захардкожен separately (`:136`), `MAX_DECODE_ATTEMPTS`
  не используется нигде вообще.

**Фикс (выбрать одно):**
- **A (рекомендую).** Подключить: `background.js` импортирует `CONFIG`, `validateUrl`,
  `validateBundleSize`, `sanitizeErrorMessage`; в `handlePausedResponse` добавить
  проверку размера до `decodeResponseBody`; `metricsTracker.recordAttempt()` вызывать
  в `completeSession`/`failSession`; удалить дубли констант; дописать реальные тесты
  на `background`-уровне. Это делает CHANGELOG правдой.
- **B.** Удалить `security.js` / `metrics.js` и поправить CHANGELOG + README, убрав
  несуществующие «security & monitoring». Меньше кода, честнее документация.

---

### 4. `tests/patch.test.js` не тестирует `patch.js` (2 из 8 тестов настоящие)

Реально проверяют модуль только «FlowPatch module structure» и «patchSource handles
empty input». Остальные переписывают логику внутри теста и сравнивают константы
сами с собой:

```js
if (normalized === '31' || normalized === '0x1f') {
  assert.strictEqual(31, 31);        // tests/patch.test.js:79
}
...
const isKeyword = new Set(keywords).has(lastPart);
assert.strictEqual(isKeyword, true); // tests/patch.test.js:103 — тавтология
```

Плюс `mockGlobalScope` (`:12-28`) создаётся и не используется — в комментарии
к тесту прямо написано, что `FlowPatch` вешается на реальный `globalThis`.

**Покрытие пяти стратегий патча (`patchExactKnownAccessor`, `patchForcedCallee`,
`patchAdaptiveCall`, `patchRouteGuard`, `patchSingle31`) = 0%.** А это как раз та
логика, которая ломается при каждом обновлении бандла Flow.

**Фикс:** рефакторинг №5 (ниже) делает функции экспортируемыми, после чего добавить
табличные тесты на каждую стратегию: успех, «не уникально», «не найдено».

---

## 🟠 Приоритет 2 — архитектура и надёжность

### 5. `patch.js`: IIFE + `globalThis` вместо обычного ESM-модуля

```js
(function initializeFlowPatch(globalScope) { ... })(globalThis);
export const FlowPatch = globalThis.FlowPatch;   // patch.js:414-417
```

Следствия:
- модуль невозможно изолировать в тестах (см. №4);
- `globalThis.__flowPatchForceCallee` (`patch.js:246`) — неявный канал
  `background.js` → `patch.js`. Значение живёт в глобальной области service worker'а;
- смешанные переводы строк: `patch.js` и `status.*` — **CRLF**, остальные файлы — **LF**;
  перед `export` — лишняя табуляция;
- нет завершающего перевода строки в `background.js`, `status.js`, `status.html`,
  `status.css`, `manifest.json`.

**Фикс:** переписать как обычный ESM (`export function patchSource(source, options)`),
forced callee передавать параметром, добавить `.editorconfig` + ESLint/Prettier
(сейчас `npm run lint` = `echo "Linting not configured yet"`).

---

### 6. Разделяемые глобальные `RegExp` с флагом `g`

Восемь регулярок с `g` живут на уровне модуля (`patch.js:2-21`), состояние `lastIndex`
сбрасывается вручную в пяти местах (`countPattern`, `replacePatterns`, `collectCandidates`,
`getContexts`, `patchRouteGuard`). Один забытый сброс — и стратегия молча пропускает
совпадение, а расширение уходит в `ERR`.

**Фикс:** функции-фабрики (`const makeCountryGuard = () => /…/g`) вместо общих констант,
либо убрать `g` там, где достаточно `matchAll` на локальной копии.

---

### 7. Нет CI

CONTRIBUTING требует «Tests must pass», но в репозитории нет ни `.github/workflows`,
ни даже валидного `npm test` (см. №1). Любой PR проходит без проверок.

**Фикс:** GitHub Actions на `push`/`PR`: `npm test` + `npm run validate` на Node 18/20/22.

---

### 8. Недостижимый обработчик `_execute_action`

`chrome.commands.onCommand` (`background.js:618-640`) обрабатывает `_execute_action`,
но зарезервированные команды `_execute_action` **не отправляют** `commands.onCommand` —
они диспатчат `chrome.action.onClicked` [2](https://stackoverflow.com/questions/68246857/how-to-assign-keyboard-shortcut-to-run-a-function-in-chrome-extension-manifest-v).
Итог: ~20 строк недостижимого кода, дублирующих `toggleAutomaticMode` (к тому же на
колбэчном `chrome.tabs.query` среди остального промисного кода). Горячая клавиша при
этом работает — через `chrome.action.onClicked`.

**Фикс:** удалить ветку, оставить только `open_status`.

---

### 9. `initializeEnabledState()` вызывается трижды

На старте модуля (`:600`), в `onInstalled` (`:720`), в `onStartup` (`:724`). Каждый
вызов делает `safeSetStatus(undefined, …)` — то есть **глобально перезатирает
per-tab статус** (`RUN`/`OK`/`ERR`), который только что выставила активная сессия.

**Фикс:** идемпотентная инициализация + не трогать статус, если есть активные сессии.

---

## 🟡 Приоритет 3 — консистентность и документация

### 10. Рассинхрон версий
`status.html:11` показывает **«Version 3.1.0»** при версии расширения 4.0.0.
Значение захардкожено — лучше подставлять из `chrome.runtime.getManifest().version`.

### 11. README с чужими путями
Шаг 5 установки: `E:\HeroSMS\flow-chrome-addon` — Windows-путь конкретного разработчика,
не совпадает с именем репозитория. Заменить на «папку с распакованным расширением».

### 12. Заглушки в манифесте
- `homepage_url: "https://github.com/your-org/flow-local-test-runner"`;
- `"optional_permissions": []` — пустой массив (CHANGELOG обещает `declarativeNetRequest`).

### 13. `.gitignore` — это эссе, а не конфиг
Весь файл — проза: *«Nothing needs to be added to .gitignore since the changes only
include source code files…»*. Ноль паттернов. Заменить на реальный
(`node_modules/`, `*.zip`, `.DS_Store`, `*.log`).

### 14. CHANGELOG обещает то, чего нет в репозитории
«Architecture diagram», «API documentation for new modules», «Testing guide»,
«Security best practices» — ни одного из этих документов в репозитории нет.

### 15. Мелкие правки
- `patchSingle31` (`patch.js:337-363`) — запутанная логика с `total31`/`single31Callee`;
  работает, но крайне хрупкая при изменении набора кандидатов.
- `patchForcedCallee` патчит только флаг `31`, не `32` — расхождение с `adaptive-call-v1`.
- `status.js:77` — `refresh()` без `.catch()` → unhandled rejection; `<script>` без
  `type="module"` при том, что остальной код на ESM.
- Нет обработки «`chrome.debugger` занят другим отладчиком»: README предупреждает
  про закрытый DevTools, а код просто показывает `ERR` с сырым сообщением.
- Нет i18n: README на русском, UI на английском, `<html lang="ru">` в `status.html`.
  Для Chrome Web Store стоит либо добавить локализацию, либо выровнять язык.

---

## Рекомендуемый порядок работ

| # | Задача | Оценка | Эффект |
| --- | --- | --- | --- |
| 1 | `npm test` → `node --test tests/*.test.js` | 1 мин | +9 выполняемых тестов |
| 2 | Починить `npm run validate` | 5 мин | рабочая проверка манифеста |
| 3 | Подключить `security.js` + `metrics.js` **или** удалить их и поправить CHANGELOG | 1–3 ч | ложь в документации → правда |
| 4 | ESM-рефакторинг `patch.js` + честные тесты стратегий | 2–4 ч | защита от поломок при обновлении Flow |
| 5 | Удалить дубли констант, подключить `config.js` | 1 ч | один источник истины |
| 6 | `.editorconfig` + ESLint/Prettier + CI | 1–2 ч | стабильное качество PR |
| 7 | Документация, версии, `.gitignore`, README | 30 мин | пригодный для публикации вид |

Пункты 1, 2 и 7 — полностью безопасные, ничего не ломают. Пункт 3 требует решения
(подключать или удалять), пункт 4 — единственный, затрагивающий логику патча.
