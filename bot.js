const { Bot, InlineKeyboard, session } = require("grammy");
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");
const { FileAdapter } = require("@grammyjs/storage-file");
require("dotenv").config();

const videoFileId = "BAACAgQAAxkBAAIG6mfB9zpAS3Dme5COF9LrtdTfSbIIAAIuFQAC0ZURUjlh8DuJeyNWNgQ";

const tutorialCaption = "به اولین ربات جستجوگر بازی خوش آمدید 🤖👋🏻\n\n" +
  "1) با استارت ربات شما میتونید یک یا چند بازی رو انتخاب کنید🤞🏻\n\n" +
  "2) سپس شما میتونید کنسول مورد نظرتون رو انتخاب کنید 😎\n\n" +
  "3) و در اخر بات بین 2000 اکانت جستجو کرده و اکانت هایی که بازی های مد نظر شما رو دارند برای شما ارسال میکنه 🔥🫡\n\n";

// تابع ارسال امن پیام
async function safeReply(ctx, text, extra = {}) {
  try {
    return await ctx.reply(text, extra);
  } catch (error) {
    if (error.error_code === 403) {
      console.warn(`🚨 کاربر ${ctx.from?.id} ربات را بلاک کرده است.`);
    } else {
      console.error("❌ خطا در ارسال پیام:", error);
    }
    return null;
  }
}

// تابع ارسال امن ویدیو
async function safeReplyWithVideo(ctx, videoFileId, extra = {}) {
  try {
    return await ctx.replyWithVideo(videoFileId, extra);
  } catch (error) {
    if (error.error_code === 403) {
      console.warn(`🚨 کاربر ${ctx.from?.id} ربات را بلاک کرده است.`);
    } else {
      console.error("❌ خطا در ارسال ویدیو:", error);
    }
    return null;
  }
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const bot = new Bot(process.env.BOT_TOKEN);

bot.use(
  session({
    initial: () => ({ selectedGameToRemove: null }),
    storage: new FileAdapter(),
  })
);

const requiredChannels = [
  { id: "-1001069711199", invite_link: "https://t.me/+SpQ0e29I2d05Yzg0" },
  { id: "-1001010895977", invite_link: "https://t.me/+PEEMaXuNHvpcoPcU" },
  { id: "-1001119154763", invite_link: "https://t.me/+ihfK56m0tckwODM0" },
  { id: "-1001056044991", invite_link: "https://t.me/+_WbXvrPeM6RmNWQ0" },
  { id: "-1001219426374", invite_link: "https://t.me/+PLvYzP0XwGs1Nzdk" },
  { id: "-1001066763571", invite_link: "https://t.me/CA_Storre" },
];

async function updateBotCommands(userId) {
  try {
    const gamesCount = await pool.query(
      `SELECT COUNT(*) FROM user_games 
       WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)
       AND user_games.deleted_at IS NULL`,
      [userId]
    );

    const hasGames = gamesCount.rows[0].count > 0;
    const baseCommands = [
      { command: "start", description: "شروع مجدد ربات" },
      { command: "menu", description: "نمایش منوی اصلی" },
      { command: "search_games", description: "جستجوی بازی" },
      { command: "my_games", description: "لیست بازی‌های من" },
    ];

    if (hasGames) {
      baseCommands.push({
        command: "select_console",
        description: "انتخاب کنسول",
      });
    }

    baseCommands.push({
      command: "tutorial",
      description: "آموزش استفاده از ربات",
    });

    await bot.api.setMyCommands(baseCommands, {
      scope: { type: "chat", chat_id: userId },
    });

    return true;
  } catch (error) {
    console.error("❌ خطا در بروزرسانی منوی دستورات:", error);
    return false;
  }
}

async function setupDefaultBotCommands() {
  try {
    await bot.api.setMyCommands([
      { command: "start", description: "شروع کار با ربات" },
      { command: "menu", description: "نمایش منوی اصلی" },
      { command: "search_games", description: "جستجوی بازی" },
      { command: "my_games", description: "لیست بازی‌های من" },
      { command: "tutorial", description: "آموزش استفاده از ربات" },
    ]);
    console.log("✅ منوی دستورات پیش‌فرض ربات با موفقیت تنظیم شد.");
  } catch (error) {
    console.error("❌ خطا در تنظیم منوی دستورات پیش‌فرض:", error);
  }
}

async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT,
        username TEXT,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        clean_title TEXT NOT NULL UNIQUE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_games (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        game_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
    `);

    await pool.query(
      `ALTER TABLE user_games ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;`
    );

    console.log("✅ جداول ایجاد یا بررسی شدند.");
  } catch (error) {
    console.error("❌ خطا در ایجاد جداول:", error);
  }
}

async function checkMembership(userId) {
  const notJoinedChannels = [];
  for (const channel of requiredChannels) {
    try {
      const chatMember = await bot.api.getChatMember(channel.id, userId);
      if (["left", "kicked"].includes(chatMember.status)) {
        const chatInfo = await bot.api.getChat(channel.id);
        notJoinedChannels.push({
          title: chatInfo.title,
          link: channel.invite_link || `https://t.me/${chatInfo.username}`,
        });
      }
    } catch (error) {
      console.log(`خطا در بررسی کانال ${channel.id}:`, error.message);
    }
  }
  return notJoinedChannels;
}

async function hasGames(userId) {
  const gamesCount = await pool.query(
    `SELECT COUNT(*) FROM user_games 
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1) 
     AND deleted_at IS NULL`,
    [userId]
  );
  return gamesCount.rows[0].count > 0;
}

async function showFullMenu(ctx) {
  const userId = ctx.from.id;
  const hasGamesValue = await hasGames(userId);

  const mainKeyboard = new InlineKeyboard()
    .text("🎲 جستجوی بازی", "search_games")
    .row()
    .text("📋 لیست بازی‌های من", "my_games_list")
    .row();

  if (hasGamesValue) {
    mainKeyboard.text("🎮 انتخاب کنسول", "select_console_menu").row();
  }

  mainKeyboard
    .text("💡 آموزش استفاده از ربات", "tutorial")
    .row()
    .text("❓ راهنمای دستورات", "commands_help");

  await safeReply(ctx,
    "🎮 *منوی اصلی ربات* 🎮\n\n" +
    "به ربات جستجوی بازی خوش آمدید. لطفاً یکی از گزینه‌های زیر را انتخاب کنید:",
    {
      reply_markup: mainKeyboard,
      parse_mode: "Markdown",
    }
  );
}

async function showJoinMessage(ctx, notJoinedChannels) {
  const keyboard = new InlineKeyboard();
  notJoinedChannels.forEach((channel) => {
    keyboard.url(`📢 ${channel.title}`, channel.link).row();
  });
  keyboard.text("✅ عضو شدم", "check_membership");

  await safeReply(ctx,
    "🚩 لطفاً ابتدا در کانال‌های زیر عضو شوید و سپس روی دکمه «عضو شدم» کلیک کنید:",
    { reply_markup: keyboard }
  );
}

bot.command("start", async (ctx) => {
  const user = ctx.from;
  try {
    await pool.query(
      `INSERT INTO users (telegram_id, first_name, last_name, username)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE
       SET first_name = EXCLUDED.first_name,
           last_name = EXCLUDED.last_name,
           username = EXCLUDED.username;`,
      [user.id, user.first_name, user.last_name || null, user.username || null]
    );

    const notJoinedChannels = await checkMembership(user.id);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }

    await updateBotCommands(user.id);
    await safeReply(ctx, `سلام ${user.first_name}! 👋 به ربات جستجوی بازی خوش اومدی.`);
    await showFullMenu(ctx);
  } catch (error) {
    console.error("❌ خطا در ذخیره اطلاعات کاربر:", error);
    await safeReply(ctx, "مشکلی پیش آمد. لطفاً دوباره امتحان کن.");
  }
});

bot.command("menu", async (ctx) => {
  const notJoinedChannels = await checkMembership(ctx.from.id);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }
  await showFullMenu(ctx);
});

bot.command("search_games", async (ctx) => {
  const notJoinedChannels = await checkMembership(ctx.from.id);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }
  await safeReply(ctx, "🚩 لطفاً نام بازی مورد نظر خود را وارد کنید:");
});

bot.command("tutorial", async (ctx) => {
  const notJoinedChannels = await checkMembership(ctx.from.id);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }

  try {
    await safeReplyWithVideo(ctx, videoFileId, {
      caption: tutorialCaption,
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  } catch (error) {
    await safeReply(ctx, tutorialCaption, {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  }
});

bot.callbackQuery("check_membership", async (ctx) => {
  const userId = ctx.from.id;
  const notJoinedChannels = await checkMembership(userId);

  if (notJoinedChannels.length === 0) {
    await ctx.answerCallbackQuery({
      text: "✅ عضویت شما تایید شد!",
      show_alert: true,
    });
    await safeReply(ctx, `سلام ${ctx.from.first_name}! 👋 خوش اومدی.`);
    await updateBotCommands(userId);
    await showFullMenu(ctx);
  } else {
    await ctx.answerCallbackQuery({
      text: "❌ هنوز در همه کانال‌ها عضو نشده‌اید!",
      show_alert: true,
    });
    await showJoinMessage(ctx, notJoinedChannels);
  }
});

bot.command("my_games", async (ctx) => {
  const userId = ctx.from.id;

  const notJoinedChannels = await checkMembership(userId);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }

  const result = await pool.query(
    `SELECT games.clean_title, games.id 
     FROM user_games 
     JOIN games ON user_games.game_id = games.id 
     WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)
     AND user_games.deleted_at IS NULL`,
    [userId]
  );

  if (result.rows.length === 0) {
    return await safeReply(ctx, "❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  }

  const keyboard = new InlineKeyboard();
  result.rows.forEach((row) => {
    keyboard.text(row.clean_title, `remove_game:${row.id}`).row();
  });
  keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

  await safeReply(ctx,
    "🕹️ لیست بازی‌های انتخابی شما:\n(با کلیک بر روی نام هر بازی، آن را از لیست خود حذف کنید)",
    { reply_markup: keyboard }
  );
});

bot.command("select_console", async (ctx) => {
  const userId = ctx.from.id;
  const notJoinedChannels = await checkMembership(userId);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }

  const hasGamesValue = await hasGames(userId);
  if (!hasGamesValue) {
    return await safeReply(ctx, "❌ ابتدا باید حداقل یک بازی به لیست خود اضافه کنید.", {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  }

  const keyboard = new InlineKeyboard()
    .text("PS4", "console:ps4")
    .text("PS5", "console:ps5")
    .row()
    .text("🔙 بازگشت به منو", "back_to_menu");

  await safeReply(ctx, "🎮 لطفاً کنسول مورد نظر خود را انتخاب کنید:", {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(/^console:(ps4|ps5)$/, async (ctx) => {
  const selectedConsole = ctx.match[1];
  const priceColumn = selectedConsole === "ps4" ? "price_ps4" : "price_ps5";
  const userId = ctx.from.id;

  try {
    const gamesResult = await pool.query(
      `SELECT games.id 
       FROM user_games 
       JOIN games ON user_games.game_id = games.id 
       WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)
       AND user_games.deleted_at IS NULL`,
      [userId]
    );

    if (gamesResult.rows.length === 0) {
      return await safeReply(ctx, "❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }

    const gameIds = gamesResult.rows.map((row) => row.id);
    if (gameIds.length === 0) {
      return await safeReply(ctx, "❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }

    const postsResult = await pool.query(
      `SELECT id, content
       FROM (
         SELECT DISTINCT p.id, p.content
         FROM games_posts 
         JOIN posts p ON p.id = games_posts.post_id 
         WHERE game_id = ANY($1) 
         AND ${priceColumn} IS NOT NULL
       ) AS distinct_posts
       ORDER BY RANDOM()
       LIMIT 100`,
      [gameIds]
    );

    if (postsResult.rows.length === 0) {
      return await safeReply(ctx, "❌ هیچ پستی برای بازی‌های شما یافت نشد.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }

    for (const post of postsResult.rows) {
      await safeReply(ctx, post.content);
    }

    await pool.query(
      `UPDATE user_games 
       SET deleted_at = CURRENT_TIMESTAMP 
       WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
      [userId]
    );
    await updateBotCommands(userId);

    await safeReply(ctx, "✅ لیست بازی‌های انتخابی شما پاک شد. می‌توانید دوباره جستجو کنید.", {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  } catch (error) {
    console.error("❌ خطا در دریافت پست‌ها:", error);
    await safeReply(ctx, "مشکلی پیش آمد. لطفاً دوباره امتحان کنید.", {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  }
});

bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  let searchQuery = ctx.message.text.trim();

  const notJoinedChannels = await checkMembership(userId);
  if (notJoinedChannels.length > 0) {
    const inviteMessage = "❌ لطفاً ابتدا در کانال‌های زیر عضو شوید:\n\n" +
      notJoinedChannels.map((channel) => `🔹 [${channel.title}](${channel.link})`).join("\n");
    await safeReply(ctx, inviteMessage, { parse_mode: "Markdown" });
    return;
  }

  const gamesCount = await pool.query(
    `SELECT COUNT(*) FROM user_games 
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)
     AND deleted_at IS NULL`,
    [userId]
  );

  if (gamesCount.rows[0].count >= 10) {
    await safeReply(ctx, 
      "❌ شما نمی‌توانید بیش از 10 بازی انتخاب کنید. برای تغییر لیست از دستور /my_games استفاده کنید.",
      { reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu") }
    );
    return;
  }

  searchQuery = searchQuery
    .replace(/\s+/g, "[\\s-]")
    .replace(/[™®]/g, "")
    .replace(/:\s*/g, "");

  let result = await pool.query(
    "SELECT id, clean_title FROM games WHERE clean_title ~* $1 LIMIT 20",
    [`.*${searchQuery}.*`]
  );

  if (result.rows.length === 0) {
    result = await pool.query(
      "SELECT id, clean_title FROM games WHERE SIMILARITY(clean_title, $1) > 0.8 LIMIT 20",
      [`.*${searchQuery}.*`]
    );
    if (result.rows.length === 0) {
      return await safeReply(ctx, "❌ هیچ بازی‌ای با این نام پیدا نشد.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }
  }

  const keyboard = new InlineKeyboard();
  result.rows.forEach((row) => {
    keyboard.text(row.clean_title, `select_game:${row.id}`).row();
  });
  keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

  await safeReply(ctx, "🔎 لطفاً بازی موردنظرتون رو از لیست انتخاب کنید:", {
    reply_markup: keyboard,
  });
});

// شروع ربات
async function startBot() {
  await createTables();
  await setupDefaultBotCommands();
  console.log("🤖 ربات در حال اجراست...");
  bot.start({
    drop_pending_updates: true,
    allowed_updates: ["message", "callback_query"],
  });
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("⚠️ Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("🔥 Uncaught Exception:", error);
});

startBot();
