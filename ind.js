const WebSocket = require("ws");
const axios = require("axios");
const express = require("express");
require("dotenv").config();
const cors = require("cors");
const admin = require("firebase-admin");
const lastStartNotification = {};
const START_COOLDOWN_MS = 50 * 60 * 1000; // 50 min
const busState = {};
const cron = require("node-cron");
const lastBusLocationTime = {};
const trackerMonitor = {};
const busDistanceTracker = {};
const lastSentData = {};
const busStartTimes = {};
const tripStatusMap = {};
const busCollegeArrival = {};
let latestBuses = [];
let recentActivities = [];
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const attendanceMarked = {};

let cachedStudents = [];
let lastStudentFetch = 0;
const redis = require("./redis");
setInterval(() => {
  const today = new Date().toISOString().split("T")[0];

  for (const key in attendanceMarked) {
    const [, keyDate] = key.split("_");

    if (keyDate !== today) {
      delete attendanceMarked[key];
    }
  }
}, 3600000);

let redisReady = false;
const COLLEGE_LAT = 21.825334035623513;
const COLLEGE_LNG = 80.1513767355824;
const COLLEGE_RADIUS = 0.4;

(async () => {
  try {
    await redis.connectRedis();
    redisReady = true;
    console.log("Redis connected");
  } catch (e) {
    console.log("Redis connect error:", e.message);
  }
})();

const jwt = require("jsonwebtoken");

function adminAuth(req, res, next) {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.admin) throw new Error();
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function getAllUsers() {
  const [students, parents, faculty] = await Promise.all([
    admin.firestore().collection("students").get(),
    admin.firestore().collection("parents").get(),
    admin.firestore().collection("faculty").get(),
  ]);

  return {
    totalStudents: students.size,
    students: students.size,
    parents: parents.size,
    faculty: faculty.size,
    totalUsers: students.size + parents.size + faculty.size,
  };
}

require("events").EventEmitter.defaultMaxListeners = 50;

const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

(async () => {
  try {
    if (redisReady) {
      await redis.set("test", "hello");
    }
    const val = await redis.get("test");
    console.log("Redis Test:", val);
  } catch (e) {
    console.log("Redis Error:", e.message);
  }
})();

const app = express();

app.use(cors());
app.use(express.json());
function isAtCollege(lat, lng) {
  const dist = calculateDistance(lat, lng, COLLEGE_LAT, COLLEGE_LNG);

  return dist <= COLLEGE_RADIUS;
}
async function getStudentLocation(studentId) {
  try {
    const data = await redis.get(`student:${studentId}`);
    return data || null;
  } catch (e) {
    console.log("Redis error:", e.message);
    return null;
  }
}
async function handleAttendance(bus, students) {
  const busStudents = students.filter(
    (s) => s.busId === bus.busId && s.studentId && s.studentType === "college",
  );

  const today = new Date().toISOString().split("T")[0];

  for (const student of busStudents) {
    const loc = await getStudentLocation(student.studentId);

    if (!loc || typeof loc !== "object") continue;

    if (!loc.lat || !loc.lng) continue;

    const distance = calculateDistance(bus.lat, bus.lng, loc.lat, loc.lng);
    const ATT_KEY = `${student.studentId}_${today}`;

    let att = {};

    const raw = await redis.get(`att:${ATT_KEY}`);

    if (raw) {
      att = raw;
    }

    // =========================
    // BOARDING
    // =========================
    if (distance <= 0.1 && !att.boarded) {
      att.boarded = true;
      att.arrived = false;

      await redis.set(`att:${ATT_KEY}`, JSON.stringify(att));
      await redis.expire(`att:${ATT_KEY}`, 86400);

      await admin
        .firestore()
        .collection("students")
        .doc(student.studentId)
        .set(
          {
            liveStatus: {
              onboarded: true,
              present: false,
            },
          },
          { merge: true },
        );

      await admin
        .firestore()
        .collection("attendance")
        .doc(ATT_KEY)
        .set(
          {
            studentId: student.studentId,
            studentName: student.name || "",
            branch: student.branch || "",
            course: student.course || "",

            studentType: student.studentType || "",
            busId: bus.busId,

            route: bus.route || "",

            date: today,

            monthKey: getMonthKey(),

            academicYear: student.academicYear || student.year || "",

            day: new Date().toLocaleDateString("en-US", {
              weekday: "long",
            }),

            boardingTime: admin.firestore.FieldValue.serverTimestamp(),

            arrivalTime: null,

            present: false,

            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      console.log("✅ Boarded", student.studentId);
    }
    // =========================
    // ARRIVAL
    // =========================

    const latestAtt = (await redis.get(`att:${ATT_KEY}`)) || {};

    if (
      latestAtt.boarded &&
      !latestAtt.arrived &&
      isAtCollege(bus.lat, bus.lng) &&
      distance <= 1.5
    ) {
      latestAtt.arrived = true;

      await redis.set(`att:${ATT_KEY}`, JSON.stringify(latestAtt));

      await redis.expire(`att:${ATT_KEY}`, 86400);

      await admin
        .firestore()
        .collection("students")
        .doc(student.studentId)
        .set(
          {
            liveStatus: {
              onboarded: true,
              present: true,
            },
          },
          { merge: true },
        );

      await admin.firestore().collection("attendance").doc(ATT_KEY).set(
        {
          arrivalTime: admin.firestore.FieldValue.serverTimestamp(),
          present: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      console.log("🏫 Arrived", student.studentId);
    }
  }
}
/* =========================
   APIs
========================= */
const API_1 = {
  url: "http://india.voltysoft.com/api/v12/vehicles/SatpudaValley",
  key: "ZSC6ieTmLhVtQZU",
};
const SML_API = {
  loginUrl: "https://customer-api.smlsaarthi.com/login",

  vehicleUrl: "https://customer-api.smlsaarthi.com/allVehicles",

  username: "9425836824",

  password: "9425836824",

  token: null,

  tokenExpiry: null,
};

/* ======================== =
   BUS MAP
========================= */
const busMap = {
  866477065754528: "BUS-2",
  866477065667928: "BUS-3",
  860560064978408: "BUS-10",
  860560065510150: "BUS-7",
  868329087892307: "BUS-9",
  860560067136350: "BUS-11",
  866334078434509: "BUS-15",
  862567077140767: "BUS-14",
};

const driverMap = {
  "BUS-2": "Rahul Sharma",
  "BUS-3": "Amit Verma",
  "BUS-4": "Dipak Share",
  "BUS-10": "Yogesh Matre",
  "BUS-7": "Dilendra",
  "BUS-11": "Sampat",
  "BUS-15": "Yogesh Matre",
  "BUS-14": "Shyam ",
};

const driverMobileMap = {
  "BUS-2": "9876543210",
  "BUS-3": "9876543211",
  "BUS-4": "9876543212",
  "BUS-7": "9165266310",
  "BUS-10": "9876543214",
  "BUS-11": "9876543215",
  "BUS-14": "9876543216",
  "BUS-15": "9876543217",
};

const busRoutes = {
  "BUS-2": "Balaghat",
  "BUS-3": "Lalburra",
  "BUS-4": "Bharweli",
  "BUS-7": "Waraseoni",
  "BUS-10": "Khairlanji",
  "BUS-11": "Balaghat",
  "BUS-14": "Kirnapur",
  "BUS-15": "Baihar",
};

const smlBusMap = {
  MBUZT54XBK0325975: {
    imei: "866334078434509",
    busId: "BUS-15",
  },

  MBUZT54XEK0331171: {
    imei: "862567077140767",
    busId: "BUS-14",
  },

  MBUZT54XGL0317250: {
    imei: "860560067136350",
    busId: "BUS-11",
  },
};
// eta

function getBusStatus(bus) {
  const now = Date.now();
  const busId = bus.busId;

  if (!busState[busId]) {
    busState[busId] = { status: null };
  }

  const prevStatus = busState[busId].status;

  // 1. At College (highest priority)
  if (isAtCollege(bus.lat, bus.lng)) {
    if (prevStatus !== "At College") {
      addActivity("arrival", `${busId} is at college 🏫`);
    }

    busState[busId].status = "At College";
    return "At College";
  }

  // 2. Offline check (no update for 1 hour)
  if (bus.lastUpdate) {
    const diff = now - new Date(bus.lastUpdate).getTime();

    if (diff > 60 * 60 * 1000) {
      if (prevStatus !== "Offline") {
        addActivity("offline", `${busId} went offline ❌`);
      }

      busState[busId].status = "Offline";
      return "Offline";
    }
  }

  // 3. Moving
  if (Number(bus.speed) > 0) {
    if (prevStatus !== "Moving") {
      addActivity("running", `${busId} started moving 🚍`);
    }

    busState[busId].status = "Moving";
    return "Moving";
  }

  // 4. Idle (default)
  if (prevStatus !== "Idle") {
    addActivity("idle", `${busId} is idle ⏸️`);
  }

  busState[busId].status = "Idle";
  return "Idle";
}

function getMonthKey() {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function calculateETA(distance, speed) {
  if (!speed || speed < 5) speed = 20;

  const MIN_SPEED = 15;
  const MAX_SPEED = 60;

  speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));

  const minutes = (distance / speed) * 60;

  return {
    minutes: Math.round(minutes),
    text:
      minutes < 60
        ? `${Math.round(minutes)} min`
        : `${Math.floor(minutes / 60)} hr ${Math.round(minutes % 60)} min`,
  };
}
/* =========================
   STUDENT LOCATION API
========================= */
app.post("/student-location", async (req, res) => {
  try {
    const now = new Date();

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const startMinutes = 7 * 60 + 30; // 7:30 AM
    const endMinutes = 11 * 60 + 30; // 11:30 AM

    if (currentMinutes < startMinutes || currentMinutes > endMinutes) {
      return res.json({
        success: false,
        message: "Tracking time closed",
      });
    }
    console.log("📥 LOCATION API HIT");
    console.log(req.body);
    const { studentId, busId, lat, lng, fcmToken } = req.body;

    if (!studentId || !busId || lat == null || lng == null) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const payload = {
      studentId,
      busId,
      lat: Number(lat),
      lng: Number(lng),
      fcmToken: fcmToken || null,
      lastUpdated: Date.now(),
    };

    // ✅ FIXED: proper redis store
    await redis.set(`student:${studentId}`, payload);
    busState[busId] = busState[busId] || {};
    busState[busId].lastSeen = Date.now();

    // if (!global.lastFirestoreUpdate) {
    //   global.lastFirestoreUpdate = {};
    // }

    // const now = Date.now();

    // if (
    //   !global.lastFirestoreUpdate[studentId] ||
    //   now - global.lastFirestoreUpdate[studentId] > 300000
    // ) {

    //   global.lastFirestoreUpdate[studentId] = now;

    //   await admin
    //     .firestore()
    //     .collection("students")
    //     .doc(studentId)
    //     .set(
    //       {
    //         liveStatus: {
    //           lastUpdated: now,
    //         },
    //       },
    //       { merge: true }
    //     );
    // }

    return res.json({ success: true });
  } catch (e) {
    console.log("❌ LOCATION ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

function addActivity(type, message) {
  const last = recentActivities[0];

  // prevent duplicate
  if (last && last.message === message) {
    return;
  }

  recentActivities.unshift({
    type,
    message,
    time: new Date().toISOString(),
  });

  recentActivities = recentActivities.slice(0, 50);
}

/* =========================
   WEBSOCKET
========================= */
const wss = new WebSocket.Server({ port: 8080 });
console.log("🚀 WebSocket running");

/* =========================
   FETCH API
========================= */
async function fetchAPI(url, key) {
  try {
    const res = await axios.get(url, {
      headers: { "x-api-key": key },
      timeout: 10000,
    });

    return Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.log("API Error:", err.message);
    return [];
  }
}
async function loginSML() {
  try {
    const res = await axios.post(
      SML_API.loginUrl,
      {
        username: SML_API.username,
        password: SML_API.password,
      },
      { headers: { "Content-Type": "application/json" } },
    );

    SML_API.token = res.data.token;

    // 🔥 MOST IMPORTANT (if API gives expiry)
    if (res.data.expiresIn) {
      SML_API.tokenExpiry = Date.now() + res.data.expiresIn * 1000;
    } else {
      // fallback 50 min assumption
      SML_API.tokenExpiry = Date.now() + 50 * 60 * 1000;
    }

    console.log("✅ SML TOKEN GENERATED");
  } catch (e) {
    console.log("SML LOGIN ERROR:", e.response?.data || e.message);
  }
}

async function fetchSMLData(retry = 0) {
  try {
    // 🔥 CHECK TOKEN BEFORE CALL
    if (
      !SML_API.token ||
      !SML_API.tokenExpiry ||
      Date.now() > SML_API.tokenExpiry
    ) {
      console.log("🔄 TOKEN EXPIRED (refreshing...)");
      await loginSML();
    }

    const res = await axios.get(SML_API.vehicleUrl, {
      headers: {
        Authorization: `Bearer ${SML_API.token}`,
      },
      timeout: 30000,
    });

    return res.data.vehicles || [];
  } catch (err) {
    // token invalid / expired from server side
    if (err.response?.status === 401) {
      console.log("🔄 401 ERROR → Refreshing token");

      await loginSML();

      return fetchSMLData(retry + 1);
    }

    // retry timeout
    if (err.code === "ECONNABORTED" && retry < 2) {
      console.log("⏳ RETRYING SML API...");
      return fetchSMLData(retry + 1);
    }

    console.log("SML ERROR:", err.response?.data || err.message);
    return [];
  }
}
async function getAllData() {
  const voltyRaw = await fetchAPI(API_1.url, API_1.key);

  // console.log("VOLTY RAW:", voltyRaw);

  const voltyBuses = formatBuses(voltyRaw);

  console.log(`VOLTY buses: ${voltyBuses.length}`);

  const smlRaw = await fetchSMLData();

  // console.log("SML RAW:", smlRaw);

  const smlBuses = formatSMLBuses(smlRaw);

  console.log(`SML buses: ${smlBuses.length}`);

  return [...voltyBuses, ...smlBuses];
}

/* =========================
   NORMALIZE
========================= */
function normalize(item) {
  return {
    imei: String(item.imei ?? item.deviceId ?? item.trackerId ?? ""),
    lat: Number(item.lat || item.latitude || item.gps?.lat),
    lng: Number(item.lng || item.lon || item.longitude || item.gps?.lng),
    speed: Number(item.speed || 0),
  };
}

/* =========================
   PUSH NOTIFICATION
========================= */
async function sendPush(topic, title, body) {
  try {
    await admin.messaging().send({
      topic,
      notification: { title, body },
    });
  } catch (e) {
    console.log("FCM Error:", e.message);
  }
}

/* =========================
   FORMAT BUS
========================= */
function formatBuses(data) {
  const now = Date.now(); // ✅ ADD THIS
  return data
    .map((item) => {
      if (!item) return null;

      const d = normalize(item);

      if (process.env.DEBUG) console.log("IMEI:", d.imei);

      if (!busMap[d.imei]) {
        console.log("BUS MAP NOT FOUND:", d.imei);
        return null;
      }

      if (isNaN(d.lat) || isNaN(d.lng)) {
        console.log("INVALID GPS:", d);
        return null;
      }

      const busId = busMap[d.imei];

      const prev = lastBusLocationTime[d.imei];

      if (prev) {
        const diffSec = Math.floor((now - prev) / 1000);
        console.log(`🚌 BUS UPDATE: ${busId} delay = ${diffSec}s`);
      }

      lastBusLocationTime[d.imei] = now;

      return {
        busId: busMap[d.imei],
        driver: driverMap[busMap[d.imei]] || "N/A",
        route: busRoutes[busMap[d.imei]] || "N/A",
        imei: d.imei,
        lat: d.lat,
        lng: d.lng,
        speed: d.speed,
        driverMobile: driverMobileMap[busMap[d.imei]] || "N/A",

        startTime: busStartTimes[busMap[d.imei]]?.time || null,
        todayKm: busDistanceTracker[busMap[d.imei]]?.totalKm?.toFixed(2) || "0",
        collegeArrivalTime: busCollegeArrival[busMap[d.imei]]?.time || null,
        // ✅ ETA
        eta: calculateETA(5, d.speed).text,

        status: getBusStatus({
          busId: busMap[d.imei],
          lat: d.lat,
          lng: d.lng,
          speed: Number(item.speed || 0),
          lastUpdate: item.lastOnline
            ? new Date(Number(item.lastOnline) * 1000).toISOString()
            : null,
        }),

        tripActive:
          item.status === "Moving" || (d.speed != null && d.speed > 10),

        gpsTime: item.time || null,
        lastUpdate: item.time || null,
        timestamp: Date.now(),
      };
    })
    .filter(Boolean);
}

function formatSMLBuses(data) {
  const now = Date.now(); // ✅ ADD THIS
  return data
    .map((item) => {
      const map = smlBusMap[item.chassisNumber];

      // ignore unwanted buses
      if (!map) return null;
      const busId = map.busId;
      const imei = map.imei;

      const prev = lastBusLocationTime[imei];

      if (prev) {
        const diffSec = Math.floor((now - prev) / 1000);
        console.log(`🚌 BUS UPDATE: ${busId} delay = ${diffSec}s`);
      }

      lastBusLocationTime[imei] = now;

      return {
        busId: map.busId,
        driver: driverMap[map.busId] || "N/A",
        route: busRoutes[map.busId] || "N/A",
        imei: map.imei,
        driverMobile: driverMobileMap[map.busId] || "N/A",

        startTime: busStartTimes[map.busId]?.time || null,
        lat: Number(item.latitude),

        lng: Number(item.longitude),

        speed: Number(item.speed || 0),

        gpsSignal: Number(item.gpsSignal || 0),

        eta: calculateETA(5, Number(item.speed || 0)).text,
        todayKm: busDistanceTracker[map.busId]?.totalKm?.toFixed(2) || "0",
        collegeArrivalTime: busCollegeArrival[map.busId]?.time || null,
        status: getBusStatus({
          busId: map.busId,
          lat: Number(item.latitude),
          lng: Number(item.longitude),
          speed: Number(item.speed || 0),
          lastUpdate: item.lastOnline
            ? new Date(Number(item.lastOnline) * 1000).toISOString()
            : null,
        }),

        tripActive: Number(item.speed) > 5,

        lastUpdate: item.lastOnline
          ? new Date(Number(item.lastOnline) * 1000).toISOString()
          : null,

        timestamp: Date.now(),
      };
    })
    .filter(Boolean);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

async function trackBusDistance(bus) {
  try {
    const today = new Date().toISOString().split("T")[0];

    if (!busDistanceTracker[bus.busId]) {
      busDistanceTracker[bus.busId] = {
        lastLat: bus.lat,
        lastLng: bus.lng,
        totalKm: 0,
        date: today,
      };

      return;
    }

    const tracker = busDistanceTracker[bus.busId];

    // reset new day
    if (tracker.date !== today) {
      await admin
        .firestore()
        .collection("bus_km_history")
        .doc(`${bus.busId}_${tracker.date}`)
        .set({
          busId: bus.busId,

          route: busRoutes[bus.busId] || "N/A",

          date: tracker.date,

          // ✅ ADD THIS
          monthKey: getMonthKey(),

          totalKm: Number(tracker.totalKm.toFixed(2)),

          createdAt: new Date().toISOString(),
        });

      busDistanceTracker[bus.busId] = {
        lastLat: bus.lat,
        lastLng: bus.lng,
        totalKm: 0,
        date: today,
      };

      return;
    }

    const distance = calculateDistance(
      tracker.lastLat,
      tracker.lastLng,
      bus.lat,
      bus.lng,
    );

    // ignore GPS jumps
    if (distance > 0 && distance < 2) {
      tracker.totalKm += distance;
    }

    tracker.lastLat = bus.lat;
    tracker.lastLng = bus.lng;
  } catch (e) {
    console.log("KM TRACK ERROR:", e.message);
  }
}

async function handleBus(bus, students) {
  const today = new Date().toISOString().split("T")[0];

  // reset next day
  if (
    busCollegeArrival[bus.busId] &&
    busCollegeArrival[bus.busId].date !== today
  ) {
    delete busCollegeArrival[bus.busId];
  }

  // college reached
  if (isAtCollege(bus.lat, bus.lng) && !busCollegeArrival[bus.busId]) {
    busCollegeArrival[bus.busId] = {
      time: new Date().toISOString(),
      date: today,
    };
    addActivity("arrival", `🏫 ${bus.busId} arrived at college`);
    console.log(`🏫 ${bus.busId} reached college`);
  }
  const savedStart = await redis.get(`busStart:${bus.busId}`);

  if (savedStart && !busStartTimes[bus.busId]) {
    busStartTimes[bus.busId] = savedStart;
  }
  // console.log("BUS:", bus.busId, "Speed:", bus.speed, "Trip:", bus.tripActive);
  const prev = busState[bus.busId] || {};
  if (prev.tripActive !== true && bus.tripActive === true) {
    const today = new Date().toISOString().split("T")[0];

    if (!busStartTimes[bus.busId] || busStartTimes[bus.busId].date !== today) {
      busStartTimes[bus.busId] = {
        time: new Date().toISOString(),
        date: today,
      };
      await redis.set(
        `busStart:${bus.busId}`,
        JSON.stringify(busStartTimes[bus.busId]),
      );

      // ✅ SAVE TO REDIS
    }
    const now = Date.now();
    const lastTime = lastStartNotification[bus.busId] || 0;
    addActivity("start", `🚌 ${bus.busId} started trip`);
    // 🚫 duplicate block (cooldown)
    if (now - lastTime < START_COOLDOWN_MS) {
      busState[bus.busId] = {
        ...prev,
        tripActive: bus.tripActive,
      };

      console.log("Cooldown active");
      console.log("🚌 BUS CHECK:", bus.busId, bus.lat, bus.lng);

      return; // IMPORTANT
    }

    lastStartNotification[bus.busId] = now;

    const busStudents = students.filter(
      (s) => s.busId === bus.busId && s.fcmToken,
    );
    for (const s of busStudents) {
      try {
        await admin.messaging().send({
          token: s.fcmToken,

          notification: {
            title: "🚌 Bus Started",
            body: `${bus.busId} has started`,
          },

          data: {
            type: "bus_started",
            busId: bus.busId,
          },
        });

        console.log(`🟢 Start sent to ${s.studentId}`);
      } catch (e) {
        console.log("FCM error:", e.message);
      }
    }

    busState[bus.busId] = {
      ...prev,
      tripActive: bus.tripActive,
      lastStartSent: Date.now(),
    };
  }

  const busStudents = students.filter(
    (s) => s.busId === bus.busId && s.fcmToken,
  );

  for (const student of busStudents) {
    if (!student?.fcmToken) continue;

    const loc = await getStudentLocation(student.studentId);
    if (!loc?.lat || !loc?.lng) continue;

    if (
      !Number.isFinite(bus.lat) ||
      !Number.isFinite(bus.lng) ||
      !Number.isFinite(loc.lat) ||
      !Number.isFinite(loc.lng)
    )
      continue;

    const dist = calculateDistance(bus.lat, bus.lng, loc.lat, loc.lng);

    const KEY = `${student.studentId}_${bus.busId}`;

    if (!lastSentData[KEY]) {
      lastSentData[KEY] = {
        sent5km: false,
      };
    }

    // reset after moving away
    if (!dist || !Number.isFinite(dist) || dist > 8) {
      lastSentData[KEY] = {
        sent5km: false,
      };
    }

    // send alert
    if (dist <= 5 && dist > 0.1 && !lastSentData[KEY].sent5km) {
      lastSentData[KEY].sent5km = true;

      try {
        await admin.messaging().send({
          token: student.fcmToken,

          notification: {
            title: "🚌 Bus Nearby",
            body: `${bus.busId} is only 5 KM away from you`,
          },

          data: {
            title: "🚌 Bus Nearby",
            body: `${bus.busId} is only 5 KM away from you`,
            type: "bus_nearby",
            busId: bus.busId,
            studentId: student.studentId,
          },
        });

        console.log(`✅ 5KM Notification Sent -> ${student.studentId}`);
      } catch (e) {
        console.log(`❌ FCM Error (${student.studentId}):`, e.message);
      }
    }
  }
}
let studentCache = [];
let lastStudentSync = 0;
const STUDENT_TTL = 2 * 60 * 1000;
async function getStudentsCached() {
  const now = Date.now();

  if (now - lastStudentSync < STUDENT_TTL && studentCache.length) {
    return studentCache;
  }

  const snap = await admin.firestore().collection("students").get();

  studentCache = snap.docs.map((doc) => ({
    studentId: doc.id,
    ...doc.data(),
  }));

  lastStudentSync = now;

  return studentCache;
}
/* =========================
   BROADCAST
========================= */
function broadcast(data) {
  const payload = JSON.stringify({
    type: "update",
    data,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

/* =========================
   MAIN LOOP
========================= */
let isFetching = false;

async function loop() {
  if (isFetching) return;

  isFetching = true;
  try {
    const buses = await getAllData();
    latestBuses = buses;
    const students = await getStudentsCached();

    await Promise.all(
      buses.map(async (bus) => {
        await handleBus(bus, students);

        await handleAttendance(bus, students);

        await trackBusDistance(bus);
      }),
    );

    broadcast(buses);
  } catch (e) {
    console.log(e.message);
  } finally {
    isFetching = false;
  }

  setTimeout(loop, 2000);
}

loop();
/* =========================
   WS CONNECTION
========================= */

/* =========================
   WS CONNECTION
========================= */
wss.on("connection", (ws) => {
  console.log("🟢 Client Connected");

  ws.isAlive = true;

  // heartbeat response
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // send initial buses
  if (latestBuses.length > 0) {
    ws.send(
      JSON.stringify({
        type: "init",
        data: latestBuses,
      }),
    );
  }

  ws.send(
    JSON.stringify({
      type: "connected",
    }),
  );

  // heartbeat check
  const interval = setInterval(() => {
    if (ws.isAlive === false) {
      console.log("⚠️ No pong received");

      clearInterval(interval);

      ws.close();

      return;
    }

    ws.isAlive = false;

    ws.ping();
  }, 30000);
  // cleanup
  ws.on("close", (code, reason) => {
    ws.isAlive = false;
    console.log("❌ Client Disconnected", code, reason.toString());

    clearInterval(interval);
  });

  ws.on("error", (err) => {
    console.log("WS Error:", err.message);
    clearInterval(interval);

    ws.terminate();
  });
});

app.get("/admin/attendance-history", async (req, res) => {
  try {
    const months = Number(req.query.months || 6);

    const fromDate = new Date();

    fromDate.setMonth(fromDate.getMonth() - months);

    const snap = await admin
      .firestore()
      .collection("attendance")
      .where("boardingTime", ">=", fromDate)
      .orderBy("boardingTime", "desc")
      .get();

    const data = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      success: true,
      total: data.length,
      data,
    });
  } catch (e) {
    console.log(e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/admin/attendance", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const date = req.query.date || today;

    const busId = req.query.busId;

    let query = admin.firestore().collection("attendance");

    if (date) {
      query = query.where("date", "==", date);
    }

    if (busId) {
      query = query.where("busId", "==", busId);
    }

    const snap = await query.get();

    const data = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // ======================
    // BUS WISE COUNT
    // ======================

    const busWise = {};

    data.forEach((item) => {
      if (item.present) {
        busWise[item.busId] = (busWise[item.busId] || 0) + 1;
      }
    });

    return res.json({
      success: true,
      total: data.length,
      busWise,
      data,
    });
  } catch (e) {
    console.log(e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/admin/attendance-month", async (req, res) => {
  try {
    const monthKey = req.query.monthKey || getMonthKey();

    const snap = await admin
      .firestore()
      .collection("attendance")
      .where("monthKey", "==", monthKey)
      .get();

    const data = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const grouped = {};

    data.forEach((item) => {
      if (!grouped[item.day]) {
        grouped[item.day] = [];
      }

      grouped[item.day].push(item);
    });

    return res.json({
      success: true,
      monthKey,
      grouped,
    });
  } catch (e) {
    console.log(e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/admin/bus-km-history", async (req, res) => {
  try {
    let query = admin.firestore().collection("bus_km_history");

    if (req.query.monthKey) {
      query = query.where("monthKey", "==", req.query.monthKey);
    } else {
      const days = Number(req.query.days || 7);

      query = query.orderBy("date", "desc").limit(days * 20);
    }

    const snap = await query.get();

    const data = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      success: true,
      data,
    });
  } catch (e) {
    console.log(e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/admin/date-report", async (req, res) => {
  try {
    const date = req.query.date;

    if (!date) {
      return res.status(400).json({
        error: "Date required",
      });
    }

    // attendance
    const attendanceSnap = await admin
      .firestore()
      .collection("attendance")
      .where("date", "==", date)
      .get();

    // km
    const kmSnap = await admin
      .firestore()
      .collection("bus_km_history")
      .where("date", "==", date)
      .get();

    const attendance = {};
    const kmData = {};

    attendanceSnap.forEach((doc) => {
      const d = doc.data();

      if (d.present === true) {
        attendance[d.busId] = (attendance[d.busId] || 0) + 1;
      }
    });

    kmSnap.forEach((doc) => {
      const d = doc.data();

      kmData[d.busId] = d.totalKm;
    });

    return res.json({
      success: true,
      date,
      attendance,
      kmData,
    });
  } catch (e) {
    console.log(e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/admin/dashboard", async (req, res) => {
  try {
    const userData = await getAllUsers();

    const today = new Date().toISOString().split("T")[0];

    const attendanceSnap = await admin
      .firestore()
      .collection("attendance")
      .where("date", "==", today)
      .get();

    const presentCount = attendanceSnap.docs.filter((d) => {
      const data = d.data();

      return data.present === true && data.studentType === "college";
    }).length;

    const studentsSnap = await admin.firestore().collection("students").get();

    let onboarded = 0;
    let present = 0;

    studentsSnap.forEach((doc) => {
      const d = doc.data();
      if (d.liveStatus?.onboarded) onboarded++;
      if (d.liveStatus?.present) present++;
    });
    const collegeStudents = studentsSnap.docs.filter((doc) => {
      const d = doc.data();

      return d.studentType === "college";
    });

    const totalCollegeStudents = collegeStudents.length;

    const absentToday = totalCollegeStudents - presentCount;
    const busWiseAttendance = {};

    attendanceSnap.forEach((doc) => {
      const d = doc.data();

      if (!d.busId) return;

      if (d.present === true) {
        busWiseAttendance[d.busId] = (busWiseAttendance[d.busId] || 0) + 1;
      }
    });

    const busWiseUsers = {};

    // students
    studentsSnap.forEach((doc) => {
      const d = doc.data();

      if (!d.busId) return;

      if (!busWiseUsers[d.busId]) {
        busWiseUsers[d.busId] = 0;
      }

      busWiseUsers[d.busId]++;
    });

    // faculty
    const facultySnap = await admin.firestore().collection("faculty").get();

    facultySnap.forEach((doc) => {
      const d = doc.data();

      if (!d.busId) return;

      if (!busWiseUsers[d.busId]) {
        busWiseUsers[d.busId] = 0;
      }

      busWiseUsers[d.busId]++;
    });
    return res.json({
      totalUsers: userData.totalUsers,

      totalStudents: totalCollegeStudents,

      presentToday: presentCount,

      absentToday,

      activeBuses: latestBuses.length,

      onboarded,
      presentLive: present,

      buses: latestBuses,

      // chart data
      busWiseUsers: busWiseUsers,
      busWiseAttendance,

      activities: recentActivities,
    });
  } catch (e) {
    console.log(e);
    return res.status(500).json({ error: "Dashboard error" });
  }
});

app.get("/test-students", async (req, res) => {
  try {
    const studentsData = await getStudentsCached();

    return res.json({
      count: studentsData.length,
      studentsData,
    });
  } catch (e) {
    console.log(e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.post("/admin/send-notification", async (req, res) => {
  try {
    const { busId, title, message } = req.body;

    if (!busId || !title || !message) {
      return res.status(400).json({
        error: "Missing fields",
      });
    }

    // students of selected bus
    const snap = await admin
      .firestore()
      .collection("students")
      .where("busId", "==", busId)
      .get();

    const students = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    const tokens = students.map((s) => s.fcmToken).filter(Boolean);

    if (!tokens.length) {
      return res.json({
        success: false,
        message: "No FCM tokens found",
      });
    }

    // send notification
    const response = await admin.messaging().sendEachForMulticast({
      tokens,

      notification: {
        title,
        body: message,
      },

      data: {
        type: "admin_notification",
        busId,
      },
    });

    console.log("✅ Notification sent:", response.successCount);

    return res.json({
      success: true,
      sent: response.successCount,
      failed: response.failureCount,
      message: `Notification sent to ${response.successCount} users`,
    });
  } catch (e) {
    console.log("NOTIFICATION ERROR:", e);

    return res.status(500).json({
      error: e.message,
    });
  }
});
app.delete("/admin/delete-user/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;

    const validCollections = ["student", "parent", "faculty"];

    if (!validCollections.includes(type)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user type",
      });
    }

    await admin
      .firestore()
      .collection(
        type === "student"
          ? "students"
          : type === "parent"
            ? "parents"
            : "faculty",
      )
      .doc(id)
      .delete();

    return res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (e) {
    console.log("DELETE USER ERROR:", e);
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.get("/debug/redis", async (req, res) => {
  try {
    const keys = [];
    let cursor = "0";

    do {
      const result = await redis.scan(cursor, "student:*", 100);

      cursor = result.cursor || "0";
      const foundKeys = result.keys || [];

      keys.push(...foundKeys);
    } while (cursor !== "0");

    const data = await Promise.all(keys.map((k) => redis.get(k)));

    return res.json({ keys, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
app.get("/admin/users", async (req, res) => {
  try {
    // =========================
    // FETCH ALL COLLECTIONS
    // =========================

    const [studentsSnap, parentsSnap, facultySnap] = await Promise.all([
      admin.firestore().collection("students").get(),
      admin.firestore().collection("parents").get(),
      admin.firestore().collection("faculty").get(),
    ]);

    // =========================
    // CONVERT TO ARRAY
    // =========================

    const students = studentsSnap.docs.map((doc) => ({
      id: doc.id,
      userType: "student",
      ...doc.data(),
    }));

    const parents = parentsSnap.docs.map((doc) => ({
      id: doc.id,
      userType: "parent",
      ...doc.data(),
    }));

    const faculty = facultySnap.docs.map((doc) => ({
      id: doc.id,
      userType: "faculty",
      ...doc.data(),
    }));

    // =========================
    // MERGE USERS
    // =========================

    const allUsers = [...students, ...parents, ...faculty];

    // =========================
    // ANALYTICS OBJECTS
    // =========================

    const branchWise = {};
    const yearWise = {};
    const classWise = {};
    const busWise = {};
    const facultyTypeWise = {};
    const studentTypeWise = {};

    // =========================
    // PROCESS USERS
    // =========================

    allUsers.forEach((user) => {
      // ===== BUS =====
      if (user.busId) {
        busWise[user.busId] = (busWise[user.busId] || 0) + 1;
      }

      // ===== BRANCH =====
      if (user.branch) {
        branchWise[user.branch] = (branchWise[user.branch] || 0) + 1;
      }

      // ===== YEAR =====
      if (user.year) {
        yearWise[user.year] = (yearWise[user.year] || 0) + 1;
      }

      // ===== CLASS =====
      if (user.class) {
        classWise[user.class] = (classWise[user.class] || 0) + 1;
      }

      // ===== FACULTY TYPE =====
      if (user.facultyType) {
        facultyTypeWise[user.facultyType] =
          (facultyTypeWise[user.facultyType] || 0) + 1;
      }

      // ===== STUDENT TYPE =====
      if (user.studentType) {
        studentTypeWise[user.studentType] =
          (studentTypeWise[user.studentType] || 0) + 1;
      }
    });

    // =========================
    // RESPONSE
    // =========================

    return res.json({
      // totals
      totalStudents: students.length,
      totalParents: parents.length,
      totalFaculty: faculty.length,
      totalUsers: allUsers.length,

      // analytics
      branchWise,
      yearWise,
      classWise,
      busWise,
      facultyTypeWise,
      studentTypeWise,

      // full data
      students,
      parents,
      faculty,
      allUsers,
    });
  } catch (e) {
    console.log("ADMIN USERS API ERROR:", e);

    return res.status(500).json({
      error: e.message,
    });
  }
});

app.get("/trip-status", async (req, res) => {
  try {
    const { busId } = req.query;

    if (!busId) {
      return res.status(400).json({
        success: false,
        error: "busId required",
      });
    }

    const bus = latestBuses.find((b) => b.busId === busId);

    if (!bus) {
      return res.status(404).json({
        success: false,
        error: "Bus not found",
      });
    }

    return res.json({
      success: true,
      busId,
      tripActive: bus.tripActive || false,
      status: bus.status || "Unknown",
      speed: bus.speed || 0,
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.post("/complaint", async (req, res) => {
  try {
    const { studentId, subject = "", complaint } = req.body;

    if (!studentId || !complaint) {
      return res.status(400).json({
        success: false,
        error: "Missing fields",
      });
    }

    const studentDoc = await admin
      .firestore()
      .collection("students")
      .doc(studentId)
      .get();

    if (!studentDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Student not found",
      });
    }

    const student = studentDoc.data();

    await admin
      .firestore()
      .collection("complaints")
      .add({
        // USER INFO
        userId: studentId,
        userType: student.userType || "student",

        name: student.name || "",
        email: student.email || "",
        mobile: student.mobile || "",
        gender: student.gender || "",

        // ACADEMIC
        branch: student.branch || "",
        course: student.course || "",
        year: student.year || "",
        semester: student.semester || "",
        section: student.section || "",

        // BUS
        busId: student.busId || "",
        route: student.route || "",

        // FACULTY INFO
        designation: student.designation || "",
        facultyType: student.facultyType || "",

        // COMPLAINT
        subject: subject || "",
        complaint: complaint,

        status: "pending",

        createdAt: new Date(),
      });
    return res.json({
      success: true,
      message: "Complaint submitted",
    });
  } catch (e) {
    console.log("COMPLAINT ERROR:", e);

    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

app.get("/debug/students", async (req, res) => {
  const snap = await admin.firestore().collection("students").get();

  const data = snap.docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

  res.json(data);
});
app.get("/admin/complaint", async (req, res) => {
  try {
    const snap = await admin
      .firestore()
      .collection("complaints")
      .orderBy("createdAt", "desc")
      .get();

    const complaints = snap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json({
      success: true,
      total: complaints.length,
      complaints,
    });
  } catch (e) {
    console.log("GET COMPLAINTS ERROR:", e);

    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});
app.delete("/admin/complaint/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await admin.firestore().collection("complaints").doc(id).delete();

    return res.json({
      success: true,
      message: "Complaint deleted",
    });
  } catch (e) {
    console.log("DELETE COMPLAINT ERROR:", e);

    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});
app.patch("/admin/complaint-status/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await admin.firestore().collection("complaints").doc(id).update({
      status,
    });

    return res.json({
      success: true,
      message: "Status updated",
    });
  } catch (e) {
    console.log("STATUS UPDATE ERROR:", e);

    return res.status(500).json({
      success: false,
      error: e.message,
    });
  }
});

/* =========================
   AUTO STUDENT PROMOTION
========================= */

// TESTING DATE
// Every day at 12:00 AM
// cron.schedule("* * * * *", async () => {

// REAL DATE
// Every year 1 August 12:00 AM
cron.schedule("0 0 1 8 *", async () => {
  console.log("🎓 AUTO PROMOTION STARTED");

  try {
    const studentsRef = admin.firestore().collection("students");

    const snap = await studentsRef.get();

    for (const doc of snap.docs) {
      const data = doc.data();

      // =========================
      // COLLEGE STUDENTS
      // =========================

      if (data.studentType === "college") {
        const year = Number(data.year || 0);

        // ---------- BTECH ----------
        if (data.course === "btech") {
          if (year >= 4) {
            await studentsRef.doc(doc.id).delete();

            console.log("🗑 BTECH Deleted:", data.name);
          } else {
            await studentsRef.doc(doc.id).update({
              year: String(year + 1),
            });

            console.log(`⬆ BTECH Promoted ${data.name} -> ${year + 1}`);
          }
        }

        // ---------- POLY ----------
        else if (data.course === "poly") {
          if (year >= 3) {
            await studentsRef.doc(doc.id).delete();

            console.log("🗑 POLY Deleted:", data.name);
          } else {
            await studentsRef.doc(doc.id).update({
              year: String(year + 1),
            });

            console.log(`⬆ POLY Promoted ${data.name} -> ${year + 1}`);
          }
        }
      }

      // =========================
      // SCHOOL STUDENTS
      // =========================
      else if (data.studentType === "school") {
        const currentClass = Number(data.class || 0);

        if (currentClass >= 12) {
          await studentsRef.doc(doc.id).delete();

          console.log("🗑 SCHOOL Deleted:", data.name);
        } else {
          await studentsRef.doc(doc.id).update({
            class: String(currentClass + 1),
          });

          console.log(`⬆ SCHOOL Promoted ${data.name} -> ${currentClass + 1}`);
        }
      }
    }

    console.log("✅ PROMOTION COMPLETED");
  } catch (e) {
    console.log("❌ PROMOTION ERROR:", e);
  }
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });

    return res.json({ success: true, token });
  }

  return res.status(401).json({ success: false });
});

app.delete("/debug/delete-student/:id", async (req, res) => {
  try {
    await redis.del(`student:${req.params.id}`);

    res.json({
      success: true,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
    });
  }
});

app.delete("/debug/redis-clear", async (req, res) => {
  try {
    const keys = [];
    let cursor = "0";

    do {
      const result = await redis.scan(cursor, "student:*", 100);

      cursor = result.cursor || "0";

      keys.push(...(result.keys || []));
    } while (cursor !== "0");

    if (keys.length > 0) {
      await redis.del(...keys);
    }

    return res.json({
      success: true,
      deleted: keys.length,
      keys,
    });
  } catch (e) {
    return res.status(500).json({
      error: e.message,
    });
  }
}); 1tvpP5Eozkpxs
/* =========================
   SERVER
========================= */
app.listen(3000, () => {
  console.log("🚀 API running on 3000");
});
