#!/usr/bin/env node
import axios from "axios";
import neo4j from "neo4j-driver";

const {
  WIKI_URL,
  INGESTION_URL,
  SUPABASE_ANON_KEY,
  NEO4J_URI,
  NEO4J_USERNAME,
  NEO4J_PASSWORD
} = process.env;

// פונקציה לבדיקת המצב הקיים ב-Neo4j
async function getLastChapterFromNeo4j() {
  console.log("Checking last processed chapter in Neo4j...");
  const driver = neo4j.driver(
    NEO4J_URI,
    neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
  );
  const session = driver.session();

  try {
    const result = await session.run("MATCH (ch:Chapter) RETURN max(ch.number) as lastChapter");
    const lastChapter = result.records[0].get("lastChapter");
    // טיפול במקרה שהגרף ריק או מחזיר אובייקט Integer של Neo4j
    const finalNumber = lastChapter ? (typeof lastChapter === 'object' ? lastChapter.toNumber() : lastChapter) : 0;
    console.log(`Last chapter found in DB: ${finalNumber}`);
    return finalNumber;
  } catch (err) {
    console.error("Could not fetch last chapter, starting from 0:", err.message);
    return 0;
  } finally {
    await session.close();
    await driver.close();
  }
}

async function fetchPageContent(title) {
  console.log(`Fetching content for: ${title}`);
  const contentUrl = `${WIKI_URL}?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&redirects=1`;
  
  const contentRes = await axios.get(contentUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  
  if (!contentRes.data.parse) throw new Error(`Could not parse page: ${title}`);
  
  const html = contentRes.data.parse.text["*"];

  let cleanedHtml = html
    .replace(/<aside[\s\S]*?<\/aside>/g, '')
    .replace(/<div id="toc"[\s\S]*?<\/div>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

  let text = cleanedHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sections = ["Short Summary", "Long Summary", "Quick Reference", "Characters"];
  let finalContent = "";

  for (const section of sections) {
    const startIndex = text.indexOf(section);
    if (startIndex !== -1) {
      const subText = text.substring(startIndex);
      finalContent += "\n\n" + subText.substring(0, 2500); 
    }
  }

  if (finalContent.length < 500) {
    finalContent = text.substring(0, 6000);
  }

  return { title, summary: finalContent };
}

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
  return res.data;
}

async function main() {
  // בדיקה דינמית של נקודת ההתחלה
  const lastInDB = await getLastChapterFromNeo4j();
  const startChapter = lastInDB + 1;
  const endChapter = 1200; // היעד הנוכחי שלך
  
  if (startChapter > endChapter) {
    console.log("✅ All chapters up to 500 are already in the database. Nothing to do.");
    return;
  }

  console.log(`🚀 Resuming Ingestion: Chapters ${startChapter} to ${endChapter}`);

  for (let i = startChapter; i <= endChapter; i++) {
    const title = `Chapter ${i}`;
    try {
      const data = await fetchPageContent(title);
      
      if (data.summary.length > 50) {
        await ingest(data);
      } else {
        console.error(`❌ Skipped ${title}: No meaningful content found.`);
      }
      
      // המתנה של 2.5 שניות כדי לא לקבל Rate Limit מ-Claude
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      if (i % 5 === 0) {
        console.log(`--- Progress Update: ${i}/${endChapter} processed ---`);
      }
      
    } catch (err) {
      console.error(`❌ Failed ${title}: ${err.message}`);
      // אם הגענו ל-Rate Limit, כדאי לעצור את הריצה ולנסות שוב ב-Action הבא
      if (err.response?.status === 429) {
        console.error("Rate limit hit. Stopping to avoid ban.");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main().catch(err => {
  console.error("FAILED GLOBAL:", err.message);
  process.exit(1);
});