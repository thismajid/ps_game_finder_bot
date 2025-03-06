const { Bot, InlineKeyboard, session } = require("grammy");
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");
const { FileAdapter } = require("@grammyjs/storage-file");
require("dotenv").config();

// تنظیمات اولیه و ثابت‌ها
const videoFileId = "BAACAgQAAxkBAAIG6mfB9zpAS3Dme5COF9LrtdTfSbIIAAIuFQAC0ZURUjlh8DuJeyNWNgQ";
const tutorialCaption = "به اولین ربات جستجوگر بازی خوش آمدید 🤖👋🏻\n\n" +
  "1) با استارت ربات شما میتونید یک یا چند بازی رو انتخاب کنید🤞🏻\n\n" +
  "2) سپس شما میتونید کنسول مورد نظرتون رو انتخاب کنید 😎\n\n" +
  "3) و در اخر بات بین 2000 اکانت جستجو کرده و اکانت هایی که بازی های مد نظر شما رو دارند برای شما ارسال میکنه 🔥🫡\n\n";

// تنظیمات اتصال به دیتابیس
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// تنظیمات پیشرفته بات
const bot = new Bot(process.env.BOT_TOKEN, {
  client: {
    apiRoot: "https://api.telegram.org",
    baseFetchConfig: {
      timeout: 30000,
    },
  },
  handlerTimeout: 90000,
  skipUpdates: true,
});

// تابع retry برای عملیات‌های حساس
async function withRetry(fn, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error.error_code === 409) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// middleware برای مدیریت خطاها
bot.use(async (ctx, next) => {
  try {
    await next();
  } catch (error) {
    console.error(`Error while handling update ${ctx.update?.update_id}:`, error);

    if (error.error_code === 403) {
      console.log(`User ${ctx.from?.id} blocked the bot`);
      // اینجا می‌توانید کاربر را در دیتابیس غیرفعال کنید
    } else if (error.error_code === 409) {
      console.log("Conflict in handling updates");
    }

    try {
      if (ctx.from?.id) {
        await ctx.reply("متأسفانه مشکلی پیش آمده است. لطفاً دوباره تلاش کنید.", {
          reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
        });
      }
    } catch (replyError) {
      console.error("Could not send error message to user:", replyError);
    }
  }
});

// تنظیم session
bot.use(
  session({
    initial: () => ({ selectedGameToRemove: null }),
    storage: new FileAdapter(),
  })
);

// تعریف کانال‌های مورد نیاز
const requiredChannels = [
  { id: "-1001069711199", invite_link: "https://t.me/+SpQ0e29I2d05Yzg0" },
  { id: "-1001010895977", invite_link: "https://t.me/+PEEMaXuNHvpcoPcU" },
  { id: "-1001119154763", invite_link: "https://t.me/+ihfK56m0tckwODM0" },
  { id: "-1001056044991", invite_link: "https://t.me/+_WbXvrPeM6RmNWQ0" },
  { id: "-1001219426374", invite_link: "https://t.me/+PLvYzP0XwGs1Nzdk" },
  { id: "-1001066763571", invite_link: "https://t.me/CA_Storre" },
];

// بروزرسانی منوی دستورات
async function updateBotCommands(userId) {
  try {
    const gamesCount = await withRetry(async () => {
      const result = await pool.query(
        `SELECT COUNT(*) FROM user_games 
         WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)
         AND user_games.deleted_at IS NULL`,
        [userId]
      );
      return result.rows[0].count > 0;
    });

    const baseCommands = [
      { command: "start", description: "شروع مجدد ربات" },
      { command: "menu", description: "نمایش منوی اصلی" },
      { command: "search_games", description: "جستجوی بازی" },
      { command: "my_games", description: "لیست بازی‌های من" },
    ];

    if (gamesCount) {
      baseCommands.push({
        command: "select_console",
        description: "انتخاب کنسول",
      });
    }

    baseCommands.push({
      command: "tutorial",
      description: "آموزش استفاده از ربات",
    });

    await withRetry(async () => {
      await bot.api.setMyCommands(baseCommands, {
        scope: { type: "chat", chat_id: userId },
      });
    });

    return true;
  } catch (error) {
    console.error("Error updating bot commands:", error);
    return false;
  }
}

// تنظیم منوی پیش‌فرض
async function setupDefaultBotCommands() {
  try {
    await withRetry(async () => {
      await bot.api.setMyCommands([
        { command: "start", description: "شروع کار با ربات" },
        { command: "menu", description: "نمایش منوی اصلی" },
        { command: "search_games", description: "جستجوی بازی" },
        { command: "my_games", description: "لیست بازی‌های من" },
        { command: "tutorial", description: "آموزش استفاده از ربات" },
      ]);
    });
    console.log("✅ Default commands set successfully");
  } catch (error) {
    console.error("❌ Error setting default commands:", error);
  }
}

// ایجاد جداول دیتابیس
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT,
        username TEXT,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        clean_title TEXT NOT NULL UNIQUE
      );

      CREATE TABLE IF NOT EXISTS user_games (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        game_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
    `);
    console.log("✅ Tables created or verified successfully");
  } catch (error) {
    console.error("❌ Error creating tables:", error);
    throw error;
  }
}

// بررسی عضویت در کانال‌ها
async function checkMembership(userId) {
  const notJoinedChannels = [];
  for (const channel of requiredChannels) {
    try {
      const chatMember = await withRetry(async () => {
        return await bot.api.getChatMember(channel.id, userId);
      });
      
      if (["left", "kicked"].includes(chatMember.status)) {
        const chatInfo = await withRetry(async () => {
          return await bot.api.getChat(channel.id);
        });
        notJoinedChannels.push({
          title: chatInfo.title,
          link: channel.invite_link || `https://t.me/${chatInfo.username}`,
        });
      }
    } catch (error) {
      console.error(`Error checking channel ${channel.id}:`, error);
    }
  }
  return notJoinedChannels;
}

// بررسی وجود بازی در لیست کاربر
async function hasGames(userId) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM user_games 
       WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1) 
       AND deleted_at IS NULL`,
      [userId]
    );
    return result.rows[0].count > 0;
  } catch (error) {
    console.error("Error checking user games:", error);
    return false;
  }
}

// نمایش منوی کامل
async function showFullMenu(ctx) {
  try {
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

    await ctx.reply(
      "🎮 *منوی اصلی ربات* 🎮\n\n" +
      "به ربات جستجوی بازی خوش آمدید. لطفاً یکی از گزینه‌های زیر را انتخاب کنید:",
      {
        reply_markup: mainKeyboard,
        parse_mode: "Markdown",
      }
    );
  } catch (error) {
    console.error("Error showing full menu:", error);
    throw error;
  }
}

// نمایش پیام عضویت در کانال‌ها
async function showJoinMessage(ctx, notJoinedChannels) {
  try {
    const keyboard = new InlineKeyboard();

    notJoinedChannels.forEach((channel) => {
      keyboard.url(`📢 ${channel.title}`, channel.link).row();
    });

    keyboard.text("✅ عضو شدم", "check_membership");

    await ctx.reply(
      "🚩 لطفاً ابتدا در کانال‌های زیر عضو شوید و سپس روی دکمه «عضو شدم» کلیک کنید:",
      { reply_markup: keyboard }
    );
  } catch (error) {
    console.error("Error showing join message:", error);
    throw error;
  }
}

// دستور start
bot.command("start", async (ctx) => {
  try {
    const user = ctx.from;
    await withRetry(async () => {
      await pool.query(
        `INSERT INTO users (telegram_id, first_name, last_name, username)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (telegram_id) DO UPDATE
         SET first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             username = EXCLUDED.username,
             is_active = TRUE;`,
        [user.id, user.first_name, user.last_name || null, user.username || null]
      );
    });

    const notJoinedChannels = await checkMembership(user.id);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }

    await updateBotCommands(user.id);
    await ctx.reply(`سلام ${user.first_name}! 👋 به ربات جستجوی بازی خوش اومدی.`);
    await showFullMenu(ctx);
  } catch (error) {
    console.error("Error in start command:", error);
    await ctx.reply("متأسفانه مشکلی پیش آمد. لطفاً دوباره تلاش کنید.");
  }
});

// دستور menu
bot.command("menu", async (ctx) => {
  try {
    const notJoinedChannels = await checkMembership(ctx.from.id);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }
    await showFullMenu(ctx);
  } catch (error) {
    console.error("Error in menu command:", error);
    throw error;
  }
});

// دستور search_games
bot.command("search_games", async (ctx) => {
  try {
    const notJoinedChannels = await checkMembership(ctx.from.id);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }
    await ctx.reply("🚩 لطفاً نام بازی مورد نظر خود را وارد کنید:");
  } catch (error) {
    console.error("Error in search_games command:", error);
    throw error;
  }
});

// دستور tutorial
bot.command("tutorial", async (ctx) => {
  try {
    const notJoinedChannels = await checkMembership(ctx.from.id);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }

    await withRetry(async () => {
      await ctx.replyWithVideo(videoFileId, {
        caption: tutorialCaption,
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    });
  } catch (error) {
    console.error("Error in tutorial command:", error);
    await ctx.reply(tutorialCaption, {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  }
});

// بررسی عضویت در کانال‌ها
bot.callbackQuery("check_membership", async (ctx) => {
  try {
    const userId = ctx.from.id;
    const notJoinedChannels = await checkMembership(userId);

    if (notJoinedChannels.length === 0) {
      await ctx.answerCallbackQuery({
        text: "✅ عضویت شما تایید شد!",
        show_alert: true,
      });
      await ctx.reply(`سلام ${ctx.from.first_name}! 👋 خوش اومدی.`);
      await updateBotCommands(userId);
      await showFullMenu(ctx);
    } else {
      await ctx.answerCallbackQuery({
        text: "❌ هنوز در همه کانال‌ها عضو نشده‌اید!",
        show_alert: true,
      });
      await showJoinMessage(ctx, notJoinedChannels);
    }
  } catch (error) {
    console.error("Error in check_membership callback:", error);
    throw error;
  }
});

// هندلر متن‌های دریافتی
bot.on("message:text", async (ctx) => {
  try {
    const userId = ctx.from.id;
    let searchQuery = ctx.message.text.trim();

    const notJoinedChannels = await checkMembership(userId);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }

    const gamesCount = await withRetry(async () => {
      const result = await pool.query(
        `SELECT COUNT(*) FROM user_games 
         WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)
         AND deleted_at IS NULL`,
        [userId]
      );
      return result.rows[0].count;
    });

    if (gamesCount >= 10) {
      await ctx.reply(
        "❌ شما نمی‌توانید بیش از 10 بازی انتخاب کنید. برای تغییر لیست از دستور /my_games استفاده کنید.",
        {
          reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
        }
      );
      return;
    }

    searchQuery = searchQuery
      .replace(/\s+/g, "[\\s-]")
      .replace(/[™®]/g, "")
      .replace(/:\s*/g, "");

    const result = await withRetry(async () => {
      return await pool.query(
        "SELECT id, clean_title FROM games WHERE clean_title ~* $1 LIMIT 20",
        [`.*${searchQuery}.*`]
      );
    });

    if (result.rows.length === 0) {
      return await ctx.reply("❌ هیچ بازی‌ای با این نام پیدا نشد.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }

    const keyboard = new InlineKeyboard();
    result.rows.forEach((row) => {
      keyboard.text(row.clean_title, `select_game:${row.id}`).row();
    });
    keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

    await ctx.reply("🔎 لطفاً بازی موردنظرتون رو از لیست انتخاب کنید:", {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Error handling text message:", error);
    throw error;
  }
});

// انتخاب بازی
bot.callbackQuery(/^select_game:(\d+)$/, async (ctx) => {
  try {
    const selectedGameId = ctx.match[1];
    const userId = ctx.from.id;

    const user = await withRetry(async () => {
      return await pool.query("SELECT id FROM users WHERE telegram_id = $1", [userId]);
    });

    if (user.rows.length === 0) {
      return await ctx.reply("❌ اطلاعات شما در ربات ثبت نشده! لطفاً با /start شروع کنید.");
    }

    const internalId = user.rows[0].id;

    // بررسی تکراری نبودن بازی
    const existingGame = await withRetry(async () => {
      return await pool.query(
        "SELECT 1 FROM user_games WHERE user_id = $1 AND game_id = $2 AND deleted_at IS NULL",
        [internalId, selectedGameId]
      );
    });

    if (existingGame.rows.length > 0) {
      await ctx.answerCallbackQuery();
      return await ctx.reply("⚠️ این بازی قبلاً در لیست شما ثبت شده است!");
    }

    // افزودن بازی به لیست کاربر
    await withRetry(async () => {
      await pool.query(
        "INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)",
        [internalId, selectedGameId]
      );
    });

    await updateBotCommands(userId);

    const game = await withRetry(async () => {
      return await pool.query("SELECT clean_title FROM games WHERE id = $1", [selectedGameId]);
    });

    const gameTitle = game.rows[0].clean_title;
    await ctx.answerCallbackQuery();
    await ctx.reply(`✅ بازی **${gameTitle}** به لیست شما اضافه شد.`, {
      parse_mode: "Markdown",
    });

    // نمایش گزینه‌های بعدی
    const keyboard = new InlineKeyboard()
      .text("1) اسم بازی دیگه‌ای رو وارد کنید", "option_1")
      .row()
      .text("2) لیست بازیهای انتخابیتون رو ببینید", "option_2")
      .row();

    if (await hasGames(userId)) {
      keyboard.text("3) کنسولی که میخواید براش بازی تهیه کنید رو انتخاب کنید", "option_3").row();
    }

    keyboard.text("🔙 بازگشت به منو", "back_to_menu");

    await ctx.reply("بازی به لیستتون اضافه شد🙂‍↕️✔️\n\nالان میتونید :👇🏻", {
      reply_markup: keyboard,
    });
  } catch (error) {
    console.error("Error in select_game callback:", error);
    throw error;
  }
});

// هندلر انتخاب کنسول
bot.callbackQuery(/^console:(ps4|ps5)$/, async (ctx) => {
  try {
    const selectedConsole = ctx.match[1];
    const priceColumn = selectedConsole === "ps4" ? "price_ps4" : "price_ps5";
    const userId = ctx.from.id;

    const gamesResult = await withRetry(async () => {
      return await pool.query(
        `SELECT games.id 
         FROM user_games 
         JOIN games ON user_games.game_id = games.id 
         WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)
         AND user_games.deleted_at IS NULL`,
        [userId]
      );
    });

    if (gamesResult.rows.length === 0) {
      return await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }

    const gameIds = gamesResult.rows.map((row) => row.id);

    const postsResult = await withRetry(async () => {
      return await pool.query(
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
    });

    if (postsResult.rows.length === 0) {
      return await ctx.reply("❌ هیچ پستی برای بازی‌های شما یافت نشد.", {
        reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
      });
    }

    // ارسال پست‌ها با تأخیر برای جلوگیری از محدودیت‌های تلگرام
    for (const post of postsResult.rows) {
      await withRetry(async () => {
        await ctx.reply(post.content);
        await new Promise(resolve => setTimeout(resolve, 100)); // تأخیر 100 میلی‌ثانیه بین هر پست
      });
    }

    // پاک کردن لیست بازی‌های کاربر
    await withRetry(async () => {
      await pool.query(
        `UPDATE user_games 
         SET deleted_at = CURRENT_TIMESTAMP 
         WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
        [userId]
      );
    });

    await updateBotCommands(userId);

    await ctx.reply("✅ لیست بازی‌های انتخابی شما پاک شد. می‌توانید دوباره جستجو کنید.", {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
  } catch (error) {
    console.error("Error in console selection:", error);
    throw error;
  }
});

// هندلرهای گزینه‌های مختلف
bot.callbackQuery("option_1", async (ctx) => {
  await ctx.reply("🚩 لطفاً نام بازی مورد نظر خود را وارد کنید:");
  await ctx.answerCallbackQuery();
});

bot.callbackQuery("option_2", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = ctx.from.id;

  const result = await withRetry(async () => {
    return await pool.query(
      `SELECT games.clean_title, games.id 
       FROM user_games 
       JOIN games ON user_games.game_id = games.id 
       WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)
       AND user_games.deleted_at IS NULL`,
      [userId]
    );
  });

  if (result.rows.length === 0) {
    await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
      reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
    });
    return;
  }

  const keyboard = new InlineKeyboard();
  result.rows.forEach((row) => {
    keyboard.text(row.clean_title, `remove_game:${row.id}`).row();
  });
  keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

  await ctx.reply(
    "🕹️ لیست بازی‌های انتخابی شما:\n(با کلیک بر روی نام هر بازی، آن را از لیست خود حذف کنید)",
    { reply_markup: keyboard }
  );
});

bot.callbackQuery("option_3", async (ctx) => {
  const userId = ctx.from.id;

  if (!(await hasGames(userId))) {
    await ctx.answerCallbackQuery({
      text: "❌ ابتدا باید حداقل یک بازی انتخاب کنید!",
      show_alert: true,
    });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("PS4", "console:ps4")
    .text("PS5", "console:ps5")
    .row()
    .text("🔙 بازگشت به منو", "back_to_menu");

  await ctx.reply("🎮 لطفاً کنسول مورد نظر خود را انتخاب کنید:", {
    reply_markup: keyboard,
  });
  await ctx.answerCallbackQuery();
});

// راه‌اندازی بات با مکانیزم retry
async function startBotWithRetry() {
  let retryCount = 0;
  const maxRetries = 5;

  while (retryCount < maxRetries) {
    try {
      await createTables();
      await setupDefaultBotCommands();
      console.log("🤖 Bot is running...");
      await bot.start();
      break;
    } catch (error) {
      console.error(`❌ Error starting bot (attempt ${retryCount + 1}/${maxRetries}):`, error);
      retryCount++;
      if (retryCount < maxRetries) {
        console.log(`Retrying in 5 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        console.error("❌ Failed to start bot after maximum retries");
        process.exit(1);
      }
    }
  }
}

// شروع بات
startBotWithRetry().catch(console.error);

// مدیریت خطاهای پردازش نشده
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
