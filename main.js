require("dotenv").config();
const fs = require("fs").promises;
const { Client } = require("pg");

// Database configuration
const client = new Client({ connectionString: process.env.DATABASE_URL });

// لیست فایل‌های ورودی
const INPUT_FILES = [
  process.env.FILE_PATH_1,
  process.env.FILE_PATH_2,
  process.env.FILE_PATH_3,
  process.env.FILE_PATH_4,
  process.env.FILE_PATH_5,
  process.env.FILE_PATH_6,
].filter(Boolean);

// Set برای نگهداری عناوین یونیک
const uniqueGames = new Set();

async function createTables() {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        original_title TEXT NOT NULL,
        clean_title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(clean_title)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY,
        content TEXT NOT NULL,
        region TEXT,
        price_ps4 INTEGER,
        price_ps5 INTEGER,
        source_file TEXT,  -- ستون جدید
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS games_posts (
        game_id INTEGER REFERENCES games(id),
        post_id INTEGER REFERENCES posts(id),
        PRIMARY KEY (game_id, post_id)
      )
    `);

    console.log("Tables created successfully");
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  }
}

const editions = [
  "Cross-Gen",
  "Standard Edition",
  "Gold Edition",
  "Legendary Edition",
  "Complete Edition",
  "Game of the Year Edition",
  "Digital Deluxe Edition",
  "Deluxe Party Edition",
  "Deluxe Edition",
  "PS4 Edition",
  "Bundle",
  "Pack",
  "Vault",
  "Cross-gen",
  "Crossgen",
  "Launch",
  "Full game",
  "Enhanced",
  "Special",
  "Legacy",
  "Next Level",
  "Champions",
  "Director's Cut",
  "Collection",
  "Trilogy"
].map((edition) => new RegExp(`\\s*[-–]?\\s*${edition}`, "g"));

function shouldSkipLine(line) {
  const skipPatterns = [
    /^سلام/,
    /^مجموعه/,
    /^ممنون/,
    /^https/,
    /^پلاس/,
    /^همراه/,
    /^📥/,
    /^سوپر/,
    /^\=/,
    /^\s*$/,
    /^PS4/,
    /^PS5/,
    /^PS Plus/i,
    /^Region/i,
    /demo$/i,
    /trial$/i,
    /^🌐/,
    /^💰/,
    /^🔥/,
    /^❗️/,
    /^@/,
    /^====/,
    /^id/,
    /^number of post/i,
    /EA Play game/i,
    /Some Games On EA Play/i,
    /All Games On Plus/i,
    /Plus Premium Game/i,
    /Some Games On Plus/i,
    /پلاس 1 ساله تمدید خودکار/i,
    /همراه با بازی شانسی/i,
    /—\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-—/,
    /\+Plus/,
    /➖➖➖➖➖➖➖➖➖/,
    /^♻️/,
    /^💬/,
    /^✅/,
    /^Mondana/,
    /^GNHdhhg/,
    /^اکانت/,
    /^————————————/,
    /^🤞🏻/,
    /^🟢/,
    /^دوستانی/,
    /^R1/,
    /^🎲/,
    /^1\)/,
    /^2\)/,
    /^3\)/,
    /^4\)/,
    /^5\)/,
    /^↼↼↼↼↼↼↼↼↼↼↼↼↼↼↼↼/,
    /^↼↼↼↼↼↼↼↼↼↼↼↼↼↼↼/,
    /^💸/,
    /^🔻/,
    /90% Games On Plus/i,
    /PROTOTYPE/i,
    /ToPS4Account/i,
    /PS4 Buy Account/i,
    /PS5Account/i,
    /Acc021/i,
    /Log Seller/i,
    /GameShare/i,
    /Days to Die/i,
    /Acc/i,
    /Account/i,
    /—\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-—/,
    /\*/,
    /\-\=\-\=\-\=\-\=\-\=\-\=\-\=\-\=/,
    /\=\-\=\-\=\-\=\-\=\-\=\-\=\-\=\-\=/,
    /—\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-—/,
    /—————————/,
  ];

  return skipPatterns.some((pattern) => pattern.test(line));
}

function cleanGameTitle(title) {
  if (shouldSkipLine(title)) {
    return null;
  }

  let cleanTitle = title
    // حذف کاراکترهای اضافی و یکسان‌سازی فاصله‌ها
    .replace(/\s+/g, ' ')
    .trim()
    .replace(
      /^-=\-=\-=\-=\-=\-=\-=\-=\-$|^=\-=\-=\-=\-=\-=\-=\-=$|^—\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-—$|^—————————$/,
      "$1"
    )
    // یکسان‌سازی نام‌های خاص
    .replace(/FIFA\s*(\d{2})/i, 'FIFA $1')
    .replace(/Battlefield\s*/i, 'Battlefield ')
    .replace(/BATMAN/i, 'Batman')
    .replace(/ACE\s*COMBAT\s*7/i, 'ACE COMBAT 7')
    .replace(/Assassin['']s\s*Creed/i, "Assassin's Creed")
    .replace(/DRAGON\s*BALL/i, 'Dragon Ball')
    // حذف پسوندهای اضافی
    .replace(/\s*(Bundle|Pack|Vault|Cross-?gen|Launch|Full game|Enhanced|Special)(?:\s|$)/gi, '')
    .replace(/\s*(?:Game of the Year|Champions|Director's Cut)(?:\s+Edition)?/gi, '')
    .replace(/\s*\[.*?\]/g, '')
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*\[\d+\]$/, "")
    .replace(/^(.*?)\s+per\s+PS\d+\s+e\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+for\s+PS\d+\s+and\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+–\s+PS\d+\s+and\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+—\s+PS\d+\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+–\s+PS\d+\s+og\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+–\s+PS\d+\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+pour\s+PS\d+\s+et\s+PS\d+$/, "$1")
    .replace(/Part/gi, "part")
    .replace(/Parte/gi, "part")
    .replace(/parte/gi, "part")
    .replace(/\bOf\b/, "of")
    .replace(/^(.*?):\s*(.*)$/, "$1 $2")
    .replace(/^(.*?)\s*: Remastered$/, "$1")
    .replace(/^(.*?)\s*–\s*The\s+Definitive$/, "$1")
    .replace(/^(.*?)\s*–\s*Legend\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Standard\s+Eition$/, "$1")
    .replace(/^(.*?)\s*–\s*Standard\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Enhanced\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Console\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Ultimate\s+Bundle$/, "$1")
    .replace(/^(.*?)\s*–\s*Edition\s+Bundle$/, "$1")
    .replace(/^(.*?)\s*–\s*Seventy\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Deluxe\s+Launch\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Game\s+of\s+the\s+Year$/, "$1")
    .replace(/^(.*?)\s*–\s*Game\s+of\s+the\s+Year\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*MVP\s+Edition$/, "$1")
    .replace(/\|/, "")
    .replace(/\s+Stand Alone$/, "")
    .replace(/\s*\(Standalone\)$/, "")
    .replace(/\s*Remake\s*/, " ")
    .replace(/\s*\[15559\]\s*/, " ")
    .replace(/\s*Console\s*/, " ")
    .replace(/\s*PlayStation4\s*/, " ")
    .replace(/\s*PlayStation4\s*/, " ")
    .replace(/\s*Remastered\s*/, " ")
    .replace(/\s*Digital\s*/, " ")
    .replace(/\s*Ultimate\s*/, " ")
    .replace(/\s*Ultimate pour\s*/, " ")
    .replace(/\s*Ultimate pour\s*/, " ")
    .replace(/\s*Legend Edition\s*/, " ")
    .replace(/\s*SEASON UPDATE\s*/, " ")
    .replace(/\s*Standardowa\s*/, " ")
    .replace(/\s*per\s*/, " ")
    .replace(/\s*Definitive\s*/, " ")
    .replace(/\s*Premium\s*/, " ")
    .replace(/\s*Premium\s*/, " ")
    .replace(/\s*Deluxe\s*/, " ")
    .replace(/\s*Standart\s*/, " ")
    .replace(/\s*Standard pour\s*/, " ")
    .replace(/\s*Standart\s*/, " ")
    .replace(/\s*Edycja\s*/, " ")
    .replace(/\s*Sürüm\s*/, " ")
    .replace(/\s*Edicimn\s*/, " ")
    .replace(/\s*Estandar\s*/, " ")
    .replace(/\s*Standard\s*/, " ")
    .replace(/\s*Edition\s*/, " ")
    .replace(/\s*para\s*/, " ")
    .replace(/\s*Standard\s*/, " ")
    .replace(/\s*Gold\s*/, " ")
    .replace(/\s*Legendary\s*/, " ")
    .replace(/\s*Complete\s*/, " ")
    .replace(/^(.*?)\s*–\s*The Definitive Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*The Definitive$/, "$1")
    // حذف نسخه‌های خاص
    .replace(/\s+-\s+(?:Trilogy|Collection)$/i, '')
    .replace(/\s+(?:Legacy|Next Level)$/i, '')
    .replace(/[™®]/g, "")
    .replace(/\s*\[R[1-3]\]/g, "")
    .replace(/\s*\\\[R[1-3]\\\]/g, "")
    .replace(/^(.*?)\s*\(PS\d+™?[^)]*\)$/, "$1")
    .replace(/^(.*?)(\s+PS\d+.*)?$/, "$1")
    .replace(/\s*>>>\s*PS[45]/gi, "")
    .replace(/\s*\\>\\>\\>/gi, "")
    .replace(/\s*\\>\\>/gi, "")
    .replace(/\s*>>/gi, "")
    .replace(/\s*>>>/gi, "")
    .replace(/\s*PS4‎?\s*(?:[&ey]|et|og)\s*PS5™?/gi, "")
    .replace(/\s*PS[45]™?\b/g, "")
    .replace(/^(.*?)\s*:\s*Premium Edition$/, "$1")
    .replace(/^(.*?)(\s*–\s*The Definitive Edition\s*>>>.*)?$/, "$1")
    .replace(/^(.*?)\s*:\s*Edition\s+Premium$/, "$1")
    .replace(/:\s*Game of the Year(?:\s+Edition)?/gi, "")
    .replace(/\s*(?:Digital\s+)?(?:Deluxe\s+)?Edition(?:\s+PS[45])?/gi, "")
    .replace(/\s*Version\s*PS[45]/gi, "")
    .replace(/\s*for PS4™?/gi, "")
    .replace(/®:\s*/g, ": ")
    .replace(/LEGO®/g, "LEGO")
    .replace(/^\\/g, "")
    .replace(/\s*vs\.\s*/g, " vs ")
    .replace(/\\/g, "")
    .replace(/\>>>/g, "")
    .replace(/^(.*?)\s+Version:/, "$1")
    .replace(/^(.*?)\s*\(PlayStation\d+\)$/, "$1")
    .replace(/\s+/g, " ")
    .replace(/^-=-=-=-=-=-=-=-=$|^=-=-=-=-=-=-=-=-=$|^—-----------------—$/, "")
    .replace(/\s*PlayStation4\s*/, " ")
    .replace(/\s*PlayStation5\s*/, " "
      // یکسان‌سازی نهایی
      .replace(/\s+/g, ' ')
      .trim()
    );

  editions.forEach((editionPattern) => {
    cleanTitle = cleanTitle.replace(editionPattern, "");
  });

  cleanTitle = cleanTitle.replace(/\s*\\?-\s*(?=\s|$)/g, "").trim();

  return cleanTitle;
}

async function processPost(content) {
  try {
    const idMatch = content.match(/id:\s*(\d+)/);
    if (!idMatch) return;
    const postId = parseInt(idMatch[1]);

    // حذف خط حاوی ID از محتوا
    const cleanContent = content.replace(/id:\s*\d+\s*\n/, '').trim();

    const gamesSection = cleanContent.split("=-=-=-=-=-=-=-=-=")[0];
    const gameLines = gamesSection
      .split("\n")
      .filter((line) => line.trim() && !line.includes("id:"));

    const regionMatch = content.match(/🌐Region\s*(\d+)/);
    const pricePS4Match = content.match(/💰Price PS4\s*:\s*(\d+)/);
    const pricePS5Match = content.match(/💰Price PS5\s*:\s*(\d+)/);

    await client.query(
      `INSERT INTO posts (id, content, region, price_ps4, price_ps5) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (id) DO UPDATE SET 
       content = $2, region = $3, price_ps4 = $4, price_ps5 = $5`,
      [
        postId,
        cleanContent, // استفاده از محتوای تمیز شده
        regionMatch ? regionMatch[1] : null,
        pricePS4Match ? parseInt(pricePS4Match[1]) : null,
        pricePS5Match ? parseInt(pricePS5Match[1]) : null,
      ]
    );

    // بقیه کد بدون تغییر...
  } catch (error) {
    console.error(`Error processing post:`, error);
    throw error;
  }
}

async function loadExistingGames() {
  try {
    const result = await client.query("SELECT clean_title FROM games");
    result.rows.forEach((row) => uniqueGames.add(row.clean_title));
    console.log(`Loaded ${uniqueGames.size} existing games from database`);
  } catch (error) {
    console.error("Error loading existing games:", error);
    throw error;
  }
}

async function processPost(content, sourceFile) {
  try {
    const idMatch = content.match(/id:\s*(\d+)/);
    if (!idMatch) return;
    const postId = parseInt(idMatch[1]);

    // حذف خط حاوی ID از محتوا
    const cleanContent = content.replace(/id:\s*\d+\s*\n/, '').trim();

    const gamesSection = cleanContent.split("=-=-=-=-=-=-=-=-=")[0];
    const gameLines = gamesSection
      .split("\n")
      .filter((line) => line.trim() && !line.includes("id:"));

    const regionMatch = content.match(/🌐Region\s*(\d+)/);
    const pricePS4Match = content.match(/💰Price PS4\s*:\s*(\d+)/);
    const pricePS5Match = content.match(/💰Price PS5\s*:\s*(\d+)/);

    await client.query(
      `INSERT INTO posts (id, content, region, price_ps4, price_ps5, source_file) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (id) DO UPDATE SET 
       content = $2, region = $3, price_ps4 = $4, price_ps5 = $5, source_file = $6`,
      [
        postId,
        cleanContent,
        regionMatch ? regionMatch[1] : null,
        pricePS4Match ? parseInt(pricePS4Match[1]) : null,
        pricePS5Match ? parseInt(pricePS5Match[1]) : null,
        sourceFile  // اضافه کردن نام فایل
      ]
    );

    for (const gameTitle of gameLines) {
      const cleanTitle = cleanGameTitle(gameTitle.trim());
      if (!cleanTitle) continue;

      const gameResult = await client.query(
        `INSERT INTO games (original_title, clean_title) 
         VALUES ($1, $2) 
         ON CONFLICT (clean_title) DO UPDATE SET clean_title = $2 
         RETURNING id`,
        [gameTitle.trim(), cleanTitle]
      );
      const gameId = gameResult.rows[0].id;

      await client.query(
        `INSERT INTO games_posts (game_id, post_id) 
         VALUES ($1, $2) 
         ON CONFLICT DO NOTHING`,
        [gameId, postId]
      );
    }

    console.log(`Processed post ID: ${postId} from file: ${sourceFile}`);
  } catch (error) {
    console.error(`Error processing post:`, error);
    throw error;
  }
}

async function processFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const posts = content
      .split("======================================\n")
      .filter((post) => post.trim());

    // استخراج نام فایل از مسیر کامل
    const fileName = filePath.split("/").pop();

    for (const post of posts) {
      await processPost(post.trim(), fileName);
    }

    console.log(`File ${filePath} processed successfully`);
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    throw error;
  }
}

async function main() {
  try {
    await client.connect();
    console.log("Connected to database");

    await createTables();
    await loadExistingGames();

    for (const filePath of INPUT_FILES) {
      console.log(`\nProcessing file: ${filePath}`);
      await processFile(filePath);
    }

    console.log("\nFinal statistics:");
    console.log(`Total unique games in database: ${uniqueGames.size}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    try {
      await client.end();
      console.log("Database connection closed");
    } catch (error) {
      console.error("Error closing database connection:", error);
    }
  }
}

main();
