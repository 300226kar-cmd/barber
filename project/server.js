process.env.DATABASE_URL
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());

// static files
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const ADMIN_PASSWORD = "1234"; // փոխիր եթե ուզում ես

// փակ օրերի պահում (memory)
let closedWeekdays = []; // օրինակ [0,6]
let closedDates = [];    // օրինակ ["2026-02-25"]

pool.query(`
CREATE TABLE IF NOT EXISTS closed_days (
id SERIAL PRIMARY KEY,
type TEXT,
value TEXT
)
`);

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ստեղծում ենք bookings table եթե չկա
pool.query(`
  CREATE TABLE IF NOT EXISTS bookings (
    id BIGINT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    date TEXT,
    time TEXT
  )
`).then(() => {
  console.log("✅ Table ready");
}).catch(err => {
  console.error("❌ Table creation error:", err);
});


// ================= BOOKINGS =================

// GET զբաղված ժամերը
app.get("/api/bookings", async (req, res) => {
  const { date } = req.query;

  try {
    const result = await pool.query(
      "SELECT time FROM bookings WHERE date = $1",
      [date]
    );

    const bookedTimes = result.rows.map(row => row.time);
    res.json(bookedTimes);

  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// POST նոր պատվեր
app.post("/api/book", async (req, res) => {
  const { name, phone, date, time } = req.body;

  if (!name || !phone || !date || !time)
    return res.status(400).json({ message: "Բոլոր դաշտերը պարտադիր են" });

  // ստուգում փակ օրերը
  const dayNumber = new Date(date).getDay();

  if (closedWeekdays.includes(dayNumber) || closedDates.includes(date)) {
    return res.status(400).json({ message: "Այս օրը փակ է" });
  }

  try {
    const check = await pool.query(
      "SELECT * FROM bookings WHERE date = $1 AND time = $2",
      [date, time]
    );

    if (check.rows.length > 0)
      return res.status(400).json({ message: "Ժամը արդեն զբաղված է" });

    const id = Date.now();

    await pool.query(
      "INSERT INTO bookings (id, name, phone, date, time) VALUES ($1, $2, $3, $4, $5)",
      [id, name, phone, date, time]
    );

    res.json({ message: "Պատվերը ընդունվեց" });

  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// ================= ADMIN =================

// ստանալ բոլոր պատվերները
app.post("/api/all-bookings", async (req, res) => {
  const { password } = req.body;

  if (password !== ADMIN_PASSWORD)
    return res.status(401).json({ message: "Սխալ գաղտնաբառ" });

  try {
    const result = await pool.query(
      "SELECT * FROM bookings ORDER BY date, time"
    );
    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// ջնջել պատվեր
app.post("/api/delete-booking", async (req, res) => {
  const { password, id } = req.body;

  if (password !== ADMIN_PASSWORD)
    return res.status(401).json({ message: "Սխալ գաղտնաբառ" });

  try {
    await pool.query("DELETE FROM bookings WHERE id = $1", [id]);
    res.json({ message: "Պատվերը ջնջվեց" });

  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});


// ================= CLOSED DAYS =================

// ստանալ փակ օրերը
app.get("/api/closed-days", (req, res) => {
  res.json({
    weekdays: closedWeekdays,
    dates: closedDates
  });
});

// ավելացնել փակ օր
app.post("/api/add-closed-day", (req, res) => {
  const { password, type, value } = req.body;

  if (password !== ADMIN_PASSWORD)
    return res.status(401).json({ message: "Սխալ գաղտնաբառ" });

  if (type === "weekday") {
    if (!closedWeekdays.includes(value))
      closedWeekdays.push(value);
  }

  if (type === "date") {
    if (!closedDates.includes(value))
      closedDates.push(value);
  }

  res.json({ message: "Ավելացվեց" });
});

// ջնջել փակ օր
app.post("/api/remove-closed-day", (req, res) => {
  const { password, type, value } = req.body;

  if (password !== ADMIN_PASSWORD)
    return res.status(401).json({ message: "Սխալ գաղտնաբառ" });

  if (type === "weekday") {
    closedWeekdays = closedWeekdays.filter(d => d !== value);
  }

  if (type === "date") {
    closedDates = closedDates.filter(d => d !== value);
  }

  res.json({ message: "Ջնջվեց" });
});

// ավտոմատ մաքրում
async function cleanOldBookings() {
  try {
    await pool.query("DELETE FROM bookings WHERE date::date < CURRENT_DATE");
    console.log("🧹 Old bookings cleaned");
  } catch (err) {
    console.error("Cleaning error:", err);
  }
}

cleanOldBookings();
setInterval(cleanOldBookings, 5 * 60 * 1000);


// ================= SERVER =================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});

