const state = {
  config: null,
  blockedDates: new Set(),
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  selectedDate: null,
  selectedDateISO: "",
  selectedTime: "",
  showAllRates: true,
  useToman: false,
  rates: [],
  ratesUpdatedAt: null,
  manage: {
    action: null,
    id: null,
    token: null,
    appointment: null,
  },
};

const calendarGrid = document.getElementById("calendar-grid");
const calendarMonth = document.getElementById("calendar-month");
const calendarSub = document.getElementById("calendar-sub");
const calendarInfo = document.getElementById("calendar-info");
const prevMonthButton = document.getElementById("prev-month");
const nextMonthButton = document.getElementById("next-month");
const timeSlotsEl = document.getElementById("time-slots");
const selectedDateInput = document.getElementById("selected-date");
const selectedTimeInput = document.getElementById("selected-time");
const bookingForm = document.getElementById("booking-form");
const bookingMessage = document.getElementById("booking-message");
const manageBanner = document.getElementById("manage-banner");
const queueForm = document.getElementById("queue-form");
const queueResult = document.getElementById("queue-result");
const rateTable = document.getElementById("rate-table");
const ratesUpdated = document.getElementById("rates-updated");
const toggleCurrencyButton = document.getElementById("toggle-currency");
const toggleUnitButton = document.getElementById("toggle-unit");
const nextAvailable = document.getElementById("next-available");
const openDays = document.getElementById("open-days");
const queueSize = document.getElementById("queue-size");

const DEFAULT_CONFIG = {
  timeSlots: [
    { value: "09:00", label: "09:00 - 10:00" },
    { value: "10:00", label: "10:00 - 11:00" },
    { value: "11:00", label: "11:00 - 12:00" },
    { value: "12:00", label: "12:00 - 13:00" },
    { value: "13:00", label: "13:00 - 14:00" },
    { value: "14:00", label: "14:00 - 15:00" },
    { value: "15:00", label: "15:00 - 16:00" },
    { value: "16:00", label: "16:00 - 17:00" },
  ],
  closedWeekdays: [5],
  slotCapacity: 6,
};

const formatters = (() => {
  const safeFormatter = (locale, options) => {
    try {
      return new Intl.DateTimeFormat(locale, options);
    } catch {
      return new Intl.DateTimeFormat("en-US", options);
    }
  };

  return {
    human: safeFormatter("en-US", { dateStyle: "full" }),
    jalali: safeFormatter("en-US-u-ca-persian", { dateStyle: "full" }),
    hijri: safeFormatter("en-US-u-ca-islamic", { dateStyle: "full" }),
    jalaliDay: safeFormatter("en-US-u-ca-persian", { day: "numeric" }),
    hijriDay: safeFormatter("en-US-u-ca-islamic", { day: "numeric" }),
  };
})();

const requestJson = async (url, options) => {
  try {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok && !data.error) {
      return { error: "Request failed. Please try again." };
    }
    return data;
  } catch (error) {
    return { error: "Server is not running. Start it with npm run dev." };
  }
};

const api = {
  async getConfig() {
    return requestJson("/api/config");
  },
  async getBlockedDates() {
    return requestJson("/api/blocked-dates");
  },
  async getAvailability(date) {
    return requestJson(`/api/availability?date=${date}`);
  },
  async createAppointment(payload) {
    return requestJson("/api/appointments", {
      method: "POST",
      body: payload,
    });
  },
  async getAppointment(id, token) {
    return requestJson(`/api/appointments/${id}?token=${encodeURIComponent(token)}`);
  },
  async cancelAppointment(id, token) {
    return requestJson(`/api/appointments/${id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
  },
  async rescheduleAppointment(id, token, payload) {
    return requestJson(`/api/appointments/${id}/reschedule`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, ...payload }),
    });
  },
  async searchAppointment(email) {
    return requestJson(`/api/appointments/search?email=${encodeURIComponent(email)}`);
  },
  async getQueue() {
    return requestJson("/api/queue");
  },
  async getRates(showAll) {
    return requestJson(`/api/rates?all=${showAll ? "1" : "0"}`);
  },
};

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatDocument = (value) =>
  value === "passport" ? "Passport" : value === "national-id" ? "National ID" : value;
const statusLabels = {
  confirmed: "Confirmed",
  rescheduled: "Rescheduled",
  canceled: "Canceled",
};
const emailStatusLabels = {
  sent: "Sent",
  not_configured: "Not configured",
  failed: "Failed",
};

const formatISODate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseISODate = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const isClosedDate = (date) => {
  if (!state.config) return false;
  const iso = formatISODate(date);
  if (state.blockedDates.has(iso)) return true;
  return state.config.closedWeekdays.includes(date.getDay());
};

const renderCalendar = () => {
  const firstDay = new Date(state.viewYear, state.viewMonth, 1);
  const daysInMonth = new Date(state.viewYear, state.viewMonth + 1, 0).getDate();
  const startIndex = (firstDay.getDay() + 6) % 7;

  calendarMonth.textContent = firstDay.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  calendarSub.textContent =
    `${formatters.jalali.format(firstDay)} · ${formatters.hijri.format(firstDay)}`;

  calendarGrid.innerHTML = "";
  for (let i = 0; i < startIndex; i += 1) {
    const filler = document.createElement("div");
    filler.className = "calendar-day is-closed";
    filler.style.visibility = "hidden";
    calendarGrid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(state.viewYear, state.viewMonth, day);
    const iso = formatISODate(date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = iso;

    if (isClosedDate(date)) {
      button.classList.add("is-closed");
    }

    if (iso === formatISODate(new Date())) {
      button.classList.add("is-today");
    }

    if (state.selectedDateISO === iso) {
      button.classList.add("is-selected");
    }

    button.innerHTML = `
      <strong>${day}</strong>
      <small>J ${formatters.jalaliDay.format(date)}</small>
      <small>H ${formatters.hijriDay.format(date)}</small>
    `;

    if (!isClosedDate(date)) {
      button.addEventListener("click", () => handleDateSelection(date));
    }

    calendarGrid.appendChild(button);
  }
};

const renderCalendarInfo = async () => {
  if (!state.selectedDate) {
    calendarInfo.innerHTML = "<p>Select a day to see availability.</p>";
    timeSlotsEl.innerHTML = "";
    return;
  }

  const iso = state.selectedDateISO;
  let availability;
  try {
    availability = await api.getAvailability(iso);
  } catch (error) {
    calendarInfo.innerHTML = "<p>Unable to load availability.</p>";
    return;
  }
  if (availability.error) {
    calendarInfo.innerHTML = `<p>${availability.error}</p>`;
    return;
  }
  const isClosed = availability.closed;

  if (
    state.manage.action === "reschedule" &&
    state.manage.appointment &&
    state.manage.appointment.date === iso
  ) {
    const slot = state.manage.appointment.timeSlot;
    if (availability.reservedCounts && availability.reservedCounts[slot]) {
      availability.reservedCounts[slot] = Math.max(availability.reservedCounts[slot] - 1, 0);
    }
  }

  calendarInfo.innerHTML = `
    <p><strong>${formatters.human.format(state.selectedDate)}</strong></p>
    <p>Jalali: ${formatters.jalali.format(state.selectedDate)}</p>
    <p>Hijri: ${formatters.hijri.format(state.selectedDate)}</p>
    <p>Status: ${isClosed ? "Closed" : "Open"}</p>
  `;

  renderTimeSlots(availability);
};

const renderTimeSlots = (availability) => {
  if (!state.config) return;
  if (availability.closed) {
    timeSlotsEl.innerHTML = "<p class=\"label\">No slots available (closed).</p>";
    selectedTimeInput.value = "";
    state.selectedTime = "";
    return;
  }

  timeSlotsEl.innerHTML = "";
  const reservedCounts = availability.reservedCounts || {};
  state.config.timeSlots.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot";
    button.textContent = slot.label;

    const bookedCount = reservedCounts[slot.value] || 0;
    const isFull = bookedCount >= availability.slotCapacity;
    if (isFull) {
      button.classList.add("is-disabled");
      button.disabled = true;
    }

    if (state.selectedTime === slot.value) {
      button.classList.add("is-selected");
    }

    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.selectedTime = slot.value;
      selectedTimeInput.value = slot.value;
      document
        .querySelectorAll(".time-slot")
        .forEach((slotButton) => slotButton.classList.remove("is-selected"));
      button.classList.add("is-selected");
    });

    timeSlotsEl.appendChild(button);
  });
};

const handleDateSelection = (date) => {
  state.selectedDate = date;
  state.selectedDateISO = formatISODate(date);
  selectedDateInput.value = formatters.human.format(date);
  state.selectedTime = "";
  selectedTimeInput.value = "";
  renderCalendar();
  renderCalendarInfo();
};

const renderRates = () => {
  if (!state.rates.length) {
    rateTable.innerHTML = "<p class=\"section-lead\">Loading rates...</p>";
    return;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  });

  rateTable.innerHTML = state.rates
    .map((rate) => {
      const buyValue = state.useToman ? rate.buy / 10 : rate.buy;
      const sellValue = state.useToman ? rate.sell / 10 : rate.sell;
      const unit = state.useToman ? "IRT" : "IRR";

      return `
        <div class="rate-row">
          <div>
            <strong>${rate.code}</strong>
            <span>${rate.name}</span>
          </div>
          <div>
            <strong>${formatter.format(buyValue)} ${unit}</strong>
            <span>Buy</span>
          </div>
          <div>
            <strong>${formatter.format(sellValue)} ${unit}</strong>
            <span>Sell</span>
          </div>
        </div>
      `;
    })
    .join("");

  if (state.ratesUpdatedAt) {
    ratesUpdated.textContent = `Last updated: ${formatters.human.format(
      new Date(state.ratesUpdatedAt)
    )}`;
  }
};

const renderQueue = (queueData) => {
  if (queueData.error) {
    if (queueSize) {
      queueSize.textContent = "0 confirmed";
    }
    return;
  }

  const stats = queueData.stats || { confirmed: 0 };
  if (queueSize) {
    queueSize.textContent = `${stats.confirmed || 0} confirmed`;
  }
};

const updateHero = () => {
  if (!state.config) return;
  const openDayNames = dayNames.filter(
    (_, index) => !state.config.closedWeekdays.includes(index)
  );
  openDays.textContent = openDayNames.join(" · ");

  let date = new Date();
  for (let i = 0; i < 14; i += 1) {
    if (!isClosedDate(date)) break;
    date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  }
  nextAvailable.textContent =
    `${formatters.human.format(date)} · ${state.config.timeSlots[0].label}`;
};

const setBookingMode = (mode) => {
  const details = bookingForm.querySelectorAll(".booking-details input, .booking-details select");
  const fileInput = bookingForm.querySelector("input[name=documentFile]");
  const submitButton = bookingForm.querySelector("button[type=submit]");

  if (mode === "reschedule") {
    bookingForm.classList.add("is-reschedule");
    bookingForm.classList.remove("is-hidden");
    details.forEach((field) => {
      field.required = false;
      field.disabled = true;
    });
    if (fileInput) {
      fileInput.required = false;
      fileInput.disabled = true;
    }
    submitButton.textContent = "Confirm new time";
    return;
  }

  bookingForm.classList.remove("is-reschedule");
  bookingForm.classList.remove("is-hidden");
  details.forEach((field) => {
    field.disabled = false;
    field.required = true;
  });
  if (fileInput) {
    fileInput.disabled = false;
    fileInput.required = true;
  }
  submitButton.textContent = "Confirm appointment";
};

const showManageBanner = (html) => {
  manageBanner.classList.remove("is-hidden");
  manageBanner.innerHTML = html;
};

const clearManageBanner = () => {
  manageBanner.classList.add("is-hidden");
  manageBanner.innerHTML = "";
};

const refreshDashboard = async () => {
  const queueData = await api.getQueue();
  renderQueue(queueData);
};

const handleBookingSubmit = async (event) => {
  event.preventDefault();
  bookingMessage.textContent = "";

  if (state.manage.action === "reschedule") {
    if (!state.selectedDateISO || !selectedTimeInput.value) {
      bookingMessage.textContent = "Please select a new date and time slot.";
      return;
    }

    const response = await api.rescheduleAppointment(state.manage.id, state.manage.token, {
      date: state.selectedDateISO,
      timeSlot: selectedTimeInput.value,
    });

    if (response.error) {
      bookingMessage.textContent = response.error;
      return;
    }

    bookingMessage.innerHTML = `
      <strong>Appointment rescheduled.</strong><br />
      ${response.appointment.date} · ${response.appointment.timeSlot}<br />
      Email status: ${emailStatusLabels[response.emailStatus] || response.emailStatus}
    `;
    clearManageBanner();
    setBookingMode("normal");
    refreshDashboard();
    return;
  }

  const formData = new FormData(bookingForm);
  formData.set("date", state.selectedDateISO);
  const fileInput = bookingForm.querySelector("input[name=documentFile]");

  const requiredFields = [
    { key: "firstName", label: "First name" },
    { key: "lastName", label: "Last name" },
    { key: "email", label: "Email" },
    { key: "documentType", label: "Document type" },
    { key: "documentNumber", label: "Document ID number" },
  ];

  for (const field of requiredFields) {
    if (!formData.get(field.key)) {
      bookingMessage.textContent = `${field.label} is required.`;
      return;
    }
  }

  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    bookingMessage.textContent = "Document file is required.";
    return;
  }

  if (!state.selectedDateISO || !formData.get("timeSlot")) {
    bookingMessage.textContent = "Please select a date and time slot.";
    return;
  }

  const response = await api.createAppointment(formData);
  if (response.error) {
    bookingMessage.textContent = response.error;
    return;
  }

  bookingMessage.innerHTML = `
    <strong>Your appointment is set.</strong><br />
    ${response.appointment.date} · ${response.appointment.timeSlot}<br />
    Email status: ${emailStatusLabels[response.emailStatus] || response.emailStatus}
  `;

  bookingForm.reset();
  selectedDateInput.value = "";
  selectedTimeInput.value = "";
  state.selectedTime = "";
  state.selectedDate = null;
  state.selectedDateISO = "";
  renderCalendar();
  renderCalendarInfo();
  refreshDashboard();
};

const handleQueueSubmit = async (event) => {
  event.preventDefault();
  queueResult.textContent = "";
  const formData = new FormData(queueForm);
  const email = formData.get("email");
  if (!email) {
    queueResult.textContent = "Please enter an email address.";
    return;
  }
  const response = await api.searchAppointment(email);

  if (response.error) {
    queueResult.textContent = response.error;
    return;
  }

  if (!response.appointment) {
    queueResult.textContent = "No appointment found for that email.";
    return;
  }

  const item = response.appointment;
  queueResult.innerHTML = `
    <strong>${item.firstName} ${item.lastName}</strong><br />
    ${item.date} · ${item.timeSlot}<br />
    Status: ${statusLabels[item.status] || item.status}<br />
    Queue position: ${response.queuePosition}
  `;
};

const refreshRates = async () => {
  const data = await api.getRates(state.showAllRates);
  if (data.error) {
    rateTable.innerHTML = `<p class="section-lead">${data.error}</p>`;
    return;
  }
  state.rates = data.rates || [];
  state.ratesUpdatedAt = data.updatedAt;
  renderRates();
};

const initManageFlow = async () => {
  clearManageBanner();
  state.manage = { action: null, id: null, token: null, appointment: null };
  const params = new URLSearchParams(window.location.search);
  const action = params.get("action");
  const id = params.get("id");
  const token = params.get("token");

  if (!action || !id || !token) {
    setBookingMode("normal");
    return;
  }

  const response = await api.getAppointment(id, token);
  if (response.error || !response.appointment) {
    showManageBanner("This link is invalid or has expired.");
    bookingForm.classList.add("is-hidden");
    return;
  }

  state.manage = { action, id, token, appointment: response.appointment };
  const appointment = response.appointment;

  if (action === "reschedule") {
    setBookingMode("reschedule");
    const currentDate = parseISODate(appointment.date);
    state.selectedDate = currentDate;
    state.selectedDateISO = appointment.date;
    state.selectedTime = appointment.timeSlot;
    selectedDateInput.value = formatters.human.format(currentDate);
    selectedTimeInput.value = appointment.timeSlot;
    renderCalendar();
    renderCalendarInfo();
    showManageBanner(`
      <strong>Reschedule appointment</strong><br />
      ${appointment.firstName} ${appointment.lastName} · ${appointment.date} · ${appointment.timeSlot}<br />
      Choose a new date and time below.
    `);
    return;
  }

  if (action === "cancel") {
    bookingForm.classList.add("is-hidden");
    showManageBanner(`
      <strong>Cancel appointment</strong><br />
      ${appointment.firstName} ${appointment.lastName} · ${appointment.date} · ${appointment.timeSlot}<br />
      <button class="button ghost" data-action="confirm-cancel">Confirm cancellation</button>
    `);
  }
};

const init = async () => {
  const configData = await api.getConfig();
  if (configData.error) {
    bookingMessage.textContent = configData.error;
    state.config = DEFAULT_CONFIG;
  } else {
    state.config = configData;
  }

  const blocked = await api.getBlockedDates();
  if (!blocked.error) {
    state.blockedDates = new Set(blocked.blockedDates || []);
  }
  renderCalendar();
  renderCalendarInfo();
  updateHero();
  refreshDashboard();
  refreshRates();
  await initManageFlow();

  if (toggleCurrencyButton) {
    toggleCurrencyButton.textContent = state.showAllRates
      ? "Show top currencies"
      : "Show all currencies";
  }

  bookingForm.addEventListener("submit", handleBookingSubmit);
  queueForm.addEventListener("submit", handleQueueSubmit);
  manageBanner.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='confirm-cancel']");
    if (!button || state.manage.action !== "cancel") return;

    const response = await api.cancelAppointment(state.manage.id, state.manage.token);
    if (response.error) {
      manageBanner.textContent = response.error;
      return;
    }

    manageBanner.innerHTML = `
      <strong>Appointment canceled.</strong><br />
      Email status: ${emailStatusLabels[response.emailStatus] || response.emailStatus}
    `;
    refreshDashboard();
  });
  prevMonthButton.addEventListener("click", () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    }
    renderCalendar();
  });
  nextMonthButton.addEventListener("click", () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    renderCalendar();
  });
  toggleCurrencyButton.addEventListener("click", () => {
    state.showAllRates = !state.showAllRates;
    toggleCurrencyButton.textContent = state.showAllRates
      ? "Show top currencies"
      : "Show all currencies";
    refreshRates();
  });
  toggleUnitButton.addEventListener("click", () => {
    state.useToman = !state.useToman;
    toggleUnitButton.textContent = state.useToman
      ? "Display in Rial"
      : "Display in Toman";
    renderRates();
  });
};

init();
