#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as cheerio from "cheerio";
import axios from "axios";

const {
  WIKI_URL,
  INGESTION_URL,
  SUPABASE_ANON_KEY,
  TITLE_SELECTOR = "h1.page-header__title, #firstHeading, h1",
  SUMMARY_ANCHOR_ID = "Short_Summary",
  CHAPTER_LINK_SELECTOR = "",
  STATE_FILE = "state.json",
} = process.env;

// בדיקת משתני סביבה
for (const [k, v] of Object.entries({ WIKI_URL, INGESTION_URL, SUPABASE_ANON_KEY })) {
  if (!v) {
    console.error(`Missing env var: ${k}`);
    process.exit(1);
  }
}

// ---------- Fetch עם מעקף Cloudflare ---------------------------------------

async function fetchHtml(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`GET ${url} → ${error.response.status}. Cloudflare is blocking. Status: ${error.response.statusText}`);
    }
    throw error;
  }
}

// ---------- Hub → chapter URL -----------------------------------

async function resolveChapterUrl(startUrl) {
  if (!CHAPTER_LINK_SELECTOR) return startUrl;
  const html = await fetchHtml(startUrl);
  const $ = cheerio.load(html);
  const link = $(CHAPTER_LINK_SELECTOR).first();
  const href = link.attr("href");
  if (!href) throw new Error(`Hub link has no href`);
  return new URL(href, startUrl).toString();
}

// ---------- Extract summary ------------------------------------------------

function extractSummary(html) {
  const $ = cheerio.load(html);
  const title = $(TITLE_SELECTOR).first().text().trim();
  if (!title) throw new Error(`Title selector matched nothing`);

  const anchor = $(`[id="${SUMMARY_ANCHOR_ID}"]`).first();
  if (anchor.length === 0) {
    throw new Error(`No element with id="${SUMMARY_ANCHOR_ID}" found`);
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
  if (!summary) throw new Error(`No summary content found`);

  return { title, summary };
}

// ---------- State & Ingest --------------------------------------------------

async function loadState() {
  if (!existsSync(STATE_FILE)) return { lastTitle: null };
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")); } 
  catch { return { lastTitle: null }; }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function ingest({ title, summary, sourceUrl }) {
  const res = await axios.post(INGESTION_URL, 
    { text: summary, title, source_url: sourceUrl },
    { headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    }
  );
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
    console.log(`Skip: "${title}" already exists`);
    return;
  }

  console.log(`New content: "${title}"`);
  await ingest({ title, summary, sourceUrl: chapterUrl });
  await saveState({ lastTitle: title, ingestedAt: new Date().toISOString() });
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});