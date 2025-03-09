require("dotenv").config();
const fs = require("fs").promises;
const { Client: PgClient } = require("pg");
const sqlite3 = require("sqlite3").verbose();
const levenshtein = require("fast-levenshtein");

// تنظیمات اتصال به PostgreSQL
const pgClient = new PgClient({
  connectionString: process.env.DATABASE_URL,
});

// تنظیمات اتصال به SQLite
const sqlitePath = process.env.SQLITE_DB_PATH || "./database.db";
const sqliteClient = new sqlite3.Database(sqlitePath);

// تنظیمات تطابق فازی
const SIMILARITY_THRESHOLD = 0.99;
const MAX_EDIT_DISTANCE = 5;
const uniqueGames = new Set();

// ایجاد جداول در PostgreSQL
async function createTables() {
  try {
    await pgClient.query(`
      -- جدول کانال‌ها
      CREATE TABLE IF NOT EXISTS channels (
        id BIGINT PRIMARY KEY,  -- تغییر از INTEGER به BIGINT
        name VARCHAR NOT NULL
      );
      
      -- جدول بازی‌ها
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        original_title TEXT NOT NULL,
        clean_title TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(clean_title)
      );

      CREATE EXTENSION IF NOT EXISTS pg_trgm;
      CREATE INDEX IF NOT EXISTS games_clean_title_trgm_idx ON games USING GIN (clean_title gin_trgm_ops);
      
      -- جدول پست‌ها با فیلدهای اضافی
      CREATE TABLE IF NOT EXISTS posts (
        id BIGINT PRIMARY KEY,  -- تغییر از INTEGER به BIGINT
        number INTEGER,
        content TEXT NOT NULL,
        channel_id BIGINT REFERENCES channels(id),  -- تغییر از INTEGER به BIGINT
        region TEXT,
        price_ps4 INTEGER,
        price_ps5 INTEGER,
        is_ps4_sold BOOLEAN DEFAULT FALSE,
        is_ps5_sold BOOLEAN DEFAULT FALSE,
        source_file TEXT,
        last_sent FLOAT,
        message_id TEXT,
        file_id TEXT,
        parent_id TEXT,
        original_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- جدول ارتباط بازی‌ها و پست‌ها
      CREATE TABLE IF NOT EXISTS games_posts (
        game_id INTEGER REFERENCES games(id),
        post_id BIGINT REFERENCES posts(id),  -- تغییر از INTEGER به BIGINT
        PRIMARY KEY (game_id, post_id)
      );
    `);
    console.log("PostgreSQL tables created/verified");
  } catch (error) {
    console.error("Error creating tables:", error);
    throw error;
  }
}

function shouldSkipLine(line) {
  const normalizedLine = line
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const skipPatterns = [
    /^[\d\W]+$/, // خطوط فقط شامل اعداد یا علائم
    /\b(?:demo|trial|beta|early access|account|dlc|season pass)\b/i,
    /.{0,5}(http|www|\.com|\.ir|id:|number of post)/i,
    /^\s*$/,
    /^(سلام|ممنون|مجموعه|پلاس|همراه|اکانت)/,
    /[=*]{4,}/,
    /^[📥💰🔥❗️♻️✅🟢🎲🔻]/,
    /\(some games on ea play\)/i,
    /\d+\.\d+\.\d{4}/, // Matches dates like 12.4.2025
    /ps[45]:\s*\d+\s*t\s*\(btc,usdt\)/i,
    /\d+\)\s*(ps gameShare|log seller's|castore|playstation kingdom|ps-station market)/i,
    /\d+xtreme ps4 & ps5/i,
    /7 days to die/i,
    /Log Seller/i,
    /Acc 33521/i,
    /Some Games On EA Play/i,
    /R1 🇺🇸 USA/i,
    /PS Plus/i,
    /\+\s*Plus/i,
    /🤞🏻 Online + Offline/i,
    /🤞🏻\s*Online\s*\+\s*Offline/i, // Ignore "🤞🏻 Online + Offline"
    /\*?بازی\s*درخواستی/i, // Ignore "*بازی درخواستی"
    /Middle-earth\s*Shadow/i, // Ignore "Middle-earth Shadow"
    /100 Hits/i,
    /100x/i,
    /200 Hits/i,
    /50 Hits/i,
    /200x/i,
    /300x/i,
    /500x/i,
    /4\)/i,
    /Acc021/i,
    /PS GameShare/i,
    /CAStore/i,
    /PlayStation Kingdom/i,
    /PS-Station Market/i,
    /آفر/i,
    /بی نظیر/i,
    /افر/i,
    /ویژه/i,
  ];

  return skipPatterns.some((pattern) => pattern.test(normalizedLine));
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
  "Director's Cut",
  "The Collection",
  "THE COLLECTION",
  "The Complete Edition",
  "The Complete Editio",
  "Trilogy",
].map((edition) => new RegExp(`\\s*[-–]?\\s*${edition}`, "g"));

function cleanGameTitle(title) {
  if (shouldSkipLine(title)) {
    return null;
  }

  // Initial normalization
  let cleanTitle = title
    .replace(/\s+/g, " ") // Normalize spaces
    .trim();

  // Standardize common game titles
  const titleMappings = {
    "ACE COMBAT\\s*7\\s*SKIES\\s*UNKNOWN": "ACE COMBAT 7 SKIES UNKNOWN",
    "ARK\\s*Survival\\s*Evolved(?:\\s*Explorer's)?": "ARK Survival Evolved",
    "Assassin's\\s*Creed\\s*Chronicles(?:\\s*[-–]\\s*Trilogy)?":
      "Assassin's Creed Chronicles",
    "Assassin’s\\s*CreedIV\\s*Black\\s*Flag": "Assassin’s Creed IV Black Flag",
    "Assassin's\\s*Creed\\s*(?:IV|4)\\s*Black\\s*Flag":
      "Assassin's Creed IV Black Flag",
    "Batman(?:\\s*[:\\s])?\\s*Arkham\\s*Knight(?:\\s*\\d*)?":
      "Batman Arkham Knight",
    "Batman(?:\\s*[:\\s])?\\s*Arkham\\s*VR": "Batman Arkham VR",
    "Batman(?:\\s*[:\\s])?\\s*Return\\s*to\\s*Arkham(?:\\s*Arkham\\s*(?:Asylum|City))?":
      "Batman Return to Arkham",
    "Battlefield\\s*(?:4|IV)(?:\\s*full\\s*game)?": "Battlefield 4",
    "Battlefield\\s*V": "Battlefield V",
    "Beyond(?:\\s*[:\\s])?\\s*Two\\s*Souls": "Beyond Two Souls",
    "Bloodborne(?:\\s*(?:Game of the Year|The Old Hunters))?": "Bloodborne",
    "Call\\s*of\\s*Duty(?:\\s*[:\\s])?\\s*Black\\s*Ops\\s*(?:III|3)(?:\\s*Zombies\\s*Chronicles)?":
      "Call of Duty Black Ops III",
    "Crash\\s*Bandicoot\\s*4(?:\\s*[:\\s])?\\s*It's\\s*About\\s*Time":
      "Crash Bandicoot 4",
    "Crash\\s*Team\\s*Racing\\s*Nitro-Fueled(?:\\s*Nitros\\s*Oxide)?":
      "Crash Team Racing Nitro-Fueled",
    "Crysis\\s*(?:2|3|II|III)?(?:\\s*Remastered)?": "Crysis",
    "Batman\\s*ARKHAM": "Batman Arkham",
    "DAYS\\s*GONE": "Days Gone",
    "DIRT\\s*5": "DIRT5",
    "Dragon\\s*Ball\\s*XENOVERSE": "Dragon Ball Xenoverse",
    "ELDEN\\s*RING": "Elden Ring",
    "LEGO\\s*CITY\\s*UNDERCOVER": "LEGO CITY Undercover",
    "FIFA\\s*21\\s*Champions": "FIFA 21",
    "FOR\\s*HONOR": "For Honor",
    "Ghost\\s*of\\s*Tsushima\\s*Legends": "Ghost of Tsushima",
    "Goat\\s*Simulator\\s*GOATY": "Goat Simulator",
    "eFootball\\s*PES\\s*2021\\s*SEASON\\s*UPDATE": "PES 2021",
    "EA\\s*SPORTS\\s*FIFA\\s*17": "FIFA 17",
    "EA\\s*SPORTS\\s*FIFA\\s*23": "FIFA 23",
    "EA\\s*SPORTS\\s*FIFA\\s*20": "FIFA 20",
    "EA\\s*SPORTS\\s*FIFA\\s*16": "FIFA 16",
    "Call\\s*of\\s*Duty\\s*Modern\\s*Warfare\\s*(?:III|3)":
      "Call of Duty Modern Warfare III",
    "Call\\s*of\\s*Duty\\s*Modern\\s*Warfare\\s*(?:II|2)":
      "Call of Duty Modern Warfare II",
    "Call\\s*of\\s*Duty\\s*Modern\\s*Warfare": "Call of Duty Modern Warfare",
    "Assassin’s\\s*Creed\\s*Odyssey\\s*GOLD": "Assassin's Creed Odyssey",
    "Assassin’s\\s*Creed\\s*Mirage\\s*Master\\s*Assassin":
      "Assassin's Creed Mirage",
    "Call\\s*of\\s*Duty\\s*Vanguard-bundel": "Call of Duty Vanguard",
    "Crash\\s*Bandicoot\\s*4\\s*It’s\\s*About\\s*Time": "Crash Bandicoot 4",
    "DARK\\s*SOULS\\s*Ⅲ\\s*FIRE\\s*FADES": "DARK SOULS III",
    "Demon\\s*Slayer\\s*-Kimetsu\\s*no\\s*Yaiba\\s*Hinokami\\s*Chronicles":
      "Demon Slayer Kimetsu no Yaiba",
    "Devil\\s*May\\s*Cry\\s*5\\s*\\+\\s*Vergil": "Devil May Cry 5",
    "DiRT\\s*Rally\\s*2.0\\s*Germany": "DiRT Rally 2.0",
    "EA\\s*SPORTS\\s*FC\\s*24\\s*and": "EA Sports FC 24",
    "EA\\s*SPORTS\\s*FIFA\\s*18\\s*&\\s*NBA\\s*LIVE\\s*18": "FIFA 18",
    "eFootball\\s*Pro\\s*Evolution\\s*Soccer\\s*2020": "eFootball PES 2020",
    "Exps\\s*A\\s*MudRunner\\s*Game\\s*Year\\s*1": "Exps A MudRunner Game",
    "Fallout\\s*4(?:\\s*G\\.O\\.T\\.Y\\.)?": "Fallout 4",
    "Far\\s*Cry\\s*3": "Far Cry 3",
    "FAR\\s*CRY\\s*6\\s*–?": "FAR CRY 6",
    "Hogwarts(?:\\s*Version)?": "Hogwarts",
    "KINGDOM\\s*HEARTS\\s*III|KINGDOM\\s*HEARTS\\s*Ⅲ": "KINGDOM HEARTS III",
    "God\\s*of\\s*War\\s*III": "God of War III Remastered",
    "GOD\\s*OF\\s*WARIII": "God of War III Remastered",
    // "The\\s*Last\\s*of\\s*Us\\s*:\\s*Left\\s*Behind\\s*(?:\\(Standalone\\))?":
    //   "The Last of Us",
    "The\\s*Last\\s*of\\s*Us\\s*Parte\\s*II": "The Last of Us Part II",
    "The\\s*Last\\s*of\\s*Us\\s*Parte\\s*I": "The Last of Us Part I",

    "LEGO\\s*DC\\s*Super-Vilões": "LEGO DC Super-Villains",
    "LEGO\\s*MARVEL's\\s*Avengers": "LEGO Marvel",
    "LEGO\\s*Marvel’s\\s*Avengers": "LEGO Marvel",
    "LEGO\\s*NINJAGO\\s*Movie\\s*Video\\s*Game": "LEGO NINJAGO Movie",
    "Metal\\s*Gear\\s*Solid\\s*V\\s*Experience":
      "LMETAL GEAR SOLID V DEFINITIVE EXPERIENCE",
    // "Mortal\\s*Mortal\\s*11\\+\\s*Add-On": "Mortal Kombat 11",
    // "Mortal\\s*Mortal\\s*11\\+\\s*Add-On": "Mortal Kombat 11",
    // "Mortal\\s*Mortal\\s*11\\+\\s*Aftermath\\+\\s*Kombat-2": "Mortal Kombat 11",
    // "Mortal\\s*Mortal\\s*11\\+\\s*Injustice 2 Leg": "Mortal Kombat 11",
    "Mortal\\s*Kombat\\s*11(?:\\s*\\+\\s*(?:Add-On|Aftermath|Kombat-2|Injustice\\s*2\\s*Leg\\.))?":
      "Mortal Kombat 11",
    "NieR\\s*Automata\\s*Game\\s*of\\s*the\\s*YoRHa": "NieR Automata",
    Prototype2: "Prototype 2",
    "SnowRunner\\s*1-Year": "SnowRunner",
    "SOULCALIBUR\\s*Ⅵ": "SOULCALIBUR VI",
    "SpongeBob\\s*SquarePants\\s*Battle\\s*For\\s*Bikini\\s*Bottom\\s*Rehydrated":
      "SpongeBob SquarePants",
    "SpongeBob\\s*SquarePants\\s*Battle\\s*For\\s*Bikini\\s*Bottom":
      "SpongeBob SquarePants",
    "STEEP\\s*GOLD": "STEEP",
    "TOM\\s*CLANCY'S\\s*DIVISION": "Tom Clancy’s Division",
    "Tom\\s*Clancy's\\s*Rainbow\\s*Six(?:\\s*Siege)?":
      "Tom Clancy's Rainbow Six",
    "Uncharted\\s*4\\s*A\\s*Thief['’]s\\s*End": "Uncharted 4 A Thief's End",
    "Watch\\s*Dogs\\s*2": "Watch Dogs 2",
    WATCH_DOGS: "Watch Dogs",
    "WWE\\s*2K24(?:\\s*40th\\s*Anniversary\\s*of\\s*WrestleMania)?": "WWE 2K24",
    "EA\\s*SPORTS\\s*FC\\s*25(?:\\s*and.*)?": "EA SPORTS FC 25",
    "Assassin’s\\s*Creed\\s*Chronicles\\s*China": "Assassin's Creed Chronicles",
    "Assassin’s\\s*Creed\\s*Chronicles\\s*India": "Assassin's Creed Chronicles",
    "Battlefield\\s*1\\s*&\\s*Titanfall\\s*2": "Battlefield 1 e Titanfall 2",
    "Mass\\s*Effect\\s*Andromeda": "Mass Effect",
    "Mass\\s*Effect\\s*Andromeda\\s*–": "Mass Effect",
    "Mortal\\s*Kombat\\s*X\\s*\\+?\\s*XL": "Mortal Kombat X",
    TEKKEN7: "TEKKEN 7",
    "Tom\\s*Clancy’s\\s*Rainbow\\s*Six\\s*Extraction":
      "Tom Clancy's Rainbow Six",
    "Tom\\s*Clancy’s\\s*Rainbow\\s*Six\\s*Siege": "Tom Clancy's Rainbow Six",
    "Uncharted\\s*The\\s*Nathan\\s*Drake's": "Uncharted The Nathan Drake",
    "Call\\s*of\\s*Duty\\s*WWIIچ": "Call of Duty WWII",
    "Grand\\s*Theft\\s*Auto\\s*San\\s*Andreas\\s*–\\s*The":
      "Grand Theft Auto: San Andreas",
    "Grand\\s*Theft\\s*Auto\\s*III\\s*–\\s*The": "Grand Theft Auto III",
    "Grand\\s*Theft\\s*Auto\\s*The": "Grand Theft Auto",
    "Grand\\s*Theft\\s*Auto\\s*Vice\\s*City\\s*–\\s*The":
      "Grand Theft Auto Vice City",
    "Grand\\s*Theft\\s*Auto\\s*The\\s*–\\s*The": "Grand Theft Auto Vice",
    "Grand\\s*Theft\\s*Auto\\s*3": "Grand Theft Auto III",
    "Nioh\\s*The": "Nioh",
    "Rise\\s*of\\s*the\\s*Tomb\\s*Raider":
      "Rise of the Tomb Raider: 20 Year Celebration",
    "Ratchet\\s*&\\s*Clank\\s*3": "Ratchet & Clank",
    "Alien\\s*&\\s*Isolation\\s*THE": "Alien Isolation",
  };

  // Apply title mappings
  for (const [pattern, replacement] of Object.entries(titleMappings)) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(cleanTitle)) {
      cleanTitle = replacement;
      break;
    }
  }

  cleanTitle = cleanTitle
    // حذف کاراکترهای اضافی و یکسان‌سازی فاصله‌ها
    .replace(/\s+/g, " ")
    .trim()
    .replace(
      /^-=\-=\-=\-=\-=\-=\-=\-=\-$|^=\-=\-=\-=\-=\-=\-=\-=$|^—\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-\-—$|^—————————$/,
      "$1"
    )
    .replace(/\s*GOLD EDITION/, "")
    .replace(/\s*Royal Edition/, "")
    .replace(/\s*NBA 75th Anniversary Edition/, "")
    .replace(/\s*Deluxe Recruit Edition/, "")
    .replace(/\s*Standard Recruit Edition/, "")
    .replace(/\s*Galactic Edition/, "")
    .replace(/\s*Standard Recruit Edition/, "")
    .replace(/\s*STORM 4 ROAD TO BORUTO/, "")
    .replace(/\s*Championship Edition/, "")
    .replace(/\s*Survival Evolved/, "")
    .replace(/\s*Ultimate Survivor Edition/, "")
    .replace(/\s*Survival Ascended/, "")
    .replace(/\s*Rescue Mission/, "")
    .replace(/\s*Traveler Edition/, "")
    .replace(/\s*GOLD Edition/, "")
    .replace(/\s*The Old Hunters Edition/, "")
    .replace(/\s*Zombies Chronicles Edition/, "")
    .replace(/\s*Triple Pack PS4 & PS5/, "")
    .replace(/\s*Curator's Cut/, "")
    .replace(/\s*Switchback VR/, "")
    .replace(/\s*Blades & Whip Edition/, "")
    .replace(/\s*Warmastered Edition/, "")
    .replace(/\s*The Fire Fades Edition/, "")
    .replace(/\s*REMASTERED/, "")
    .replace(/\s*SEASON UPDATE/, "")
    .replace(/\s*HD Collection/, "")
    .replace(/\s*HD Collection & 4SE Bundle PS4™ & PS5™/, "")
    // .replace(/\s*+ Vergil/, "")
    .replace(/\s*Eternal Collection/, "")
    .replace(/\s*Reaper of Souls - Ultimate Evil Edition/, "")
    .replace(/\s*Resurrected/, "")
    .replace(/\s*- Germany (Rally Location)/, "")
    .replace(/\s*The Final Cut/, "")
    .replace(/\s*Death of the Outsider/, "")
    .replace(/\s*Definitive Edtion/, "")
    .replace(/\s*Hamlet Console Edition/, "")
    .replace(/\s*VR Edition/, "")
    .replace(/\s*Super Deluxe Edition/, "")
    .replace(/\s*Shadow of the Erdtree/, "")
    .replace(/\s*Tamriel Unlimited/, "")
    .replace(/\s*Skyrim Special Edition/, "")
    .replace(/\s*Skyrim Anniversary Edition/, "")
    .replace(/\s*Skyrim VR/, "")
    .replace(/\s*Anniversary Edition/, "")
    .replace(/\s*Deluxe Schumacher Edition/, "")
    .replace(/\s*Seventy Edition/, "")
    .replace(/\s*Champions PS4 et PS5 Edition/, "")
    .replace(/\s*Blood Dragon/, "")
    .replace(/\s*Blood Dragon Classic Edition/, "")
    .replace(/\s*Classic Edition/, "")
    .replace(/\+\s*FAR CRY PRIMAL/, "")
    .replace(/\s*Standard Edition PS4 & PS5/, "")
    .replace(/\s*standard PS4 & PS5/, "")
    .replace(/\s*New Dawn Deluxe Edition/, "")
    // .replace(/\s*Primal/, '')
    // .replace(/\s*PRIMAL - APEX EDITION/, '')
    .replace(/\s*Digital Apex Edition/, "")
    .replace(/\s*APEX EDITION/, "")
    .replace(/\s*Platinum Edition PS4 & PS5/, "")
    .replace(/\s*ICON Edition/, "")
    .replace(/\s*NHL™ 19 Bundle/, "")
    .replace(/\s*NHL 19 Bundle/, "")
    .replace(/\s*The One Edition Bundle/, "")
    .replace(/\s*Ultimate Edition for/, "")
    .replace(/\s*REMAKE & REBIRTH Digital Deluxe Twin Pack/, "")
    .replace(/\s*REBIRTH/, "")
    .replace(/\s*Digital Exclusive Bundle/, "")
    .replace(/\s*Digital Edition deluxe/, "")
    .replace(/\s*25th Anniversary Digital Deluxe Edition/, "")
    .replace(/\s*Version: PS4/, "")
    .replace(/\s*Quidditch Champions PS4 & PS5/, "")
    .replace(/\s*Quidditch Champions/, "")
    .replace(/\s*Super Citizen Edition/, "")
    .replace(/\s*Dive Harder [R3]/, "")
    .replace(/\s*Super-Earth Ultimate Edition/, "")
    .replace(/\s*Absolution HD/, "")
    .replace(/\s*Blood Money HD/, "")
    .replace(/\s*The Heir of Hogwarts/, "")
    .replace(/\s*Version: PS4/, "")
    .replace(/\s*Voidheart Edition/, "")
    .replace(/\s*Wrong Number PS4 & PS5/, "")
    .replace(/\s*Showdown/, "")
    .replace(/\s*Showdown - Last Gust/, "")
    .replace(/\s*Scrat's Crazy Adventure/, "")
    .replace(/\s*Scrat's Nutty Adventure/, "")
    .replace(/\s*& SGW3 Unlimited Edition/, "")
    .replace(/\s*ULTIMATE EDITION/, "")
    .replace(/\s*Deluxe Party Edition/, "")
    .replace(/\s*Platinum Edition/, "")
    .replace(/\s*Croft Edition/, "")
    .replace(/\s*& Gat out of Hell/, "")
    .replace(/\s*20e anniversaire/, "")
    .replace(/\s*20 Year Celebration/, "")
    .replace(/\s*Gold Edition & Village Gold Edition/, "")
    .replace(/\s*Champions PS4/, "")
    .replace(/\s*A Realm Reborn/, "")
    .replace(/\s*Online - Complete Collector’s Edition/, "")
    .replace(/\s*MULTIPLAYER: COMRADES/, "")
    .replace(/\s*biohazard/, "")
    .replace(/\s*Edition Ultime/, "")
    .replace(/\s*Rift Apart PS5/, "")
    .replace(/\s*STANDARD EDITION/, "")
    .replace(/\s*ROYAL EDITION/, "")
    .replace(/\s*Persona Bundle/, "")
    .replace(/\s*Gourmet Edition/, "")
    .replace(/\s*Month 1 Edition/, "")
    .replace(/\s*X-Factor Edition till/, "")
    .replace(/\s*for PS5/, "")
    .replace(/\s*Palace Edition/, "")
    .replace(/\s*Pursuit Remastered/, "")
    .replace(/\s*Mamba Forever Edition Bundle/, "")
    .replace(/\s*for PS4/, "")
    .replace(/\s*NBA 75th Anniversary Edition/, "")
    .replace(/\s*Michael Jordan Edition/, "")
    .replace(/\s*Baller Edition/, "")
    .replace(/\s*Black Mamba Edition/, "")
    .replace(/\s*Kobe Bryant Edition/, "")
    .replace(/\s*Road to Boruto/, "")
    .replace(/\s*Iceborne/, "")
    .replace(/\s*Digital Deluxe Edition ---> PS5/, "")
    .replace(/\s*Iceborne Master Edition/, "")
    .replace(/\+\s*Sunbreak/, "")
    .replace(/\s*The Official Videogame/, "")
    .replace(/\s*Legion Edition/, "")
    .replace(/\s*Deluxe Recruit Edition/, "")
    .replace(/\s*Exclusive Digital Edition/, "")
    .replace(/\s*Superstar Edition/, "")
    .replace(/\s*75th Anniversary Edition/, "")
    .replace(/\s*Kobe Bryant/, "")
    .replace(/\s*‎: Legion of Dawn Edition/, "")
    .replace(/\s*All-Star Edition/, "")
    .replace(/\s*Edizione Standard/, "")
    .replace(/\s*Originals Edition/, "")
    .replace(/\s*Legends Edition/, "")
    .replace(/\s*Master Hunter Bundle/, "")
    .replace(/\s*Standard Edition/, "")
    .replace(/\s*Operator Edition/, "")
    .replace(/\s*Aftermath >>> PS5/, "")
    .replace(/\s*Icon Edition/, "")
    .replace(/\s*The Successor of the Legend/, "")
    .replace(/\s*Dream Maker/, "")
    .replace(/\s*Icon Edition/, "")
    .replace(/\s*Year 2 Gold Edition/, "")
    .replace(/\s*COMPLETE EDITION/, "")
    .replace(/\s*Ancient Air Snail Bundle/, "")
    .replace(/\s*Chapter 2: Retribution - Payback Edition/, "")
    .replace(/\s*Pro Tour Deluxe Edition/, "")
    .replace(/\s*Help Wanted - Bundle/, "")
    .replace(/\s*Sister Location/, "")
    .replace(/\s*Marching Fire Edition/, "")
    .replace(/\s*DIRECTOR'S CUT/, "")
    .replace(/\s*Deluxe Download Edition/, "")
    .replace(/\s*Legends PS4 Edition/, "")
    .replace(/\s*Security Breach PS4 & PS5/, "")
    .replace(/\s*Online Complete Edition/, "")
    .replace(/\s*Riptide Definitive Edition/, "")
    .replace(/^(.*?)\s*: Nitros Oxide Edition$/, "$1")
    .replace(/^(.*?)\s*: Nitros Oxide$/, "$1")
    // یکسان‌سازی نام‌های خاص
    .replace(/FIFA\s*(\d{2})/i, "FIFA $1")
    .replace(/Battlefield\s*/i, "Battlefield ")
    .replace(/BATMAN/i, "Batman")
    .replace(/ACE\s*COMBAT\s*7/i, "ACE COMBAT 7")
    .replace(/Assassin['']s\s*Creed/i, "Assassin's Creed")
    .replace(/DRAGON\s*BALL/i, "Dragon Ball")
    // حذف پسوندهای اضافی
    .replace(
      /\s*(Bundle|Pack|Vault|Cross-?gen|Launch|Full game|Enhanced|Special|Final Battle|Competition|Competizione|Competizioneerous|Revolution|Multi-Gen|Multi-Generation)(?:\s|$)/gi,
      ""
    )
    .replace(/\s*(?:Game of the Year|Director's Cut)(?:\s+Edition)?/gi, "")
    .replace(/\s*\[.*?\]/g, "")
    .replace(/\s*\(.*?\)/g, "")
    .replace(/\s*\[\d+\]$/, "")
    .replace(/^(.*?)\s+per\s+PS\d+\s+e\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+for\s+PS\d+\s+and\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+–\s+PS\d+\s+and\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+—\s+PS\d+\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+–\s+PS\d+\s+og\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+–\s+PS\d+\s+PS\d+$/, "$1")
    .replace(/^(.*?)\s+pour\s+PS\d+\s+et\s+PS\d+$/, "$1")
    // .replace(/Part/gi, "part")
    // .replace(/Parte/gi, "part")
    // .replace(/parte/gi, "part")
    .replace(/\bOf\b/, "of")
    .replace(/\s*Cross-Gen-Bundle\s*/, " ")
    .replace(/\s*Multi-Generation Lite\s*/, " ")
    .replace(/^(.*?):\s*(.*)$/, "$1 $2")
    // .replace(/^(.*?)\s*: Remastered$/, "$1")
    .replace(/^(.*?)\s*: Competition$/, "$1")
    .replace(/^(.*?)\s*: Competizione$/, "$1")
    .replace(/^(.*?)\s*: Competizione$/, "$1")
    .replace(/^(.*?)\s*: + CTR Nitro-Fueled$/, "$1")
    .replace(/\s*Nitros Oxide/, "")
    .replace(/^(.*?)\s*: Traveler Edition$/, "$1")
    .replace(/^(.*?)\s*: e Titanfall 2$/, "$1")
    .replace(/^(.*?)\s*: ==Revolution$/, "$1")
    .replace(/^(.*?)\s*–\s*The\s+Definitive$/, "$1")
    .replace(/^(.*?)\s*–\s*Legend\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Deluxe\s+Party\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Standard\s+Eition$/, "$1")
    .replace(/^(.*?)\s*–\s*Standard\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Traveler\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Enhanced\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Console\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*DIRECTOR’S\s+CUT$/, "$1")
    .replace(/^(.*?)\s*–\s*Ultimate\s+Bundle$/, "$1")
    .replace(/^(.*?)\s*–\s*Edition\s+Bundle$/, "$1")
    .replace(/^(.*?)\s*–\s*Seventy\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Deluxe\s+Launch\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*Game\s+of\s+the\s+Year$/, "$1")
    .replace(/^(.*?)\s*–\s*Game\s+of\s+the\s+Year\s+Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*MVP\s+Edition$/, "$1")
    .replace(/\|/, "")
    .replace(/\s+Stand Alone$/, "")
    .replace(/\s+Stand Alone$/, "")
    .replace(/\s+--->$/, "")
    .replace(/\s*\(Standalone\)$/, "")
    .replace(/\s*Remake\s*/, " ")
    .replace(/\s*\[15559\]\s*/, " ")
    .replace(/\s*Console\s*/, " ")
    .replace(/\s*PlayStation4\s*/, " ")
    .replace(/\s*Remasterizado\s*/, " ")
    .replace(/\s*Reloaded\s*/, " ")
    .replace(/\s*PlayStation4\s*/, " ")
    // .replace(/\s*Remastered\s*/, " ")
    .replace(/\s*Digital\s*/, " ")
    .replace(/\s*Ultimate\s*/, " ")
    .replace(/\s*Ultimate pour\s*/, " ")
    .replace(/\s*Ultimate pour\s*/, " ")
    .replace(/\s*Legend Edition\s*/, " ")
    .replace(/\s*SEASON UPDATE\s*/, " ")
    .replace(/\s*premium Edition\s*/, " ")
    .replace(/\s*Edition premium\s*/, " ")
    .replace(/\s*Campagne Remaster\s*/, " ")
    .replace(/\s*Campaign Remastered\s*/, " ")
    .replace(/\s*Estndar Edicin\s*/, " ")
    .replace(/\s*Standardowa\s*/, " ")
    .replace(/\bChampions Edition\b/, " ")
    .replace(/@fullhacker2017\b/, " ")
    .replace(/\bTOP GUN: Maverick\b/, " ")
    .replace(/\s*1\) ToPS4Account\s*/, " ")
    .replace(/\s*350 T\s*/, " ")
    .replace(/\s*4\) Acc021\s*/, " ")
    .replace(/\s*5\) Log Seller's\s*/, " ")
    .replace(/\s*5\) PS GameShare\s*/, " ")
    .replace(/\bVR MODE\b/, " ")
    .replace(/\bPS4 & PS5\b/, " ")
    .replace(/\bper\b/, " ")
    .replace(/\bElite\b/, " ")
    // .replace(/\bThe\b/, " ")
    // .replace(/\bTHE\b/, " ")
    .replace(/\>>> PS5\b/, " ")
    .replace(/\bTHE COLLECTION\b/, " ")
    .replace(/\bCOLLECTION\b/, " ")
    .replace(/\s*Definitive\s*/, " ")
    .replace(/\s*Premium\s*/, " ")
    .replace(/\s*Premium\s*/, " ")
    .replace(/\s*Deluxe\s*/, " ")
    .replace(/\s*Standart\s*/, " ")
    .replace(/\s*Standard pour\s*/, " ")
    .replace(/\s*Explorer's Edition\s*/, " ")
    .replace(/\s*Standart\s*/, " ")
    .replace(/\s*Eition\s*/, " ")
    .replace(/\s*Edycja\s*/, " ")
    .replace(/\s*Sürüm\s*/, " ")
    .replace(/\s*Edicimn\s*/, " ")
    .replace(/\s*Estandar\s*/, " ")
    .replace(/\s*Standard\s*/, " ")
    // .replace(/\s*Edition\s*/, " ")
    .replace(/\s*para\s*/, " ")
    .replace(/\s*Standard\s*/, " ")
    .replace(/\s*Gold\s*/, " ")
    .replace(/\s*Legendary\s*/, " ")
    .replace(/\s*Complete\s*/, " ")
    .replace(/^(.*?)\s*–\s*The Definitive Edition$/, "$1")
    .replace(/^(.*?)\s*–\s*The Definitive$/, "$1")
    // حذف نسخه‌های خاص
    .replace(/\s+-\s+(?:Trilogy|Collection)$/i, "")
    .replace(/\s+(?:Legacy|Next Level)$/i, "")
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
    .replace(/\s*-Lite\s*/, " ")
    .replace(
      /\s*PlayStation5\s*/,
      " "
        // یکسان‌سازی نهایی
        .replace(/\s+/g, " ")
        .trim()
    );

  editions.forEach((editionPattern) => {
    cleanTitle = cleanTitle.replace(editionPattern, "");
  });

  cleanTitle = cleanTitle.replace(/\s*\\?-\s*(?=\s|$)/g, "").trim();

  cleanTitle = cleanTitle.replace(/\s*\+\s*CTR Nitro-Fueled/, "");
  cleanTitle = cleanTitle.replace(/\s*\+\s*Nitros Oxide/, "");

  for (const [pattern, replacement] of Object.entries(titleMappings)) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(cleanTitle)) {
      cleanTitle = replacement;
      break;
    }
  }

  return cleanTitle;
}

async function findSimilarTitle(cleanTitle) {
  try {
    // ابتدا جستجوی دقیق انجام دهید (برای عملکرد سریع‌تر)
    const exactMatch = await pgClient.query(
      "SELECT id, clean_title FROM games WHERE LOWER(clean_title) = LOWER($1) LIMIT 1",
      [cleanTitle]
    );

    if (exactMatch.rows.length > 0) {
      return exactMatch.rows[0];
    }

    // بازیابی چند نتیجه برتر برای پردازش در JavaScript
    const results = await pgClient.query(
      `SELECT id, clean_title, SIMILARITY(LOWER(clean_title), LOWER($1)) as similarity
       FROM games 
       WHERE SIMILARITY(LOWER(clean_title), LOWER($1)) >= $2
       ORDER BY similarity DESC 
       LIMIT 10`,
      [cleanTitle, SIMILARITY_THRESHOLD]
    );

    if (results.rows.length === 0) {
      return null;
    }

    // پردازش نتایج در JavaScript
    const processedResults = results.rows.map((game) => {
      const inputWords = cleanTitle.toLowerCase().split(/\s+/);
      const titleWords = game.clean_title.toLowerCase().split(/\s+/);

      // بررسی تطابق دقیق
      if (game.clean_title.toLowerCase() === cleanTitle.toLowerCase()) {
        return { ...game, final_score: 2.0 };
      }

      // محاسبه تفاوت کلمات
      const uniqueInInput = inputWords.filter((w) => !titleWords.includes(w));
      const uniqueInTitle = titleWords.filter((w) => !inputWords.includes(w));
      const differenceCount = uniqueInInput.length + uniqueInTitle.length;

      // امتیازدهی نهایی با در نظر گرفتن تفاوت‌ها
      const final_score = game.similarity - differenceCount * 0.1;

      return { ...game, final_score };
    });

    // مرتب‌سازی بر اساس امتیاز نهایی
    processedResults.sort((a, b) => b.final_score - a.final_score);
    const bestMatch = processedResults[0];

    // اعمال فیلتر فاصله ویرایشی اگر کتابخانه levenshtein موجود است
    if (typeof levenshtein !== "undefined") {
      const distance = levenshtein.get(
        bestMatch.clean_title.toLowerCase(),
        cleanTitle.toLowerCase()
      );
      if (distance <= MAX_EDIT_DISTANCE) {
        return bestMatch;
      }
      return null;
    }

    // اگر کتابخانه levenshtein موجود نیست، فقط از امتیاز نهایی استفاده کنید
    if (bestMatch.final_score >= 0.6) {
      // می‌توانید این آستانه را تنظیم کنید
      return bestMatch;
    }

    return null;
  } catch (error) {
    console.error("Error finding similar title:", error);
    return null;
  }
}

// واردات کانال‌ها از SQLite به PostgreSQL
async function importChannels() {
  return new Promise((resolve, reject) => {
    console.log("Importing channels from SQLite...");

    sqliteClient.all("SELECT id, name FROM channels", async (err, rows) => {
      if (err) return reject(err);

      console.log(`Found ${rows.length} channels in SQLite database`);

      try {
        // استفاده از تراکنش برای درج سریع‌تر
        await pgClient.query("BEGIN");

        for (const channel of rows) {
          console.log(`Importing channel: ${channel.id} - ${channel.name}`);
          await pgClient.query(
            `INSERT INTO channels (id, name) 
               VALUES ($1, $2)
               ON CONFLICT (id) DO UPDATE SET name = $2`,
            [channel.id, channel.name]
          );
        }

        await pgClient.query("COMMIT");
        console.log(`Imported ${rows.length} channels successfully`);
        resolve();
      } catch (error) {
        await pgClient.query("ROLLBACK");
        console.error("Error importing channels:", error);
        reject(error);
      }
    });
  });
}

// واردات پست‌ها با اطلاعات کامل
async function importPosts() {
  return new Promise((resolve, reject) => {
    console.log("Importing posts from SQLite...");

    // ابتدا ساختار جداول را بررسی کنید
    sqliteClient.get("PRAGMA table_info(posts)", (err, columns) => {
      if (err) return reject(err);

      console.log("Posts table structure:", columns);

      // بررسی کنید آیا فیلد channel عددی است یا رشته‌ای
      sqliteClient.all(
        "SELECT id, channel FROM posts LIMIT 10",
        (err, samples) => {
          if (err) return reject(err);

          console.log("Sample posts channel values:", samples);

          // سپس پست‌ها را دریافت کنید
          sqliteClient.all(
            `SELECT id, number, message AS content, channel, 
                    last_sent, message_id, file_id, parent_id, original_message
             FROM posts`,
            async (err, rows) => {
              if (err) return reject(err);

              console.log(`Found ${rows.length} posts in SQLite database`);

              // بررسی کنید آیا channel شناسه عددی است یا نام کانال
              const isChannelNumeric = rows.some(
                (row) => row.channel && !isNaN(parseInt(row.channel))
              );

              console.log(
                `Channel appears to be ${
                  isChannelNumeric ? "numeric ID" : "text name"
                }`
              );

              // اگر channel شناسه عددی است، مستقیماً از آن استفاده کنید
              if (isChannelNumeric) {
                for (const [index, row] of rows.entries()) {
                  // تبدیل channel به شناسه عددی
                  row.channel_id = row.channel ? parseInt(row.channel) : null;

                  // اطمینان حاصل کنید که کانال در جدول channels وجود دارد
                  if (row.channel_id) {
                    try {
                      const channelExists = await pgClient.query(
                        "SELECT 1 FROM channels WHERE id = $1",
                        [row.channel_id]
                      );

                      if (channelExists.rows.length === 0) {
                        console.log(
                          `Creating missing channel with ID ${row.channel_id}`
                        );
                        await pgClient.query(
                          "INSERT INTO channels (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                          [row.channel_id, `Channel ${row.channel_id}`]
                        );
                      }
                    } catch (err) {
                      console.error(
                        `Error checking/creating channel ${row.channel_id}:`,
                        err
                      );
                    }
                  }

                  await processFullPost(row);
                  if (index % 100 === 0) {
                    console.log(`Processed ${index + 1}/${rows.length} posts`);
                  }
                }
              } else {
                // اگر channel نام است، از نگاشت قبلی استفاده کنید
                sqliteClient.all(
                  "SELECT id, name FROM channels",
                  async (err, channels) => {
                    if (err) return reject(err);

                    const channelMap = {};
                    channels.forEach((channel) => {
                      channelMap[channel.name] = channel.id;
                    });

                    for (const [index, row] of rows.entries()) {
                      row.channel_id = row.channel
                        ? channelMap[row.channel]
                        : null;

                      if (!row.channel_id && row.channel) {
                        console.warn(
                          `Warning: Channel '${row.channel}' not found for post ${row.id}`
                        );
                      }

                      await processFullPost(row);
                      if (index % 100 === 0) {
                        console.log(
                          `Processed ${index + 1}/${rows.length} posts`
                        );
                      }
                    }
                  }
                );
              }

              resolve();
            }
          );
        }
      );
    });
  });
}

// پردازش کامل پست با تمام فیلدها
async function processFullPost(row) {
  try {
    // لاگ برای اشکال‌زدایی
    if (row.id % 1000 === 0) {
      console.log(
        `Processing post ${row.id}, channel: ${row.channel}, channel_id: ${row.channel_id}`
      );
    }

    // شناسایی و حذف پست‌های تبلیغاتی
    const isAd = /Buy\s*\(خرید\)|جوین بشید و پیام بدید/i.test(row.content);
    if (isAd) {
      console.log(`Skipping ad post ${row.id}`);
      return;
    }

    // نرمال‌سازی محتوا
    const cleanContent = row.content
      .replace(/\\[=-]/g, (m) => (m === "\\=" ? "=" : "-"))
      .replace(/[=*]{4,}/g, "")
      .replace(/\\n/g, "\n")
      .trim();

    // استخراج اطلاعات منطقه
    const regionMatch = row.content.match(/🌐\s*Region?\s*(\d+)/i);

    // استخراج قیمت‌ها و وضعیت فروش
    const extractPriceInfo = (platform) => {
      const regex = new RegExp(
        `💰\\s*Price\\s*${platform}\\s*:\\s*(\\S+)|` +
          `💸\\s*Price\\s*${platform}\\s*:\\s*(\\S+)|` +
          `♻️\\s*Price\\s*:\\s*(\\S+)|` +
          `💷\\s*Price\\s*:\\s*(\\S+)`,
        "i"
      );

      const match = row.content.match(regex);
      if (!match) return { price: null, sold: false };

      const value = match[1] || match[2] || match[3] || match[4];
      return {
        price: parseInt(value.replace(/\D/g, "")) || null,
        sold: value.toLowerCase().includes("sold"),
      };
    };

    const ps4Info = extractPriceInfo("PS4");
    const ps5Info = extractPriceInfo("PS5");

    // درج یا به‌روزرسانی پست با تمام فیلدها
    await pgClient.query(
      `INSERT INTO posts 
        (id, number, content, channel_id, region, price_ps4, price_ps5, 
         is_ps4_sold, is_ps5_sold, source_file, last_sent, message_id, 
         file_id, parent_id, original_message) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         number = EXCLUDED.number,
         content = EXCLUDED.content,
         channel_id = EXCLUDED.channel_id,
         region = EXCLUDED.region,
         price_ps4 = EXCLUDED.price_ps4,
         price_ps5 = EXCLUDED.price_ps5,
         is_ps4_sold = EXCLUDED.is_ps4_sold,
         is_ps5_sold = EXCLUDED.is_ps5_sold,
         source_file = EXCLUDED.source_file,
         last_sent = EXCLUDED.last_sent,
         message_id = EXCLUDED.message_id,
         file_id = EXCLUDED.file_id,
         parent_id = EXCLUDED.parent_id,
         original_message = EXCLUDED.original_message,
         updated_at = CURRENT_TIMESTAMP`,
      [
        row.id,
        row.number || null,
        cleanContent,
        row.channel_id || null,
        regionMatch?.[1] || null,
        ps4Info.price,
        ps5Info.price,
        ps4Info.sold,
        ps5Info.sold,
        "sqlite-import",
        row.last_sent || null,
        row.message_id || null,
        row.file_id || null,
        row.parent_id || null,
        row.original_message || null,
      ]
    );

    // استخراج عناوین بازی‌ها
    const gameLines = cleanContent
      .split(/\n|\\n/g)
      .map((line) => line.trim())
      .filter((line) => {
        const isMetadata = /🌐|💰|💸|♻️|💷|🔥|❗️|@|=\-|PS\d/i.test(line);
        return !isMetadata && line.length > 2;
      });

    // حذف ارتباطات قدیمی
    await pgClient.query(`DELETE FROM games_posts WHERE post_id = $1`, [
      row.id,
    ]);

    // ایجاد ارتباطات جدید
    for (const gameLine of gameLines) {
      const gameId = await processGameTitle(gameLine, row.id);
      if (gameId) {
        await pgClient.query(
          `INSERT INTO games_posts (game_id, post_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [gameId, row.id]
        );
      }
    }

    if (row.id % 1000 === 0) {
      console.log(`Post ${row.id} processed successfully`);
    }
  } catch (error) {
    console.error(`Error processing post ${row.id}:`, error);
  }
}

// اصلاح تابع findSimilarTitle برای استفاده از pgClient
async function findSimilarTitle(cleanTitle) {
  try {
    // ابتدا جستجوی دقیق انجام دهید
    const exactMatch = await pgClient.query(
      "SELECT id, clean_title FROM games WHERE LOWER(clean_title) = LOWER($1) LIMIT 1",
      [cleanTitle]
    );

    if (exactMatch.rows.length > 0) {
      return exactMatch.rows[0];
    }

    // بازیابی نتایج مشابه
    const results = await pgClient.query(
      `SELECT id, clean_title, SIMILARITY(LOWER(clean_title), LOWER($1)) as similarity
       FROM games 
       WHERE SIMILARITY(LOWER(clean_title), LOWER($1)) >= $2
       ORDER BY similarity DESC 
       LIMIT 10`,
      [cleanTitle, SIMILARITY_THRESHOLD]
    );

    if (results.rows.length === 0) {
      return null;
    }

    // پردازش نتایج
    const processedResults = results.rows.map((game) => {
      const inputWords = cleanTitle.toLowerCase().split(/\s+/);
      const titleWords = game.clean_title.toLowerCase().split(/\s+/);

      if (game.clean_title.toLowerCase() === cleanTitle.toLowerCase()) {
        return { ...game, final_score: 2.0 };
      }

      const uniqueInInput = inputWords.filter((w) => !titleWords.includes(w));
      const uniqueInTitle = titleWords.filter((w) => !inputWords.includes(w));
      const differenceCount = uniqueInInput.length + uniqueInTitle.length;

      const final_score = game.similarity - differenceCount * 0.1;

      return { ...game, final_score };
    });

    processedResults.sort((a, b) => b.final_score - a.final_score);
    const bestMatch = processedResults[0];

    if (typeof levenshtein !== "undefined") {
      const distance = levenshtein.get(
        bestMatch.clean_title.toLowerCase(),
        cleanTitle.toLowerCase()
      );
      if (distance <= MAX_EDIT_DISTANCE) {
        return bestMatch;
      }
      return null;
    }

    if (bestMatch.final_score >= 0.6) {
      return bestMatch;
    }

    return null;
  } catch (error) {
    console.error("Error finding similar title:", error);
    return null;
  }
}

// اصلاح تابع processGameTitle برای استفاده از pgClient
async function processGameTitle(originalTitle, postId) {
  if (shouldSkipLine(originalTitle)) return null;

  const cleanTitle = cleanGameTitle(originalTitle);
  if (!cleanTitle || cleanTitle.length < 3) return null;

  try {
    const similarGame = await findSimilarTitle(cleanTitle);

    if (similarGame) {
      return similarGame.id;
    }

    const result = await pgClient.query(
      `INSERT INTO games (original_title, clean_title) 
       VALUES ($1, $2)
       ON CONFLICT (clean_title) DO UPDATE SET clean_title = $2 
       RETURNING id`,
      [originalTitle, cleanTitle]
    );

    uniqueGames.add(cleanTitle);
    return result.rows[0].id;
  } catch (error) {
    console.error("Error processing game title:", error);
    return null;
  }
}

// تابع اصلی اجرا
async function main() {
  try {
    // اتصال به دیتابیس‌ها
    await pgClient.connect();
    console.log("Connected to PostgreSQL");

    await new Promise((resolve, reject) => {
      sqliteClient.serialize(() => {
        sqliteClient.get("SELECT name FROM sqlite_master", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
    console.log("Connected to SQLite");

    // ایجاد ساختار دیتابیس
    await createTables();
    console.log("Database structure created");

    // انتقال کانال‌ها
    await importChannels();
    console.log("Channels imported");

    // انتقال پست‌ها
    await importPosts();
    console.log("Posts imported");

    console.log("\nMigration completed successfully");
    console.log(`Total unique games processed: ${uniqueGames.size}`);
  } catch (error) {
    console.error("Fatal error during migration:", error);
    process.exit(1);
  } finally {
    await pgClient.end();
    sqliteClient.close();
    console.log("Database connections closed");
  }
}

// اجرای برنامه
main();
