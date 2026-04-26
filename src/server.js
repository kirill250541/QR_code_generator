// Веб-фреймворк для HTTP API и раздачи статики.
import express from "express";
// Middleware для настройки CORS-заголовков.
import cors from "cors";
// Библиотека генерации QR-кодов.
import QRCode from "qrcode";
// Библиотека генерации штрихкодов/Data Matrix (BWIP-JS).
import bwipjs from "bwip-js";
// Утилиты путей Node.js.
import path from "path";
// Утилита для преобразования import.meta.url в обычный путь файла.
import { fileURLToPath } from "url";

// Абсолютный путь к текущей директории файла (аналог __dirname для ESM).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Экземпляр Express-приложения.
const app = express();
// Порт запуска сервера (берем из env, иначе 3000).
const PORT = process.env.PORT || 3000;

// Разрешаем CORS-запросы к API.
app.use(cors());
// Парсим JSON-тело запроса и ограничиваем размер payload.
app.use(express.json({ limit: "256kb" }));
// Раздаем клиентские файлы из папки public.
app.use(express.static(path.join(__dirname, "public")));

// Ограничение длины текста для QR/Data Matrix, чтобы избежать чрезмерно больших payload.
const MAX_LENGTH = 2000;

// Разрешенные внутренние типы кодов, которые принимает API.
const KINDS = new Set(["qr", "datamatrix", "ean13", "ean8"]);

/** Единый белый фон в сгенерированных файлах (PNG/SVG). */
// Цветовая схема QR: черный рисунок на белом фоне.
const QR_IMAGE_COLORS = { dark: "#000000", light: "#ffffff" };

// Базовые опции отрисовки BWIP-JS (общие для Data Matrix и EAN).
const BWIP_IMAGE_OPTS = {
  // Коэффициент масштабирования итогового изображения.
  scale: 3,
  // Горизонтальный внутренний отступ (в модулях BWIP).
  paddingwidth: 10,
  // Вертикальный внутренний отступ (в модулях BWIP).
  paddingheight: 10,
  // Белый фон изображения.
  backgroundcolor: "#FFFFFF",
};

/** EAN: ниже штрихов — читаемые цифры; height — высота штрихов (BWIPP), меньше = компактнее по вертикали. */
// Опции EAN поверх базовых BWIP-настроек.
const BWIP_EAN_OPTS = {
  ...BWIP_IMAGE_OPTS,
  // Включаем подпись цифрами под штрихкодом.
  includetext: true,
  // Центрируем подпись под кодом.
  textxalign: "center",
  // Высота штрихов (компромисс между читаемостью и компактностью).
  height: 7,
};

/**
 * Контрольная цифра GS1 для тела EAN-13 (12 цифр) или EAN-8 (7 цифр).
 * Веса 3 и 1 по позиции справа налево, у крайней справа цифры вес 3.
 */
function eanCheckDigit(data) {
  // sum — накопленная взвешенная сумма цифр.
  let sum = 0;
  // n — длина тела EAN (12 для EAN-13, 7 для EAN-8).
  const n = data.length;
  for (let i = 0; i < n; i++) {
    // Позиция цифры от правого края (1..n).
    const posFromRight = n - i;
    // Вес по правилу GS1: справа налево 3,1,3,1...
    const weight = posFromRight % 2 === 1 ? 3 : 1;
    sum += Number(data[i]) * weight;
  }
  // Вычисляем цифру, дополняющую сумму до ближайшего десятка.
  return String((10 - (sum % 10)) % 10);
}

// Нормализует вход EAN-13:
// - 12 цифр -> добавляет контрольную;
// - 13 цифр -> проверяет контрольную.
// Бросает Error при неверном формате/контрольной цифре.
function normalizeEan13(raw) {
  // d — только цифры из входной строки.
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 12) {
    return d + eanCheckDigit(d);
  }
  if (d.length === 13) {
    // body — первые 12 цифр без контрольной.
    const body = d.slice(0, 12);
    // check — переданная пользователем контрольная цифра.
    const check = d.slice(12);
    if (eanCheckDigit(body) !== check) {
      throw new Error("Неверная контрольная цифра для EAN-13.");
    }
    return d;
  }
  throw new Error(
    "EAN-13: введите 12 цифр (контрольная будет добавлена) или 13 с верной контрольной цифрой.",
  );
}

// Нормализует вход EAN-8:
// - 7 цифр -> добавляет контрольную;
// - 8 цифр -> проверяет контрольную.
// Бросает Error при неверном формате/контрольной цифре.
function normalizeEan8(raw) {
  // d — только цифры из входной строки.
  const d = String(raw).replace(/\D/g, "");
  if (d.length === 7) {
    return d + eanCheckDigit(d);
  }
  if (d.length === 8) {
    // body — первые 7 цифр без контрольной.
    const body = d.slice(0, 7);
    // check — переданная пользователем контрольная цифра.
    const check = d.slice(7);
    if (eanCheckDigit(body) !== check) {
      throw new Error("Неверная контрольная цифра для EAN-8.");
    }
    return d;
  }
  throw new Error(
    "EAN-8: введите 7 цифр (контрольная будет добавлена) или 8 с верной контрольной цифрой.",
  );
}

// Генерирует PNG через BWIP-JS.
// bcid — тип кода в терминах BWIP (например, "datamatrix" / "ean13"),
// text — полезная нагрузка, extra — доп. опции рендера.
async function renderBwipPng(bcid, text, extra = {}) {
  return bwipjs.toBuffer({ bcid, text, ...BWIP_IMAGE_OPTS, ...extra });
}

// Генерирует SVG через BWIP-JS.
// Параметры аналогичны renderBwipPng.
function renderBwipSvg(bcid, text, extra = {}) {
  return bwipjs.toSVG({ bcid, text, ...BWIP_IMAGE_OPTS, ...extra });
}

// Основной endpoint генерации изображений кодов.
// Принимает:
// - body.kind: qr | datamatrix | ean13 | ean8
// - body.text: данные для кодирования
// - query.format: png | svg
app.post("/api/qr", async (req, res) => {
  // kindRaw — исходный kind из запроса, нормализованный к lowercase.
  const kindRaw =
    typeof req.body?.kind === "string" ? req.body.kind.trim().toLowerCase() : "qr";
  // kind — безопасный тип: если пришло неизвестное значение, используем "qr".
  const kind = KINDS.has(kindRaw) ? kindRaw : "qr";

  // text — данные для кодирования; читаем сначала из body, затем fallback на query.
  const text =
    typeof req.body?.text === "string"
      ? req.body.text.trim()
      : typeof req.query?.text === "string"
        ? req.query.text.trim()
        : "";

  // Для EAN допускаем только непустой ввод цифр (проверка длины/контрольной позже).
  if (kind === "ean13" || kind === "ean8") {
    if (!text) {
      return res.status(400).json({ error: "Введите цифры штрихкода EAN." });
    }
  } else {
    // Для QR/Data Matrix проверяем непустой текст и ограничение по длине.
    if (!text) {
      return res.status(400).json({ error: "Укажите непустой текст в поле text" });
    }
    if (text.length > MAX_LENGTH) {
      return res
        .status(400)
        .json({ error: `Текст длиннее ${MAX_LENGTH} символов` });
    }
  }

  // format — желаемый формат ответа; по умолчанию PNG.
  const format = req.query.format === "svg" ? "svg" : "png";

  try {
    // Ветка генерации QR-кода.
    if (kind === "qr") {
      if (format === "svg") {
        // svg — текст SVG-разметки QR.
        const svg = await QRCode.toString(text, {
          type: "svg",
          margin: 2,
          color: QR_IMAGE_COLORS,
        });
        return res.type("image/svg+xml").send(svg);
      }
      // buffer — бинарные PNG-данные QR.
      const buffer = await QRCode.toBuffer(text, {
        type: "png",
        margin: 2,
        width: 320,
        errorCorrectionLevel: "M",
        color: QR_IMAGE_COLORS,
      });
      return res.type("image/png").send(buffer);
    }

    // Ветка генерации Data Matrix.
    if (kind === "datamatrix") {
      if (format === "svg") {
        // svg — SVG-строка Data Matrix.
        const svg = renderBwipSvg("datamatrix", text);
        return res.type("image/svg+xml").send(svg);
      }
      // buffer — PNG-данные Data Matrix.
      const buffer = await renderBwipPng("datamatrix", text);
      return res.type("image/png").send(buffer);
    }

    // Ветка генерации EAN-13.
    if (kind === "ean13") {
      // payload — нормализованный EAN-13 (с проверенной/добавленной контрольной цифрой).
      const payload = normalizeEan13(text);
      if (format === "svg") {
        // svg — SVG-строка EAN-13.
        const svg = renderBwipSvg("ean13", payload, BWIP_EAN_OPTS);
        return res.type("image/svg+xml").send(svg);
      }
      // buffer — PNG-данные EAN-13.
      const buffer = await renderBwipPng("ean13", payload, BWIP_EAN_OPTS);
      return res.type("image/png").send(buffer);
    }

    // Ветка генерации EAN-8.
    if (kind === "ean8") {
      // payload — нормализованный EAN-8 (с проверенной/добавленной контрольной цифрой).
      const payload = normalizeEan8(text);
      if (format === "svg") {
        // svg — SVG-строка EAN-8.
        const svg = renderBwipSvg("ean8", payload, BWIP_EAN_OPTS);
        return res.type("image/svg+xml").send(svg);
      }
      // buffer — PNG-данные EAN-8.
      const buffer = await renderBwipPng("ean8", payload, BWIP_EAN_OPTS);
      return res.type("image/png").send(buffer);
    }

    // Защита от неизвестного kind (на случай будущих изменений).
    return res.status(400).json({ error: "Неизвестный тип кода" });
  } catch (err) {
    // Явные ошибки валидации EAN возвращаем как клиентские (400).
    if (err instanceof Error && err.message.startsWith("EAN-")) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof Error && err.message.includes("контрольной")) {
      return res.status(400).json({ error: err.message });
    }
    // Прочие ошибки считаем внутренними.
    console.error(err);
    return res.status(500).json({ error: "Не удалось сгенерировать изображение" });
  }
});

// Запуск HTTP-сервера.
app.listen(PORT, () => {
  // Лог адреса, по которому доступно приложение.
  console.log(`Сервер: http://localhost:${PORT}`);
});
