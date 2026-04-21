#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import axios from "axios";

const {
  WIKI_URL, // https://onepiece.fandom.com/api.php
  INGESTION_URL,
  SUPABASE_ANON_KEY,
  STATE_FILE = "state.json",
} = process.env;

// --- API Fetch ---
async function getLatestChapterSummary() {
  // 1. קודם נמצא מהו הצ'אפטר האחרון שפורסם
  const listUrl = `${WIKI_URL}?action=query&list=categorymembers&cmtitle=Category:Chapters&cmsort=timestamp&cmdir=desc&format=json&cmlimit=1`;
  const listRes = await axios.get(listUrl);
  const latestPage = listRes.data.query.categorymembers[0];
  
  if (!latestPage) throw new Error("Could not find latest chapter via API");
  
  const title = latestPage.title;
  console.log(`Latest chapter title found: ${title}`);

  // 2. נשלוף את התוכן של הדף הזה
  const contentUrl = `${WIKI_URL}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json`;
  const contentRes = await axios.get(contentUrl);
  const html = contentRes.data.parse.text["*"];

  // 3. ניקוי בסיסי של ה-HTML לטקסט (במקום cheerio)
  const summary = html
    .replace(/<[^>]*>/g, ' ') // הסרת תגיות HTML
    .split(/Summary|Synopsis/i)[1] // לוקח רק מה שמופיע אחרי המילה Summary
    ?.split(/Characters|Navigation/i)[0] // עוצר כשמגיע לרשימת דמויות
    ?.trim();

  if (!summary) throw new Error("Could not extract summary text from API response");

  return { title, summary: summary.substring(0, 2000) }; // מגביל אורך ל-AI
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return { lastTitle: null };
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")); } catch { return { lastTitle: null }; }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function ingest({ title, summary }) {
  await axios.post(INGESTION_URL, 
    { text: summary, title },
    { headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  console.log(`✓ Ingested: ${title}`);
}

async function main() {
  const { title, summary } = await getLatestChapterSummary();
  const state = await loadState();

  if (state.lastTitle === title) {
    console.log(`Skip: ${title} already processed.`);
    return;
  }

  await ingest({ title, summary });
  await saveState({ lastTitle: title, ingestedAt: new Date().toISOString() });
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});