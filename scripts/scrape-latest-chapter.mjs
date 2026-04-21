#!/usr/bin/env node
// scripts/scrape-latest-chapter.mjs

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as cheerio from "cheerio";

const {
  WIKI_URL,
  INGESTION_URL,
  SUPABASE_ANON_KEY,
  TITLE_SELECTOR = "h1.page-header__title, #firstHeading, h1",
  SUMMARY_ANCHOR_ID = "Short_Summary",
  CHAPTER_LINK_SELECTOR = "",
  STATE_FILE = "state.json",
} = process.env;

for (const [k, v] of Object.entries({ WIKI_URL, INGESTION_URL, SUPABASE_ANON_KEY })) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

// ---------- Fetch (FIXED FOR 403 FORBIDDEN) --------------------------------

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      // כאן היה השינוי הקריטי - התחפשות לדפדפן כרום אמיתי
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.google.com/",
      "Cache-Control": "max-age=0"
    },
  });
  
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(`GET ${url} → 403 Forbidden. Cloudflare is blocking the bot. Use a real User-Agent.`);
    }
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// ---------- Hub → chapter URL (optional) -----------------------------------

async function resolveChapterUrl(startUrl) {
  if (!CHAPTER_LINK_SELECTOR) return startUrl;

  const html = await fetchHtml(startUrl);
  const $ = cheerio.load(html);
  const link = $(CHAPTER_LINK_SELECTOR).first();
  if (link.length === 0) {
    throw new Error(`Hub link selector "${CHAPTER_LINK_SELECTOR}" matched nothing on ${startUrl}`);
  }
  const href = link.attr("href");
  if (!href) throw new Error(`Hub link has no href`);
  return new URL(href, startUrl).toString();
}

// ---------- Extract summary ------------------------------------------------

function extractSummary(html) {
  const $ = cheerio.load(html);

  const title = $(TITLE_SELECTOR).first().text().trim();
  if (!title) throw new Error(`Title selector "${TITLE_SELECTOR}" matched nothing`);

  // Find the heading that anchors the summary.
  // CSS.escape is not standard in Node environment without a library, so we use a safe selector
  const anchor = $(`[id="${SUMMARY_ANCHOR_ID}"]`).first();
  
  if (anchor.length === 0) {
    throw new Error(`No element with id="${SUMMARY_ANCHOR_ID}" found. Check if the Wiki uses this ID.`);
  }

  const heading = anchor.closest("h1, h2, h3");
  const stopAt = /^h[1-3]$/i;

  const paragraphs = [];
  let node = heading.next();
  while (node.length > 0 && !stopAt.test(node.prop("tagName") ?? "")) {
    if (node.is("p")) {
      node.find("sup, .reference").remove();
      const text = node.text().trim();
      if (text) paragraphs.push(text);
    }
    node = node.next();
  }

  const summary = paragraphs.join("\n\n");
  if (!summary) throw new Error(`Found anchor but no <p> content before next heading`);

  return { title, summary };
}

// ---------- State ----------------------------------------------------------

async function loadState() {
  if (!existsSync(STATE_FILE)) return { lastTitle: null };
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { lastTitle: null };
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

// ---------- Ingest ---------------------------------------------------------

async function ingest({ title, summary, sourceUrl }) {
  const res = await fetch(INGESTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ text: summary, title, source_url: sourceUrl }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Ingestion POST → ${res.status}: ${body}`);
  }
  console.log(`✓ Ingested "${title}"`);
}

// ---------- Main -----------------------------------------------------------

async function main() {
  const chapterUrl = await resolveChapterUrl(WIKI_URL);
  console.log(`Scraping: ${chapterUrl}`);

  const html = await fetchHtml(chapterUrl);
  const { title, summary } = extractSummary(html);

  const state = await loadState();
  if (state.lastTitle === title) {
    console.log(`Skip: "${title}" already ingested`);
    return;
  }

  console.log(`New chapter found: "${title}"`);
  await ingest({ title, summary, sourceUrl: chapterUrl });

  await saveState({
    lastTitle: title,
    lastUrl: chapterUrl,
    ingestedAt: new Date().toISOString(),
  });
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});