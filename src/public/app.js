// HTML-форма генератора: через нее читаем введенные данные и отправляем запрос.
const form = document.getElementById("form");
// Селект формата кода (qr / datamatrix / ean).
const codeFormatEl = document.getElementById("codeFormat");
// Селект варианта EAN (8 или 13).
const eanVariantEl = document.getElementById("eanVariant");
// Поле с цифрами для EAN.
const eanDigitsEl = document.getElementById("eanDigits");
// Блок с "структурированными" типами данных (телефон, Wi-Fi, vCard и т.д.).
const blockStructuredEl = document.getElementById("blockStructured");
// Блок с настройками EAN.
const groupEanEl = document.getElementById("group-ean");
// Селект типа данных для QR/Data Matrix (url, phone, email, wifi, vcard).
const dataTypeEl = document.getElementById("dataType");
// Элемент для вывода ошибок валидации/сервера.
const errorEl = document.getElementById("error");
// Контейнер результата (превью + кнопка скачивания).
const resultEl = document.getElementById("result");
// Контейнер предпросмотра сгенерированного изображения.
const previewEl = document.getElementById("preview");
// Ссылка-кнопка для скачивания готового изображения.
const downloadEl = document.getElementById("download");
// Кнопка отправки формы "Сгенерировать".
const submitBtn = document.getElementById("submit");
// Подсказка в области результата (до генерации/при ошибке).
const outputHintEl = document.getElementById("outputHint");

// Селект типа защиты Wi-Fi (WPA/WEP/без пароля).
const wifiSecurityEl = document.getElementById("wifiSecurity");
// Поле пароля Wi-Fi.
const wifiPasswordEl = document.getElementById("wifiPassword");

// Карта блоков полей по типу данных: позволяет показывать только нужную группу inputs.
const fieldGroups = {
  url: document.getElementById("group-url"),
  phone: document.getElementById("group-phone"),
  email: document.getElementById("group-email"),
  wifi: document.getElementById("group-wifi"),
  vcard: document.getElementById("group-vcard"),
};

// Текст подсказки по умолчанию в зоне вывода.
const OUTPUT_HINT_DEFAULT =
  "Изображение кода появится здесь после нажатия «Сгенерировать».";

// Последний созданный object URL для PNG-превью; нужен для последующего освобождения памяти.
let lastObjectUrl = null;

// Показывает или скрывает сообщение об ошибке.
// msg: текст ошибки; если пусто, ошибка очищается.
function setError(msg) {
  if (msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  } else {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }
}

// Отзывает ранее созданный object URL (если есть), чтобы избежать утечки памяти.
function revokeLastUrl() {
  if (lastObjectUrl) {
    // Освобождаем предыдущий Blob URL, чтобы не накапливать объекты в памяти.
    URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = null;
  }
}

// Синхронизирует видимость групп полей с выбранным dataType.
function syncFieldGroups() {
  // Текущий выбранный тип данных.
  const t = dataTypeEl.value;
  // key — имя группы (url/phone/...); el — DOM-элемент этой группы.
  for (const [key, el] of Object.entries(fieldGroups)) {
    el.hidden = key !== t;
  }
}

// Возвращает внутренний тип кода (kind), который отправляется на сервер.
function requestKind() {
  // Преобразуем выбор из UI в внутренний тип, ожидаемый API.
  // Значение формата из селекта codeFormat.
  const cf = codeFormatEl.value;
  if (cf === "ean") {
    return eanVariantEl.value === "8" ? "ean8" : "ean13";
  }
  if (cf === "datamatrix") return "datamatrix";
  return "qr";
}

// Переключает UI между режимом EAN и режимом "структурированных" данных.
function syncCodeFormatUi() {
  // Текущий формат кода.
  const cf = codeFormatEl.value;
  // Флаг, выбран ли EAN.
  const isEan = cf === "ean";
  groupEanEl.hidden = !isEan;
  blockStructuredEl.hidden = isEan;
  if (!isEan) syncFieldGroups();
}

// Включает/выключает поле пароля Wi-Fi в зависимости от типа защиты.
function syncWifiPasswordField() {
  // Флаг, что выбрана сеть без пароля.
  const nopass = wifiSecurityEl.value === "nopass";
  wifiPasswordEl.disabled = nopass;
  if (nopass) wifiPasswordEl.value = "";
}

// При смене типа данных показываем соответствующую группу полей и очищаем старую ошибку.
dataTypeEl.addEventListener("change", () => {
  syncFieldGroups();
  setError("");
});
// При смене формата кода (qr/datamatrix/ean) обновляем видимость блоков и очищаем ошибку.
codeFormatEl.addEventListener("change", () => {
  syncCodeFormatUi();
  setError("");
});
// При смене варианта EAN (8/13) просто очищаем старую ошибку.
eanVariantEl.addEventListener("change", () => setError(""));
// При смене типа защиты Wi-Fi синхронизируем состояние поля пароля.
wifiSecurityEl.addEventListener("change", syncWifiPasswordField);

// Экранирует спецсимволы для корректного формата строки WIFI:...;...;...
function escapeWifiParam(s) {
  // Экранируем специальные символы по формату WIFI:...;...;...
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,");
}

// Строит payload для обычного текста/URL.
// Возвращает объект { ok, text | error }.
function buildUrlPayload() {
  // Введенный текст или ссылка.
  const t = document.getElementById("urlText").value.trim();
  if (!t) return { ok: false, error: "Введите текст или ссылку." };
  return { ok: true, text: t };
}

// Строит payload формата tel:... для телефонного номера.
// Возвращает объект { ok, text | error }.
function buildPhonePayload() {
  // Сырой ввод номера телефона из формы.
  let s = document.getElementById("phoneNumber").value.trim();
  if (!s) return { ok: false, error: "Введите номер телефона." };
  if (s.toLowerCase().startsWith("tel:")) s = s.slice(4).trim();
  // Был ли в исходном номере международный префикс "+".
  const hadPlus = s.startsWith("+");
  // Оставляем только цифры: так проще валидировать длину номера.
  // digits — очищенная строка только из цифр.
  const digits = s.replace(/\D/g, "");
  if (digits.length < 5) {
    return { ok: false, error: "В номере слишком мало цифр." };
  }
  if (digits.length > 15) {
    return { ok: false, error: "Слишком длинный номер (больше 15 цифр)." };
  }
  // Нормализованный номер для dial-подстановки (с "+" или без него).
  const dial = hadPlus ? `+${digits}` : digits;
  return { ok: true, text: `tel:${dial}` };
}

// Строит payload mailto:... для email.
// Возвращает объект { ok, text | error }.
function buildEmailPayload() {
  // Адрес получателя.
  const to = document.getElementById("emailTo").value.trim();
  if (!to) return { ok: false, error: "Укажите адрес получателя." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: "Некорректный адрес email." };
  }
  // Тема письма.
  const subject = document.getElementById("emailSubject").value.trim();
  // Тело письма.
  const body = document.getElementById("emailBody").value.trim();
  // Объект query-параметров для mailto (subject/body).
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  // Собранная query-строка (например "subject=...&body=...").
  const q = params.toString();
  // Итоговая строка mailto для кодирования в QR/Data Matrix.
  const text = q ? `mailto:${to}?${q}` : `mailto:${to}`;
  return { ok: true, text };
}

// Строит payload по спецификации Wi-Fi QR.
// Возвращает объект { ok, text | error }.
function buildWifiPayload() {
  // Имя Wi-Fi сети (SSID).
  const ssid = document.getElementById("wifiSsid").value.trim();
  // Выбранный тип защиты сети.
  const security = wifiSecurityEl.value;
  // Введенный пароль сети.
  const pwd = document.getElementById("wifiPassword").value;
  // Флаг скрытой сети.
  const hidden = document.getElementById("wifiHidden").checked;
  if (!ssid) return { ok: false, error: "Укажите имя сети (SSID)." };
  if (security !== "nopass" && !pwd.trim()) {
    return {
      ok: false,
      error: "Укажите пароль сети или выберите тип «Без пароля».",
    };
  }
  // Значение поля T в формате WIFI.
  const T = security === "nopass" ? "nopass" : security;
  // Значение поля P (пароль), пустое для открытой сети.
  const P = security === "nopass" ? "" : escapeWifiParam(pwd);
  // Значение поля S (SSID) с экранированием.
  const S = escapeWifiParam(ssid);
  // Части строки формата WIFI, которые потом объединяются через ";".
  const chunks = [`WIFI:T:${T}`, `S:${S}`, `P:${P}`];
  if (hidden) chunks.push("H:true");
  return { ok: true, text: `${chunks.join(";")};;` };
}

// Экранирует значение для vCard-полей (обратные слэши, переводы строк и разделители).
function escapeVcardValue(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// Строит payload визитки в формате VCARD 3.0.
// Возвращает объект { ok, text | error }.
function buildVcardPayload() {
  // Полное имя (обязательное поле в визитке).
  const fn = document.getElementById("vcardFn").value.trim();
  if (!fn) {
    return { ok: false, error: "Укажите имя и фамилию для визитки." };
  }
  // Организация.
  const org = document.getElementById("vcardOrg").value.trim();
  // Должность.
  const title = document.getElementById("vcardTitle").value.trim();
  // Телефон.
  const tel = document.getElementById("vcardTel").value.trim();
  // Email.
  const email = document.getElementById("vcardEmail").value.trim();
  // Сайт.
  const url = document.getElementById("vcardUrl").value.trim();
  // Примечание.
  const note = document.getElementById("vcardNote").value.trim();

  // Массив строк vCard, из которого соберется финальный текст с CRLF-разделителями.
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${escapeVcardValue(fn)}`];
  // Пытаемся разложить полное имя на given/family для поля N в vCard.
  // parts — части ФИО, разбитые по пробелам.
  const parts = fn.split(/\s+/).filter(Boolean);
  // family — фамилия (последняя часть), если частей имени больше одной.
  const family = parts.length > 1 ? parts.pop() : "";
  // given — оставшаяся часть имени/имена.
  const given = parts.length ? parts.join(" ") : fn;
  lines.push(
    `N:${escapeVcardValue(family)};${escapeVcardValue(given)};;;`,
  );
  if (org) lines.push(`ORG:${escapeVcardValue(org)}`);
  if (title) lines.push(`TITLE:${escapeVcardValue(title)}`);
  if (tel) lines.push(`TEL;TYPE=CELL:${escapeVcardValue(tel)}`);
  if (email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVcardValue(email)}`);
  if (url) lines.push(`URL:${escapeVcardValue(url)}`);
  if (note) lines.push(`NOTE:${escapeVcardValue(note)}`);
  lines.push("END:VCARD");

  // Итоговый текст визитки.
  const text = lines.join("\r\n");
  if (text.length > 2000) {
    return {
      ok: false,
      error: "Слишком много данных для одного QR (лимит 2000 символов).",
    };
  }
  return { ok: true, text };
}

// Унифицированный билдер payload для всех режимов (EAN и структурированные типы).
function buildPayload() {
  if (codeFormatEl.value === "ean") {
    // Сырой ввод EAN.
    const raw = eanDigitsEl.value.trim();
    if (!raw) {
      return { ok: false, error: "Введите цифры штрихкода EAN." };
    }
    // Разрешаем ввод с пробелами/дефисами, но в генератор передаем только цифры.
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      return { ok: false, error: "Для EAN нужны цифры (можно с пробелами)." };
    }
    // variant — выбранный вариант EAN (8 или 13).
    const variant = eanVariantEl.value;
    if (variant === "13") {
      if (digits.length !== 12 && digits.length !== 13) {
        return {
          ok: false,
          error: "Для EAN-13 нужно 12 или 13 цифр.",
        };
      }
    } else if (digits.length !== 7 && digits.length !== 8) {
      return {
        ok: false,
        error: "Для EAN-8 нужно 7 или 8 цифр.",
      };
    }
    return { ok: true, text: digits };
  }

  switch (dataTypeEl.value) {
    case "url":
      return buildUrlPayload();
    case "phone":
      return buildPhonePayload();
    case "email":
      return buildEmailPayload();
    case "wifi":
      return buildWifiPayload();
    case "vcard":
      return buildVcardPayload();
    default:
      return { ok: false, error: "Неизвестный тип данных." };
  }
}

form.addEventListener("submit", async (e) => {
  // Отменяем стандартную отправку формы, работаем через fetch.
  e.preventDefault();
  // Очищаем предыдущую ошибку перед новой попыткой генерации.
  setError("");

  // Результат сборки payload (валидный текст или ошибка).
  const built = buildPayload();
  if (!built.ok) {
    setError(built.error);
    return;
  }
  // text — строка, которая будет кодироваться в QR/Data Matrix/EAN.
  const { text } = built;
  // format — выбранный формат выходного файла (png или svg).
  const format = form.querySelector('input[name="format"]:checked').value;
  // kind — тип кода, понятный серверу (qr/datamatrix/ean13/ean8).
  const kind = requestKind();

  // Блокируем кнопку, чтобы не отправлять несколько запросов подряд.
  submitBtn.disabled = true;
  // Чистим старый object URL и предыдущее превью.
  revokeLastUrl();
  previewEl.innerHTML = "";
  // Показываем временную подсказку "Генерация...".
  outputHintEl.hidden = false;
  outputHintEl.textContent = "Генерация…";
  // Прячем контейнер результата, пока не получим ответ.
  resultEl.hidden = true;

  try {
    // Сервер возвращает либо PNG, либо SVG в зависимости от query-параметра format.
    const res = await fetch(`/api/qr?format=${encodeURIComponent(format)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, kind }),
    });

    // contentType нужен, чтобы понять, как парсить ответ при ошибке.
    const contentType = res.headers.get("content-type") || "";

    if (!res.ok) {
      if (contentType.includes("application/json")) {
        // data — json-тело ошибки от сервера.
        const data = await res.json();
        setError(data.error || "Ошибка сервера");
      } else {
        setError("Ошибка сервера");
      }
      outputHintEl.hidden = false;
      outputHintEl.textContent = OUTPUT_HINT_DEFAULT;
      resultEl.hidden = true;
      return;
    }

    // blob — бинарное тело ответа (PNG или SVG-файл).
    const blob = await res.blob();

    // baseName — базовое имя файла для скачивания.
    const baseName =
      kind === "qr"
        ? "qrcode"
        : kind === "datamatrix"
          ? "datamatrix"
          : kind === "ean13"
            ? "ean13"
            : "ean8";
    // altLabel — текст alt для img-превью.
    const altLabel =
      kind === "qr"
        ? "QR-код"
        : kind === "datamatrix"
          ? "Data Matrix"
          : kind === "ean13"
            ? "Штрихкод EAN-13"
            : "Штрихкод EAN-8";

    if (format === "svg") {
      revokeLastUrl();
      // t — SVG-текст, который вставляется в DOM и используется для data URL.
      const t = await blob.text();
      // SVG вставляем как разметку, чтобы сохранить четкость на любом масштабе.
      previewEl.innerHTML = t;
      downloadEl.href =
        "data:image/svg+xml;charset=utf-8," + encodeURIComponent(t);
      downloadEl.download = `${baseName}.svg`;
    } else {
      revokeLastUrl();
      // Для PNG показываем <img>, источник которого — временный object URL.
      lastObjectUrl = URL.createObjectURL(blob);
      // img — элемент изображения для PNG-превью.
      const img = document.createElement("img");
      img.src = lastObjectUrl;
      img.alt = altLabel;
      previewEl.appendChild(img);
      downloadEl.href = lastObjectUrl;
      downloadEl.download = `${baseName}.png`;
    }

    outputHintEl.hidden = true;
    resultEl.hidden = false;
  } catch {
    // Если запрос не удался (сеть/сервер недоступен), показываем понятную ошибку.
    setError("Нет соединения с сервером.");
    outputHintEl.hidden = false;
    outputHintEl.textContent = OUTPUT_HINT_DEFAULT;
    resultEl.hidden = true;
  } finally {
    // В любом случае разблокируем кнопку отправки.
    submitBtn.disabled = false;
  }
});

// Начальная синхронизация UI сразу после загрузки скрипта.
syncCodeFormatUi();
// Показываем группу полей, соответствующую текущему dataType.
syncFieldGroups();
// Приводим поле пароля Wi-Fi в корректное начальное состояние.
syncWifiPasswordField();
