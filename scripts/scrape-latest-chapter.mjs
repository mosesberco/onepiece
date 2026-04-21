#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import axios from "axios";

const {
  WIKI_URL,
  INGESTION_URL,
  SUPABASE_ANON_KEY,
  STATE_FILE = "state.json",
} = process.env;

// פונקציה לשליפת תוכן דף מה-API של פנדום
async function fetchPageContent(title) {
  console.log(`Fetching content for: ${title}`);
  const contentUrl = `${WIKI_URL}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&redirects=1`;
  
  const contentRes = await axios.get(contentUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });
  
  if (!contentRes.data.parse) throw new Error(`Could not parse page: ${title}`);
  
  const html = contentRes.data.parse.text["*"];

  // חילוץ טקסט נקי - מחפשים מה שבין Summary לבין הכותרת הבאה
  let summary = html.replace(/<[^>]*>/g, ' '); 
  const startMatch = summary.match(/Summary|Synopsis/i);
  
  if (startMatch) {
    summary = summary.substring(startMatch.index);
    const endMatch = summary.match(/Characters|Navigation|References|Trivia/i);
    if (endMatch) summary = summary.substring(0, endMatch.index);
  }

  return { 
    title, 
    summary: summary.replace(/\s\s+/g, ' ').trim().substring(0, 3000) 
  };
}

// פונקציה לשליחת הנתונים ל-Supabase
async function ingest({ title, summary }) {
  console.log(`Sending "${title}" to Supabase...`);
  const res = await axios.post(INGESTION_URL, 
    { text: summary, title },
    { 
      headers: { 
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json' 
      } 
    }
  );
  console.log(`✓ Ingested: ${title}. Status: ${res.status}`);
}

// פונקציית ה-Main במצב Backfill (פרקים 1 עד 10)
async function main() {
  const startChapter = 1;
  const endChapter = 500;
  
  console.log(`🚀 Starting Massive Backfill: Chapters ${startChapter} to ${endChapter}`);

  for (let i = startChapter; i <= endChapter; i++) {
    const title = `Chapter ${i}`;
    try {
      // בדיקה אם הפרק כבר קיים ב-State (אופציונלי, אבל חוסך כסף)
      const data = await fetchPageContent(title);
      await ingest(data);
      
      // המתנה של 1.5 שניות בין פרק לפרק - חשוב מאוד למנוע חסימה!
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      if (i % 10 === 0) {
        console.log(`--- Progress: ${i}/${endChapter} chapters completed ---`);
      }
      
    } catch (err) {
      console.error(`❌ Failed ${title}: ${err.message}`);
      // אם יש שגיאת רשת, נחכה קצת יותר לפני שממשיכים
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log("\n✅ Mission Accomplished! 500 Chapters processed.");
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});