const axios = require("axios");
const http = require("http");
const https = require("https");
const { query } = require("./db");

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

function normalizeUrl(value) {
  let raw = String(value ?? "").trim();
  if (!raw) return null;

  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const parsed = new URL(raw);
    if (!parsed.hostname) return null;
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    // Treat a bare domain and a trailing slash as the same value.
    if (parsed.pathname === "/") parsed.pathname = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function categorize(code) {
  if (code >= 200 && code < 300) return "OK";
  if (code >= 300 && code < 400) return "Redirect";
  if (code >= 400 && code < 500) return "Client Error";
  if (code >= 500 && code < 600) return "Server Error";
  return "Unknown";
}

async function requestWebsite(url, timeout, method = "get") {
  return axios({
    method,
    url,
    timeout,
    maxRedirects: 5,
    validateStatus: () => true,
    httpAgent,
    httpsAgent,
    headers: {
      "User-Agent": process.env.MONITOR_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Referer": "https://www.google.com/",
      "Upgrade-Insecure-Requests": "1",
    },
  });
}

async function checkUrl(url) {
  const timeout = Number(process.env.REQUEST_TIMEOUT_MS || 10000);
  const started = Date.now();

  try {
    // HEAD is cheap and works for many sites that reject automated GETs.
    // If HEAD is not useful, fall back to GET.
    let response = await requestWebsite(url, Math.min(timeout, 5000), "head");
    if (response.status === 405 || response.status === 501 || response.status === 403 || response.status === 0) {
      response = await requestWebsite(url, timeout, "get");
    }

    return {
      url,
      status: categorize(response.status),
      statusCode: response.status,
      responseTimeMs: Date.now() - started,
      errorMessage: response.status === 403
        ? "Remote website rejected the monitoring request (HTTP 403). The site is reachable, but automated access is blocked."
        : null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      url,
      status: "Unreachable",
      statusCode: null,
      responseTimeMs: Date.now() - started,
      errorMessage: error.code || error.message,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function checkDomain(domainId) {
  const result = await query("SELECT id, url FROM domains WHERE id = $1", [domainId]);
  if (!result.rows.length) throw new Error("Domain not found");

  const domain = result.rows[0];
  const check = await checkUrl(domain.url);

  // Update the current status and append history in one DB round trip.
  const saved = await query(
    `WITH updated AS (
       UPDATE domains
       SET status = $1,
           status_code = $2,
           response_time_ms = $3,
           error_message = $4,
           last_checked_at = NOW(),
           updated_at = NOW()
       WHERE id = $5
       RETURNING *
     ), history AS (
       INSERT INTO status_history
         (domain_id, status, status_code, response_time_ms, error_message)
       SELECT id, status, status_code, response_time_ms, error_message
       FROM updated
       RETURNING id
     )
     SELECT * FROM updated`,
    [check.status, check.statusCode, check.responseTimeMs, check.errorMessage, domainId]
  );

  if (!saved.rows.length) throw new Error("Could not save domain check");
  return saved.rows[0];
}

async function checkDomainIds(ids) {
  return Promise.all(
    ids.map(async (id) => {
      try {
        return await checkDomain(id);
      } catch (error) {
        console.error(`Check failed for domain ${id}:`, error.message);
        return null;
      }
    })
  ).then((rows) => rows.filter(Boolean));
}

async function checkAllDomains() {
  const result = await query("SELECT id FROM domains WHERE enabled = TRUE ORDER BY id");
  return checkDomainIds(result.rows.map((row) => row.id));
}

module.exports = { normalizeUrl, checkUrl, checkDomain, checkDomainIds, checkAllDomains };
