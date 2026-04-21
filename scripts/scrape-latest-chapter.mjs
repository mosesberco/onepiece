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


// פונקציה לשליחת הנתונים ל-Supabase
async function fetchPageContent(title) {
  console.log(`Fetching content for: ${title}`);
  const contentUrl = `${WIKI_URL}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&redirects=1`;
  
  const contentRes = await axios.get(contentUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  if (!contentRes.data.parse) throw new Error(`Could not parse page: ${title}`);
  
  const html = contentRes.data.parse.text["*"];

  // 1. ניקוי רעשי HTML כבדים
  let cleanedHtml = html
    .replace(/<aside[\s\S]*?<\/aside>/g, '') // הסרת ה-Infobox (הטבלה בצד)
    .replace(/<div id="toc"[\s\S]*?<\/div>/g, '') // הסרת תוכן העניינים
    .replace(/<style[\s\S]*?<\/style>/g, '') // הסרת CSS
    .replace(/<script[\s\S]*?<\/script>/g, ''); // הסרת JS

  // 2. הפיכה לטקסט נקי
  let text = cleanedHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3. חילוץ חכם: אנחנו רוצים הכל מ-"Short Summary" ועד "Trivia"
  const sections = ["Short Summary", "Long Summary", "Quick Reference", "Characters"];
  let finalContent = "";

  for (const section of sections) {
    const startIndex = text.indexOf(section);
    if (startIndex !== -1) {
      // לוקחים את הקטע מהכותרת ועד הכותרת הבאה (או עד סוף הטקסט)
      const subText = text.substring(startIndex);
      finalContent += "\n\n" + subText.substring(0, 2000); // לוקחים נתח מכל סקשן
    }
  }

  // 4. Fallback: אם משום מה לא מצאנו סקשנים, ניקח את כל הטקסט הנקי
  if (finalContent.length < 500) {
    console.log("Sections not found clearly, using full cleaned text.");
    finalContent = text.substring(0, 5000);
  }

  console.log(`Final processed text length: ${finalContent.length} characters.`);
  return { title, summary: finalContent };
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

// פונקציית ה-Main במצב Backfill (פרקים 1 עד 500)
async function main() {
  const startChapter = 1;
  const endChapter = 500;
  
  console.log(`🚀 Starting Massive Backfill: Chapters ${startChapter} to ${endChapter}`);

  for (let i = startChapter; i <= endChapter; i++) {
    const title = `Chapter ${i}`;
    try {
      const data = await fetchPageContent(title);
      
      // שולחים רק אם באמת מצאנו תוכן
      if (data.summary.length > 50) {
        await ingest(data);
      } else {
        console.error(`❌ Skipped ${title}: No meaningful content found.`);
      }
      
      // המתנה של 2 שניות בין פרק לפרק כדי להיות בטוחים שלא נחסמים
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (i % 5 === 0) {
        console.log(`--- Progress Update: ${i}/${endChapter} chapters processed ---`);
      }
      
    } catch (err) {
      console.error(`❌ Failed ${title}: ${err.message}`);
      // המתנה ארוכה יותר במקרה של שגיאה לפני ניסיון חוזר
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
  
  console.log("\n✅ Mission Accomplished! 500 Chapters processed.");
}

main().catch(err => {
  console.error("FAILED GLOBAL:", err.message);
  process.exit(1);
});