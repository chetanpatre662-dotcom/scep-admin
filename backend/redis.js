const { createClient } = require("redis");

const client = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
});

client.on("error", (err) => console.log("❌ Redis Error:", err.message));
client.on("connect", () => console.log("🟢 Redis Connected"));

let isRedisConnecting = false;

async function connectRedis() {
  if (client.isOpen || isRedisConnecting) return;

  isRedisConnecting = true;

  await client.connect();

  isRedisConnecting = false;
}

/* SET */

async function set(key, value, options = null) {
  await connectRedis();

  const stringValue =
    typeof value === "string"
      ? value
      : JSON.stringify(value);

  if (options?.EX) {
    return client.set(key, stringValue, {
      EX: options.EX,
    });
  }

  return client.set(key, stringValue);
}

/* GET */
async function get(key) {
  await connectRedis();

  const value = await client.get(key);
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/* DELETE */
async function del(key) {
  await connectRedis();
  return client.del(key);
}

/* EXISTS */
async function exists(key) {
  await connectRedis();
  return client.exists(key);
}

async function keys(pattern) {
  await connectRedis();
  return client.keys(pattern);
}

/* SCAN FIX */
async function scan(cursor = "0", match = "*", count = 100) {
  await connectRedis();

  const result = await client.scan(cursor.toString(), {
    MATCH: match,
    COUNT: count,
  });

  // DEBUG THIS FIRST
  console.log("SCAN RAW RESULT:", result);

  // handle BOTH formats safely
  if (Array.isArray(result)) {
    const [nextCursor, keys] = result;
    return {
      cursor: nextCursor,
      keys: keys || [],
    };
  }

  return {
    cursor: result.cursor ?? "0",
    keys: result.keys ?? [],
  };
}
async function expire(key, seconds) {
  await connectRedis();
  return client.expire(key, seconds);
}
module.exports = {
  client,
  connectRedis,
  set,
  get,
  del,
  exists,
  scan,
  keys, // ❌ works but not recommended
    expire,
};