// Vercel Function: Supabase Upload Relay
// Receives business data from CCR and uploads to Supabase (bypasses IP allowlist issue)
//
// Uses the service_role key (server-side only, never exposed to a browser) because
// RLS on the `businesses`/`upload_sessions` tables only grants access to the
// `authenticated` role — this relay runs as a trusted backend process and needs to
// bypass RLS, unlike the browser client which authenticates as a real user.

import { businessKey, looksLikeSameBusiness, addressKey, tidyAddress } from "../lib/businessKey.js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mcsygsqfyuaexxxwsgem.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is not set");
}

const HEADERS = {
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "apikey": SUPABASE_KEY,
  "Content-Type": "application/json",
};

// Every existing business (Supabase returns at most 1,000 rows per request).
async function getExistingBusinesses() {
  const all = [];
  for (;;) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses?select=name,address&order=id`, {
      method: "GET",
      headers: { ...HEADERS, Range: `${all.length}-${all.length + 999}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Failed to fetch existing businesses: ${res.statusText} - ${text}`);
    let rows;
    try {
      rows = JSON.parse(text);
    } catch (e) {
      throw new Error(`JSON parse error on businesses GET: ${text.substring(0, 200)}`);
    }
    all.push(...rows);
    if (rows.length < 1000) return all;
  }
}

async function createUploadSession(sessionData) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/upload_sessions`, {
    method: "POST",
    headers: { ...HEADERS, "Prefer": "return=minimal" },
    body: JSON.stringify(sessionData),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Failed to create session: ${res.statusText} - ${text}`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

async function uploadBusinessesBatch(records) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/businesses`, {
    method: "POST",
    headers: { ...HEADERS, "Prefer": "return=minimal" },
    body: JSON.stringify(records),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Batch upload failed: ${res.statusText} - ${text}`);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { session_id, file_name, businesses, upload_date, status_counts } = req.body;

    // Validate request
    if (!session_id || !businesses || !Array.isArray(businesses)) {
      return res.status(400).json({
        error: "Invalid request: session_id and businesses array required",
      });
    }

    console.log(`[${session_id}] Processing ${businesses.length} businesses from ${file_name}`);

    // Step 1: Fetch existing businesses for deduplication. Without them the
    // upload stops — adding blindly is how duplicates got in.
    let existing;
    try {
      existing = await getExistingBusinesses();
      console.log(`[${session_id}] Found ${existing.length} existing businesses`);
    } catch (err) {
      return res.status(502).json({ error: `Could not check for duplicates: ${err.message}` });
    }

    // Step 2: Filter out duplicates — same name + street + house number after
    // normalizing (", ירושלים", quotes, titles…), or a very similar name at
    // the same address. See lib/businessKey.js (same as the website).
    const keys = new Set(existing.map(b => businessKey(b.name || "", b.address || "")));
    const byAddress = new Map();
    const remember = b => {
      const k = addressKey(b.address || "");
      byAddress.set(k, [...(byAddress.get(k) || []), b]);
    };
    existing.forEach(remember);
    const newBusinesses = [];
    for (const raw of businesses) {
      const b = { ...raw, address: tidyAddress(raw.address || "") };
      const key = businessKey(b.name || "", b.address);
      const similar = (byAddress.get(addressKey(b.address)) || []).find(e => looksLikeSameBusiness(b, e));
      if (keys.has(key) || similar) {
        console.log(`[${session_id}] Skipped duplicate: ${b.name} / ${b.address}${similar ? ` ~ ${similar.name} / ${similar.address}` : ""}`);
        continue;
      }
      keys.add(key);
      remember(b);
      newBusinesses.push(b);
    }
    const duplicateCount = businesses.length - newBusinesses.length;

    console.log(`[${session_id}] New: ${newBusinesses.length}, Duplicates: ${duplicateCount}`);

    if (newBusinesses.length === 0) {
      console.log(`[${session_id}] All records are duplicates, skipping upload`);
      return res.status(200).json({
        status: "skipped",
        session_id,
        message: "All records already exist",
        uploaded: 0,
        skipped: duplicateCount,
      });
    }

    // Step 3: Create upload_sessions record
    const sessionPayload = {
      id: session_id,
      file_name,
      upload_date,
      total_count: newBusinesses.length,
      suspicious_count: status_counts?.suspicious || 0,
      ok_count: status_counts?.ok || 0,
      unknown_count: status_counts?.unknown || 0,
      skipped_count: duplicateCount,
      business_ids: [],
    };

    await createUploadSession(sessionPayload);
    console.log(`[${session_id}] Created upload session`);

    // Step 4: Upload businesses in batches
    const batchSize = 50;
    let uploadedCount = 0;
    const insertedIds = [];

    for (let i = 0; i < newBusinesses.length; i += batchSize) {
      const batch = newBusinesses.slice(i, i + batchSize);
      const batchWithSession = batch.map(b => ({
        ...b,
        upload_session_id: session_id,
      }));

      try {
        await uploadBusinessesBatch(batchWithSession);
        uploadedCount += batch.length;
        batch.forEach(b => insertedIds.push(b.id));
        console.log(`[${session_id}] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} records uploaded`);
      } catch (err) {
        console.error(`[${session_id}] Batch upload failed:`, err.message);
        return res.status(500).json({
          error: `Batch upload failed at position ${i}`,
          detail: err.message,
          uploaded: uploadedCount,
        });
      }
    }

    console.log(`[${session_id}] All batches completed. Total uploaded: ${uploadedCount}`);

    return res.status(200).json({
      status: "success",
      session_id,
      uploaded: uploadedCount,
      skipped: duplicateCount,
      file_name,
      message: `Successfully uploaded ${uploadedCount} new businesses (${duplicateCount} duplicates skipped)`,
    });

  } catch (error) {
    console.error("Relay error:", error);
    return res.status(500).json({ error: error.message });
  }
}
