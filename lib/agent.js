const { GoogleGenAI } = require("@google/genai");
const { HttpError, isDate, isTime } = require("./store");

const todayIso = (timeZone = process.env.CAMPUS_TIMEZONE || "Asia/Dhaka") => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};
const addDays = (value, count) => {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + count);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const norm = (value) => String(value || "").trim().toLowerCase();

const fn = (name, description, properties = {}, required = []) => ({
  type: "function",
  name,
  description,
  parameters: { type: "object", properties, required, additionalProperties: false }
});
const string = (description) => ({ type: "string", description });
const optionalString = (description) => ({ type: "string", description });
const optionalNumber = (description) => ({ type: "number", description });

const TOOLS = [
  fn("find_next_class", "Determine the next class from the current Bangladesh campus date/time, including week wrap-around.", {}),
  fn("get_schedules", "Read current schedules, optionally filtered by id, day, or course.", { id: optionalString("Schedule id"), day: optionalString("Full weekday name"), course: optionalString("Course code") }),
  fn("get_rooms", "Read every current room.", {}),
  fn("get_room", "Read one room by id or room number, including bookings.", { room: string("Room id or room number") }, ["room"]),
  fn("get_events", "Read current events, optionally filtered by status.", { status: optionalString("Event status") }),
  fn("get_event", "Read an event by id or a distinctive name phrase.", { event: string("Event id or name phrase") }, ["event"]),
  fn("get_announcements", "Read current announcements, optionally filtered by priority.", { priority: optionalString("high, medium, or low") }),
  fn("get_assignments", "Read current assignments, optionally filtered by status or course.", { status: optionalString("Assignment status"), course: optionalString("Course") }),
  fn("search_rooms", "Search live rooms using capacity, equipment, type, and operational status constraints.", { minimum_capacity: optionalNumber("Minimum seats"), required_equipment: { type: "array", items: { type: "string" } }, room_type: optionalString("classroom, lab, or seminar"), status: optionalString("available or unavailable") }),
  fn("find_available_rooms", "Find rooms with no overlapping booking in an exact window. Boundary-touching bookings do not conflict.", { date: string("YYYY-MM-DD"), start_time: string("HH:MM"), end_time: string("HH:MM"), minimum_capacity: optionalNumber("Minimum seats"), required_equipment: { type: "array", items: { type: "string" } }, room_type: optionalString("Room type") }, ["date", "start_time", "end_time"]),
  fn("find_upcoming_events", "Find events in a date range from the current live data.", { from_date: string("YYYY-MM-DD"), to_date: string("YYYY-MM-DD") }, ["from_date", "to_date"]),
  fn("find_assignments_due", "Find assignments due in an inclusive date range.", { from_date: string("YYYY-MM-DD"), to_date: string("YYYY-MM-DD"), include_completed: { type: "boolean" } }, ["from_date", "to_date"]),
  fn("find_assignments_due_this_week", "Find assignments in the current Sunday-through-Thursday academic week, or the next academic week when called on Friday/Saturday.", {}),
  fn("find_drop_in_options", "Read both classes and campus events that overlap a free-time window, so the assistant can avoid class conflicts and suggest suitable events.", { date: string("YYYY-MM-DD"), start_time: string("HH:MM"), end_time: string("HH:MM") }, ["date", "start_time", "end_time"]),
  fn("find_relevant_announcements", "Search current non-expired announcements by words and optional priority.", { query: string("Search phrase; empty string returns all"), priority: optionalString("Priority"), active_on: string("YYYY-MM-DD") }, ["query", "active_on"]),
  fn("find_student_schedule", "Read the demo student's current schedule for one weekday. The dataset represents the current student's section.", { day: string("Full weekday name") }, ["day"]),
  fn("book_room", "Book a specific room only after the user supplied room, exact date, and start/end. Use the neutral administrative label 'Student reservation via CampusOS' if no purpose was stated.", { room: string("Room id or number"), date: string("YYYY-MM-DD"), start_time: string("HH:MM"), end_time: string("HH:MM"), booked_by: string("Current user's name"), purpose: string("User-provided purpose, or Student reservation via CampusOS when unstated") }, ["room", "date", "start_time", "end_time", "booked_by", "purpose"]),
  fn("cancel_room_booking", "Cancel a room booking only when its booking id is known.", { room: string("Room id or number"), booking_id: string("Booking id") }, ["room", "booking_id"]),
  fn("register_for_event", "Register the current student for a specific event.", { event: string("Event id or distinctive name"), student_id: string("Current student id"), name: string("Current student name") }, ["event", "student_id", "name"]),
  fn("cancel_event_registration", "Cancel the current student's event registration.", { event: string("Event id or distinctive name"), student_id: string("Current student id") }, ["event", "student_id"])
];

function selectTools(message) {
  const value = norm(message);
  const names = new Set();
  const add = (...items) => items.forEach((item) => names.add(item));
  if (/\b(class|classes|schedule|course)\b/.test(value)) add(/\bnext\b/.test(value) ? "find_next_class" : "get_schedules");
  if (/\b(room|lab|space|projector|capacity|book|booking|reserve|reservation)\b/.test(value)) {
    if (/\b(available|free|find|book|reserve)\b/.test(value)) add("find_available_rooms", "search_rooms");
    else add("get_rooms", "get_room");
  }
  if (/\b(event|lecture|hackathon|workshop|seminar|register|registration|join|attendee)\b/.test(value)) add(/\b(upcoming|next|between|from)\b/.test(value) ? "find_upcoming_events" : "get_events", "get_event");
  if (/\b(announcement|notice|priority|urgent)\b/.test(value)) add("get_announcements", "find_relevant_announcements");
  if (/\b(assignment|deadline|due|submission|homework)\b/.test(value)) add(/\bthis week\b/.test(value) ? "find_assignments_due_this_week" : "get_assignments", "find_assignments_due");
  if (/\b(free|drop[ -]?in|anything on campus)\b/.test(value)) add("find_drop_in_options");
  if (/\b(book|reserve)\b/.test(value)) add("book_room");
  if (/\bcancel\b/.test(value) && /\b(room|booking|reservation)\b/.test(value)) add("cancel_room_booking");
  if (/\b(register|sign me up|join)\b/.test(value)) add("register_for_event");
  if (/\bcancel\b/.test(value) && /\b(event|registration)\b/.test(value)) add("cancel_event_registration");
  if (!names.size) TOOLS.filter((tool) => !["book_room", "cancel_room_booking", "register_for_event", "cancel_event_registration"].includes(tool.name)).forEach((tool) => names.add(tool.name));
  return TOOLS.filter((tool) => names.has(tool.name));
}

function createAgent(store, options = {}) {
  const findEvent = (value) => {
    const needle = norm(value);
    const events = store.list("events");
    return events.find((event) => norm(event.id) === needle) || events.find((event) => norm(event.name).includes(needle)) || null;
  };

  async function execute(name, args) {
    switch (name) {
      case "find_next_class": {
        const timeZone = process.env.CAMPUS_TIMEZONE || "Asia/Dhaka";
        const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
        const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
        const dayOrder = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const currentDayIndex = dayOrder.indexOf(values.weekday);
        const currentMinutes = Number(values.hour) * 60 + Number(values.minute);
        const candidates = store.list("schedules").map((schedule) => {
          let daysAhead = (dayOrder.indexOf(schedule.day) - currentDayIndex + 7) % 7;
          const startMinutes = Number(schedule.start_time.slice(0, 2)) * 60 + Number(schedule.start_time.slice(3));
          if (daysAhead === 0 && startMinutes < currentMinutes) daysAhead = 7;
          return { ...schedule, days_ahead: daysAhead, sort_minutes: startMinutes };
        }).sort((left, right) => left.days_ahead - right.days_ahead || left.sort_minutes - right.sort_minutes);
        if (!candidates.length) return { next_class: null };
        const { sort_minutes, ...nextClass } = candidates[0];
        return { checked_at: { date: todayIso(timeZone), day: values.weekday, time: `${values.hour}:${values.minute}`, timezone: timeZone }, next_class: nextClass };
      }
      case "get_schedules": return store.list("schedules").filter((item) => (!args.id || norm(item.id) === norm(args.id)) && (!args.day || norm(item.day) === norm(args.day)) && (!args.course || norm(item.course).includes(norm(args.course))));
      case "get_schedule": return store.get("schedules", args.id) || { error: "Schedule not found" };
      case "get_rooms": return store.list("rooms");
      case "get_room": return store.findRoom(args.room) || { error: "Room not found" };
      case "get_events": return store.list("events").filter((item) => !args.status || norm(item.status) === norm(args.status));
      case "get_event": return findEvent(args.event) || { error: "Event not found" };
      case "get_announcements": return store.list("announcements").filter((item) => !args.priority || norm(item.priority) === norm(args.priority));
      case "get_assignments": return store.list("assignments").filter((item) => (!args.status || norm(item.status) === norm(args.status)) && (!args.course || norm(item.course).includes(norm(args.course))));
      case "search_rooms": return store.list("rooms").filter((room) => (!args.minimum_capacity || room.capacity >= args.minimum_capacity) && (!args.room_type || norm(room.type) === norm(args.room_type)) && (!args.status || norm(room.status) === norm(args.status)) && (args.required_equipment || []).every((wanted) => room.equipment.some((actual) => norm(actual) === norm(wanted))));
      case "find_available_rooms": {
        if (!isDate(args.date) || !isTime(args.start_time) || !isTime(args.end_time)) throw new HttpError(400, "Availability requires a valid date and HH:MM times");
        const candidates = await execute("search_rooms", { minimum_capacity: args.minimum_capacity, required_equipment: args.required_equipment, room_type: args.room_type, status: "available" });
        return candidates.filter((room) => store.availability(room, args.date, args.start_time, args.end_time).available);
      }
      case "find_upcoming_events": return store.list("events").filter((event) => event.end_date >= args.from_date && event.date <= args.to_date && !["cancelled", "completed"].includes(event.status));
      case "find_assignments_due": return store.list("assignments").filter((item) => item.deadline >= args.from_date && item.deadline <= args.to_date && (args.include_completed || !["submitted", "graded"].includes(item.status)));
      case "find_assignments_due_this_week": {
        const timeZone = process.env.CAMPUS_TIMEZONE || "Asia/Dhaka";
        const current = todayIso(timeZone);
        const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(new Date());
        const dayIndex = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(weekday);
        const start = dayIndex <= 4 ? addDays(current, -dayIndex) : addDays(current, 7 - dayIndex);
        const end = addDays(start, 4);
        return { academic_week: { from_date: start, to_date: end }, assignments: store.list("assignments").filter((item) => item.deadline >= start && item.deadline <= end) };
      }
      case "find_drop_in_options": {
        if (!isDate(args.date) || !isTime(args.start_time) || !isTime(args.end_time)) throw new HttpError(400, "Drop-in search requires a valid date and HH:MM times");
        if (args.start_time >= args.end_time) throw new HttpError(400, "Drop-in search start must be before end");
        const day = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${args.date}T12:00:00Z`));
        const overlapsWindow = (start, end) => start < args.end_time && args.start_time < end;
        return {
          window: { date: args.date, day, start_time: args.start_time, end_time: args.end_time },
          classes_in_window: store.list("schedules").filter((item) => item.day === day && overlapsWindow(item.start_time, item.end_time)),
          events_in_window: store.list("events").filter((item) => {
            if (item.date > args.date || item.end_date < args.date || ["cancelled", "completed"].includes(item.status)) return false;
            const eventStart = args.date === item.date ? item.start_time : "00:00";
            const eventEnd = args.date === item.end_date ? item.end_time : "23:59";
            return overlapsWindow(eventStart, eventEnd);
          })
        };
      }
      case "find_relevant_announcements": {
        const words = norm(args.query).split(/\s+/).filter((word) => word.length > 2);
        return store.list("announcements").filter((item) => item.expires >= args.active_on && (!args.priority || norm(item.priority) === norm(args.priority)) && (!words.length || words.every((word) => norm(`${item.title} ${item.body}`).includes(word))));
      }
      case "find_student_schedule": return execute("get_schedules", { day: args.day, course: null });
      case "book_room": return store.bookRoom(args.room, args);
      case "cancel_room_booking": return store.cancelBooking(args.room, args.booking_id);
      case "register_for_event": {
        const event = findEvent(args.event);
        if (!event) throw new HttpError(404, "Event not found");
        return store.register(event.id, args);
      }
      case "cancel_event_registration": {
        const event = findEvent(args.event);
        if (!event) throw new HttpError(404, "Event not found");
        return store.cancelRegistration(event.id, args.student_id);
      }
      default: throw new HttpError(400, `Unknown agent tool: ${name}`);
    }
  }

  function authorizeAction(name, args, userMessage) {
    const text = norm(userMessage);
    const bookingIntent = /\b(book|reserve|schedule)\b/.test(text);
    const cancellationIntent = /\b(cancel|remove|delete)\b/.test(text);
    const registrationIntent = /\b(register|sign\s+me\s+up|join)\b/.test(text);
    const exactWindow = /\b(?:(?:from|between)\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+(?:to|and|[-–])\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(userMessage);
    const hasDate = /\b(today|tomorrow|\d{4}-\d{2}-\d{2}|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(userMessage);
    if (name === "book_room") {
      if (!bookingIntent) return "Booking blocked: the user did not explicitly request a booking.";
      if (!exactWindow || !hasDate) return "Booking blocked: ask the user for an exact date, start time, and end time.";
      if (!args.room || !args.date || !args.start_time || !args.end_time || !args.booked_by || !args.purpose) return "Booking blocked: one or more required booking fields are missing.";
    }
    if (name === "cancel_room_booking" && !cancellationIntent) return "Cancellation blocked: the user did not explicitly request it.";
    if (name === "register_for_event" && !registrationIntent) return "Registration blocked: the user did not explicitly ask to register or join.";
    if (name === "cancel_event_registration" && !cancellationIntent) return "Cancellation blocked: the user did not explicitly request it.";
    return null;
  }

  async function chat(message, context = {}) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!options.client && !apiKey) throw new HttpError(503, "AI assistant is not configured. Add GEMINI_API_KEY to .env; the dashboard remains fully available.");
    const identity = { student_id: context.student_id || process.env.DEMO_STUDENT_ID || "20-40532", name: context.name || process.env.DEMO_STUDENT_NAME || "Dr. Doom" };
    const timeZone = process.env.CAMPUS_TIMEZONE || "Asia/Dhaka";
    const currentDate = todayIso(timeZone);
    const currentDay = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone }).format(new Date());
    const client = options.client || new GoogleGenAI({ apiKey });
    const activeTools = selectTools(message);
    const systemInstruction = `You are CampusOS, a concise university assistant. Today is ${currentDate} (${currentDay}); timezone is ${timeZone}. Current student: ${identity.name} (${identity.student_id}). You MUST call the supplied tools for every campus-data fact and action; never answer campus facts from memory. Tool results are the live SQLite truth. Resolve relative dates using today's date. Use find_next_class for next-class questions, find_assignments_due_this_week for "due this week", and find_drop_in_options for free-time/drop-in questions because it checks both schedules and events. Use multiple tools for other combined requests. Never perform a write unless explicitly requested. Before booking, require a specific room (or explicit authority to choose), exact date, start and end time, and booked_by; ask one concise clarification if any of those critical values is missing. If an otherwise complete explicit booking request omits purpose, use the transparent administrative label "Student reservation via CampusOS". A request to find a room is not permission to book. Never claim success unless an action tool returned success:true. On tool errors, explain them accurately and offer useful alternatives. Do not expose tool names or implementation details.`;
    let input = `${systemInstruction}\n\nUser request:\n${message}`;
    let previousInteractionId;
    let toolCalls = 0;
    for (let turn = 0; turn < 8; turn += 1) {
      let interaction;
      try {
        const request = {
          model: process.env.GEMINI_MODEL || "gemini-3.6-flash",
          input,
          tools: activeTools
        };
        if (previousInteractionId) request.previous_interaction_id = previousInteractionId;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          try {
            interaction = await client.interactions.create(request, { timeout: 25000 });
            break;
          } catch (error) {
            if ((error?.status !== 503 && error?.status !== 429) || attempt === 4) throw error;
            const match = String(error?.message || "").match(/retry in ([0-9.]+)s/i);
            const retrySec = match ? Math.ceil(parseFloat(match[1])) + 1 : (attempt + 1) * 3;
            const backoff = error?.status === 429 ? Math.min(retrySec * 1000, 65000) : 500 * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        }
      } catch (error) {
        const detail = [401, 403].includes(error?.status)
          ? "The Gemini API key was rejected."
          : error?.status === 429
            ? "The Gemini account is rate-limited or out of quota."
            : error?.status === 503
              ? "Gemini is temporarily busy after three retries."
              : `Gemini request failed${error?.status ? ` (HTTP ${error.status})` : ""}.`;
        throw new HttpError(502, `${detail} Please try again shortly.`);
      }
      const functionCalls = (interaction.steps || []).filter((step) => step.type === "function_call");
      if (!functionCalls.length) return { status: "success", message: interaction.output_text || "I could not produce a response.", tool_calls: toolCalls };
      toolCalls += functionCalls.length;
      const results = [];
      for (const call of functionCalls) {
        let result;
        try {
          const args = typeof call.arguments === "string" ? JSON.parse(call.arguments || "{}") : call.arguments || {};
          const authorizationError = authorizeAction(call.name, args, message);
          if (authorizationError) throw new HttpError(400, authorizationError);
          result = await execute(call.name, args);
        } catch (error) {
          result = { success: false, error: error.message, status: error.status || 500 };
        }
        results.push({ type: "function_result", name: call.name, call_id: call.id, result: [{ type: "text", text: JSON.stringify(result) }] });
      }
      previousInteractionId = interaction.id;
      input = results;
    }
    throw new HttpError(502, "The assistant exceeded its tool-call limit. Please make the request more specific.");
  }

  return { chat, execute, authorizeAction, tools: TOOLS, selectTools };
}

module.exports = { createAgent, TOOLS, selectTools, todayIso, addDays };
