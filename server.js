const express = require("express");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const nodemailer = require("nodemailer");
const multer = require("multer");
require("dotenv").config();
const fetch = global.fetch
  ? global.fetch
  : (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const STORE_PATH = path.join(__dirname, "data", "store.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");

const TIME_SLOTS = [
  { value: "09:00", label: "09:00 - 10:00" },
  { value: "10:00", label: "10:00 - 11:00" },
  { value: "11:00", label: "11:00 - 12:00" },
  { value: "12:00", label: "12:00 - 13:00" },
  { value: "13:00", label: "13:00 - 14:00" },
  { value: "14:00", label: "14:00 - 15:00" },
  { value: "15:00", label: "15:00 - 16:00" },
  { value: "16:00", label: "16:00 - 17:00" },
];

const DEFAULT_CLOSED_WEEKDAYS = [5];
const DEFAULT_STORE = {
  appointments: [],
  blockedDates: [],
  settings: {
    slotCapacity: 6,
    buyMargin: 0.012,
    sellMargin: 0.018,
  },
};

const DEFAULT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AED",
  "TRY",
  "CAD",
  "AUD",
  "CHF",
  "CNY",
  "JPY",
  "KRW",
  "SAR",
];

const CURRENCY_NAMES = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  AED: "UAE Dirham",
  TRY: "Turkish Lira",
  CAD: "Canadian Dollar",
  AUD: "Australian Dollar",
  CHF: "Swiss Franc",
  CNY: "Chinese Yuan",
  JPY: "Japanese Yen",
  KRW: "South Korean Won",
  SAR: "Saudi Riyal",
  NOK: "Norwegian Krone",
  SEK: "Swedish Krona",
  DKK: "Danish Krone",
  QAR: "Qatari Riyal",
  OMR: "Omani Rial",
  KWD: "Kuwaiti Dinar",
  INR: "Indian Rupee",
  PKR: "Pakistani Rupee",
  RUB: "Russian Ruble",
};

const RATES_API_URL =
  process.env.RATES_API_URL || "https://open.er-api.com/v6/latest/USD";

let rateCache = {
  data: null,
  updatedAt: null,
  expiresAt: 0,
};

const ensureStore = () => {
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(DEFAULT_STORE, null, 2));
  }
};

const ensureUploads = () => {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploads();
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf", "image/jpeg", "image/png"];
    if (!allowed.includes(file.mimetype)) {
      cb(new Error("Invalid file type. Upload PDF or JPG/PNG image."));
      return;
    }
    cb(null, true);
  },
});

const writeStore = (store) => {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
};

const readStore = () => {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    const allowed = new Set(["confirmed", "rescheduled", "canceled"]);
    let changed = false;
    if (Array.isArray(parsed.appointments)) {
      parsed.appointments.forEach((item) => {
        if (!allowed.has(item.status)) {
          item.status = "confirmed";
          changed = true;
        }
      });
    }
    if (changed) {
      writeStore(parsed);
    }
    return parsed;
  } catch {
    return { ...DEFAULT_STORE };
  }
};

const closedWeekdays = () => {
  const raw = process.env.CLOSED_WEEKDAYS;
  if (!raw) return DEFAULT_CLOSED_WEEKDAYS;
  return raw
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value));
};

const isClosedDate = (dateIso, blockedDates) => {
  if (blockedDates.includes(dateIso)) return true;
  const date = new Date(`${dateIso}T00:00:00`);
  return closedWeekdays().includes(date.getDay());
};

const buildStats = (appointments) => {
  return appointments.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    { confirmed: 0, rescheduled: 0, canceled: 0 }
  );
};

const getQueue = (appointments) => {
  return appointments
    .filter((item) => item.status !== "canceled")
    .sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      const timeCompare = a.timeSlot.localeCompare(b.timeSlot);
      if (timeCompare !== 0) return timeCompare;
      return a.createdAt - b.createdAt;
    });
};

const getAvailability = (date, store) => {
  const reservedCounts = {};
  store.appointments
    .filter((item) => item.date === date && item.status !== "canceled")
    .forEach((item) => {
      reservedCounts[item.timeSlot] = (reservedCounts[item.timeSlot] || 0) + 1;
    });

  return {
    closed: isClosedDate(date, store.blockedDates),
    slotCapacity: store.settings.slotCapacity,
    reservedCounts,
  };
};

const buildEmailMessage = (appointment, title) => {
  const token = encodeURIComponent(appointment.manageToken);
  const cancelLink = `${PUBLIC_BASE_URL}/?action=cancel&id=${appointment.id}&token=${token}`;
  const rescheduleLink = `${PUBLIC_BASE_URL}/?action=reschedule&id=${appointment.id}&token=${token}`;

  const statusText =
    appointment.status === "confirmed"
      ? "is set"
      : appointment.status === "rescheduled"
        ? "has been rescheduled"
        : appointment.status === "canceled"
          ? "has been canceled"
          : `is ${appointment.status}`;

  return {
    subject: title,
    text: `Hello ${appointment.firstName},\n\nYour appointment at Elyassi Exchange ${statusText}.\nDate: ${appointment.date}\nTime: ${appointment.timeSlot}\n\nTo reschedule: ${rescheduleLink}\nTo cancel: ${cancelLink}\n\nThank you.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>${title}</h2>
        <p>Hello ${appointment.firstName},</p>
        <p>Your appointment at <strong>Elyassi Exchange</strong> <strong>${statusText}</strong>.</p>
        <p><strong>Date:</strong> ${appointment.date}<br />
        <strong>Time:</strong> ${appointment.timeSlot}</p>
        <p>
          <a href="${rescheduleLink}" style="color:#0f766e;font-weight:600;">Reschedule</a>
          ·
          <a href="${cancelLink}" style="color:#b91c1c;font-weight:600;">Cancel appointment</a>
        </p>
        <p>Thank you for choosing Elyassi Exchange.</p>
      </div>
    `,
  };
};

const getTransporter = () => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
};

const sendAppointmentEmail = async (appointment, title) => {
  const transporter = getTransporter();
  if (!transporter) return "not_configured";

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const message = buildEmailMessage(appointment, title);

  try {
    await transporter.sendMail({
      from,
      to: appointment.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return "sent";
  } catch (error) {
    return "failed";
  }
};

const fetchRates = async (showAll) => {
  const now = Date.now();
  if (rateCache.data && rateCache.expiresAt > now) {
    return rateCache.data;
  }

  const response = await fetch(RATES_API_URL);
  const data = await response.json();
  const rates = data.rates || {};
  const irrRate = rates.IRR;

  if (!irrRate) {
    return { updatedAt: Date.now(), rates: [] };
  }

  const codes = showAll ? Object.keys(rates) : DEFAULT_CURRENCIES;
  const store = readStore();
  const computed = codes
    .filter((code) => code !== "IRR" && rates[code])
    .map((code) => {
      const mid = irrRate / rates[code];
      const buy = mid * (1 - store.settings.buyMargin);
      const sell = mid * (1 + store.settings.sellMargin);
      return {
        code,
        name: CURRENCY_NAMES[code] || code,
        buy,
        sell,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const payload = {
    updatedAt: data.time_last_update_unix
      ? data.time_last_update_unix * 1000
      : Date.now(),
    rates: computed,
  };

  rateCache = {
    data: payload,
    updatedAt: payload.updatedAt,
    expiresAt: now + 1000 * 60 * 5,
  };

  return payload;
};

ensureUploads();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  const store = readStore();
  res.json({
    timeSlots: TIME_SLOTS,
    closedWeekdays: closedWeekdays(),
    slotCapacity: store.settings.slotCapacity,
  });
});

app.get("/api/blocked-dates", (req, res) => {
  const store = readStore();
  res.json({ blockedDates: store.blockedDates });
});

app.post("/api/blocked-dates", (req, res) => {
  const { date } = req.body;
  if (!date) return res.json({ error: "Date is required." });

  const store = readStore();
  if (!store.blockedDates.includes(date)) {
    store.blockedDates.push(date);
  }
  writeStore(store);
  res.json({ blockedDates: store.blockedDates });
});

app.delete("/api/blocked-dates/:date", (req, res) => {
  const store = readStore();
  store.blockedDates = store.blockedDates.filter((item) => item !== req.params.date);
  writeStore(store);
  res.json({ blockedDates: store.blockedDates });
});

app.get("/api/availability", (req, res) => {
  const date = req.query.date;
  if (!date) return res.json({ error: "Date is required." });
  const store = readStore();
  res.json(getAvailability(date, store));
});

app.post("/api/appointments", upload.single("documentFile"), async (req, res) => {
  const {
    firstName,
    lastName,
    email,
    documentType,
    documentNumber,
    date,
    timeSlot,
  } = req.body;

  if (!firstName || !lastName || !email || !documentType || !documentNumber || !date || !timeSlot) {
    return res.json({ error: "Please fill out all required fields." });
  }

  if (!req.file) {
    return res.json({ error: "Document file is required." });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.json({ error: "Invalid date format." });
  }

  const validSlot = TIME_SLOTS.some((slot) => slot.value === timeSlot);
  if (!validSlot) {
    return res.json({ error: "Invalid time slot selected." });
  }

  const store = readStore();
  if (isClosedDate(date, store.blockedDates)) {
    return res.json({ error: "Selected date is closed." });
  }

  const availability = getAvailability(date, store);
  const currentCount = availability.reservedCounts[timeSlot] || 0;
  if (currentCount >= store.settings.slotCapacity) {
    return res.json({ error: "Selected time slot is full." });
  }

  const appointment = {
    id: randomUUID(),
    firstName,
    lastName,
    email,
    documentType,
    documentNumber,
    documentFile: {
      originalName: req.file.originalname,
      fileName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
    manageToken: randomUUID(),
    date,
    timeSlot,
    status: "confirmed",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  store.appointments.push(appointment);
  writeStore(store);

  const emailStatus = await sendAppointmentEmail(
    appointment,
    "Your appointment is set — Elyassi Exchange"
  );

  res.json({ appointment, emailStatus });
});

app.get("/api/appointments/search", (req, res) => {
  const { email } = req.query;
  if (!email) return res.json({ error: "Email is required." });
  const store = readStore();
  const matches = store.appointments
    .filter((item) => item.email.toLowerCase() === email.toLowerCase())
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!matches.length) return res.json({ appointment: null });

  const appointment = matches[0];
  const queue = getQueue(store.appointments);
  const position = queue.findIndex((item) => item.id === appointment.id);

  res.json({
    appointment,
    queuePosition: position === -1 ? "Not in queue" : position + 1,
  });
});

app.get("/api/appointments/:id", (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ error: "Token is required." });
  const store = readStore();
  const appointment = store.appointments.find((item) => item.id === req.params.id);
  if (!appointment || appointment.manageToken !== token) {
    return res.json({ error: "Invalid token." });
  }
  res.json({ appointment });
});

app.patch("/api/appointments/:id/reschedule", async (req, res) => {
  const { token, date, timeSlot } = req.body;
  if (!token || !date || !timeSlot) {
    return res.json({ error: "Token, date, and time slot are required." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.json({ error: "Invalid date format." });
  }
  if (!TIME_SLOTS.some((slot) => slot.value === timeSlot)) {
    return res.json({ error: "Invalid time slot." });
  }

  const store = readStore();
  const appointment = store.appointments.find((item) => item.id === req.params.id);
  if (!appointment || appointment.manageToken !== token) {
    return res.json({ error: "Invalid token." });
  }

  if (isClosedDate(date, store.blockedDates)) {
    return res.json({ error: "Selected date is closed." });
  }

  const availability = getAvailability(date, store);
  if (availability.reservedCounts[timeSlot] >= store.settings.slotCapacity) {
    return res.json({ error: "Selected time slot is full." });
  }

  appointment.date = date;
  appointment.timeSlot = timeSlot;
  appointment.status = "rescheduled";
  appointment.updatedAt = Date.now();

  writeStore(store);

  const emailStatus = await sendAppointmentEmail(
    appointment,
    "Your Elyassi Exchange appointment was rescheduled"
  );

  res.json({ appointment, emailStatus });
});

app.post("/api/appointments/:id/cancel", async (req, res) => {
  const { token } = req.body;
  if (!token) return res.json({ error: "Token is required." });
  const store = readStore();
  const appointment = store.appointments.find((item) => item.id === req.params.id);
  if (!appointment || appointment.manageToken !== token) {
    return res.json({ error: "Invalid token." });
  }

  appointment.status = "canceled";
  appointment.updatedAt = Date.now();
  writeStore(store);

  const emailStatus = await sendAppointmentEmail(
    appointment,
    "Your Elyassi Exchange appointment was canceled"
  );

  res.json({ appointment, emailStatus });
});

app.get("/api/queue", (req, res) => {
  const store = readStore();
  res.json({
    queue: getQueue(store.appointments),
    stats: buildStats(store.appointments),
  });
});

app.get("/api/admin/appointments", (req, res) => {
  const store = readStore();
  res.json({
    appointments: store.appointments
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt),
  });
});

app.patch("/api/admin/appointments/:id", async (req, res) => {
  const { status, date, timeSlot } = req.body;
  const store = readStore();
  const appointment = store.appointments.find((item) => item.id === req.params.id);

  if (!appointment) return res.json({ error: "Appointment not found." });

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.json({ error: "Invalid date format." });
  }

  if (timeSlot && !TIME_SLOTS.some((slot) => slot.value === timeSlot)) {
    return res.json({ error: "Invalid time slot." });
  }

  if (date || timeSlot) {
    const nextDate = date || appointment.date;
    const nextTime = timeSlot || appointment.timeSlot;
    if (isClosedDate(nextDate, store.blockedDates)) {
      return res.json({ error: "Selected date is closed." });
    }
    const availability = getAvailability(nextDate, store);
    const currentCount = availability.reservedCounts[nextTime] || 0;
    const isSameSlot = appointment.date === nextDate && appointment.timeSlot === nextTime;
    const adjustedCount = isSameSlot ? currentCount - 1 : currentCount;
    if (adjustedCount >= store.settings.slotCapacity) {
      return res.json({ error: "Selected time slot is full." });
    }
  }

  if (status) {
    const allowed = ["confirmed", "rescheduled", "canceled"];
    if (!allowed.includes(status)) {
      return res.json({ error: "Invalid status." });
    }
    appointment.status = status;
  }
  if (date) appointment.date = date;
  if (timeSlot) appointment.timeSlot = timeSlot;
  appointment.updatedAt = Date.now();

  writeStore(store);

  const emailStatus = await sendAppointmentEmail(
    appointment,
    "Your Elyassi Exchange appointment update"
  );

  res.json({ appointment, emailStatus });
});

app.get("/api/rates", async (req, res) => {
  const showAll = req.query.all === "1";
  try {
    const data = await fetchRates(showAll);
    res.json(data);
  } catch (error) {
    res.json({ updatedAt: Date.now(), rates: [] });
  }
});

app.use((err, req, res, next) => {
  if (err) {
    res.status(400).json({ error: err.message || "Upload failed." });
    return;
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Elyassi Exchange server running on http://localhost:${PORT}`);
});
