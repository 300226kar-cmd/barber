require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= DATABASE TABLES =================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGINT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      date TEXT,
      time TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS closed_days (
      id SERIAL PRIMARY KEY,
      type TEXT,
      value TEXT
    )
  `);
}

initDB().then(() => console.log("✅ Tables ready"))
        .catch(err => console.error("❌ DB init error:", err));

// ================= ADMIN PASSWORD =================
const ADMIN_PASSWORD = "1234"; // Փոխիր, եթե ուզում ես

// ================= STATIC FILES =================
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ================= BOOKINGS =================

// GET զբաղված ժամերը
app.get("/api/bookings", async (req, res) => {
  const { date } = req.query;
  try {
    const result = await pool.query(
      "SELECT time FROM bookings WHERE date=$1",
      [date]
    );
    const bookedTimes = result.rows.map(r => r.time);
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

  try {
    // ստուգել փակ օրերը
    const dayNumber = new Date(date).getDay();
    const closedResult = await pool.query("SELECT type, value FROM closed_days");
    const closedWeekdays = closedResult.rows.filter(r => r.type==='weekday').map(r => parseInt(r.value));
    const closedDates = closedResult.rows.filter(r => r.type==='date').map(r => r.value);

    if (closedWeekdays.includes(dayNumber) || closedDates.includes(date)) {
      return res.status(400).json({ message: "Այս օրը փակ է" });
    }

    // ստուգել, եթե արդեն կա
    const check = await pool.query("SELECT * FROM bookings WHERE date=$1 AND time=$2", [date, time]);
    if (check.rows.length > 0) return res.status(400).json({ message: "Ժամը արդեն զբաղված է" });

    const id = Date.now();
    await pool.query(
      "INSERT INTO bookings(id, name, phone, date, time) VALUES($1,$2,$3,$4,$5)",
      [id, name, phone, date, time]
    );

    res.json({ message: "Պատվերը ընդունվեց" });

  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// GET բոլոր պատվերները (ADMIN)
app.post("/api/all-bookings", async (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: "Սխալ գաղտնաբառ" });
  try {
    const result = await pool.query("SELECT * FROM bookings ORDER BY date, time");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// DELETE պատվեր (ADMIN)
app.post("/api/delete-booking", async (req, res) => {
  const { password, id } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: "Սխալ գաղտնաբառ" });
  try {
    await pool.query("DELETE FROM bookings WHERE id=$1", [id]);
    res.json({ message: "Պատվերը ջնջվեց" });
  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// ================= CLOSED DAYS =================

// GET փակ օրերը
app.get("/api/closed-days", async (req, res) => {
  try {
    const result = await pool.query("SELECT type, value FROM closed_days");
    const weekdays = result.rows.filter(r => r.type==='weekday').map(r => parseInt(r.value));
    const dates = result.rows.filter(r => r.type==='date').map(r => r.value);
    res.json({ weekdays, dates });
  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// ADD փակ օր (ADMIN)
app.post("/api/add-closed-day", async (req, res) => {
  const { password, type, value } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: "Սխալ գաղտնաբառ" });

  try {
    await pool.query(
      "INSERT INTO closed_days(type, value) VALUES($1, $2) ON CONFLICT DO NOTHING",
      [type, value]
    );
    res.json({ message: "Ավելացվեց" });
  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// REMOVE փակ օր (ADMIN)
app.post("/api/remove-closed-day", async (req, res) => {
  const { password, type, value } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ message: "Սխալ գաղտնաբառ" });

  try {
    await pool.query("DELETE FROM closed_days WHERE type=$1 AND value=$2", [type, value]);
    res.json({ message: "Ջնջվեց" });
  } catch (err) {
    res.status(500).json({ message: "Database error" });
  }
});

// ================= CLEAN OLD BOOKINGS =================
async function cleanOldBookings() {
  try {
    await pool.query("DELETE FROM bookings WHERE date::date < CURRENT_DATE");
    console.log("🧹 Old bookings cleaned");
  } catch (err) {
    console.error("Cleaning error:", err);
  }
}
cleanOldBookings();
setInterval(cleanOldBookings, 5*60*1000);

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("🚀 Server running on port " + PORT));

