const { Bot, InlineKeyboard, session } = require("grammy");
const { Pool } = require("pg");
const { v4: uuidv4 } = require("uuid");
const { FileAdapter } = require("@grammyjs/storage-file");
require("dotenv").config();

const videoFileId =
  "BAACAgQAAxkBAAIG6mfB9zpAS3Dme5COF9LrtdTfSbIIAAIuFQAC0ZURUjlh8DuJeyNWNgQ";

const tutorialCaption =
  "به اولین ربات جستجوگر بازی خوش آمدید 🤖👋🏻\n\n" +
  "1) با استارت ربات شما میتونید یک یا چند بازی رو انتخاب کنید🤞🏻\n\n" +
  "2) سپس شما میتونید کنسول مورد نظرتون رو انتخاب کنید 😎\n\n" +
  "3) و در اخر بات بین 2000 اکانت جستجو کرده و اکانت هایی که بازی های مد نظر شما رو دارند برای شما ارسال میکنه 🔥🫡\n\n";

// اتصال به دیتابیس PostgreSQL
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const bot = new Bot(process.env.BOT_TOKEN);

// اضافه کردن middleware session
bot.use(
  session({
    initial: () => ({ selectedGameToRemove: null }),
    storage: new FileAdapter(),
  })
);

// تعریف کانال‌ها
const requiredChannels = [
  { id: "-1001069711199", invite_link: "https://t.me/+SpQ0e29I2d05Yzg0" },
  { id: "-1001010895977", invite_link: "https://t.me/+PEEMaXuNHvpcoPcU" },
  { id: "-1001119154763", invite_link: "https://t.me/+ihfK56m0tckwODM0" },
  { id: "-1001056044991", invite_link: "https://t.me/+_WbXvrPeM6RmNWQ0" },
  { id: "-1001219426374", invite_link: "https://t.me/+PLvYzP0XwGs1Nzdk" },
  { id: "-1001066763571", invite_link: "https://t.me/CA_Storre" },
];

// تابع بروزرسانی منوی دکمه‌ای تلگرام بر اساس وضعیت کاربر
async function updateBotCommands(userId) {
  try {
    // بررسی تعداد بازی‌های انتخاب شده
    const gamesCount = await pool.query(
      `SELECT COUNT(*) FROM user_games 
       WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
      [userId]
    );

    const hasGames = gamesCount.rows[0].count > 0;

    // دستورات پایه که همیشه نمایش داده می‌شوند
    const baseCommands = [
      { command: "start", description: "شروع مجدد ربات" },
      { command: "menu", description: "نمایش منوی اصلی" },
      { command: "search_games", description: "جستجوی بازی" },
      { command: "my_games", description: "لیست بازی‌های من" },
    ];

    // اگر کاربر بازی انتخاب کرده باشد، دستور انتخاب کنسول را نیز نمایش می‌دهیم
    if (hasGames) {
      baseCommands.push({
        command: "select_console",
        description: "انتخاب کنسول",
      });
    }

    // دستورات اضافی
    baseCommands.push({
      command: "tutorial",
      description: "آموزش استفاده از ربات",
    });

    // تنظیم دستورات برای کاربر خاص
    await bot.api.setMyCommands(baseCommands, {
      scope: { type: "chat", chat_id: userId },
    });

    return true;
  } catch (error) {
    console.error("❌ خطا در بروزرسانی منوی دستورات:", error);
    return false;
  }
}

// تنظیم منوی دستورات پیش‌فرض ربات
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

    console.log("✅ جداول ایجاد یا بررسی شدند.");
  } catch (error) {
    console.error("❌ خطا در ایجاد جداول:", error);
  }
}

// بررسی عضویت در کانال‌ها
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

// تابع کمکی برای بررسی وجود بازی در لیست کاربر
async function hasGames(userId) {
  const gamesCount = await pool.query(
    `SELECT COUNT(*) FROM user_games 
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
    [userId]
  );
  return gamesCount.rows[0].count > 0;
}

// تابع نمایش منوی کامل با بررسی وضعیت لیست بازی‌ها
async function showFullMenu(ctx) {
  const userId = ctx.from.id;

  // بررسی تعداد بازی‌های انتخاب شده
  const hasGamesValue = await hasGames(userId);

  const mainKeyboard = new InlineKeyboard()
    .text("🎲 جستجوی بازی", "search_games")
    .row()
    .text("📋 لیست بازی‌های من", "my_games_list")
    .row();

  // نمایش دکمه انتخاب کنسول فقط اگر کاربر بازی انتخاب کرده باشد
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
}

// اصلاح دستور استارت
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

    // بررسی عضویت در کانال‌ها
    const notJoinedChannels = await checkMembership(user.id);
    if (notJoinedChannels.length > 0) {
      await showJoinMessage(ctx, notJoinedChannels);
      return;
    }

    // بروزرسانی منوی دکمه‌ای
    await updateBotCommands(user.id);

    await ctx.reply(
      `سلام ${user.first_name}! 👋 به ربات جستجوی بازی خوش اومدی.`
    );
    await showFullMenu(ctx);
  } catch (error) {
    console.error("❌ خطا در ذخیره اطلاعات کاربر:", error);
    await ctx.reply("مشکلی پیش آمد. لطفاً دوباره امتحان کن.");
  }
});

// تابع نمایش پیام عضویت در کانال‌ها
async function showJoinMessage(ctx, notJoinedChannels) {
  const keyboard = new InlineKeyboard();

  // اضافه کردن دکمه برای هر کانال
  notJoinedChannels.forEach((channel) => {
    keyboard.url(`📢 ${channel.title}`, channel.link).row();
  });

  // اضافه کردن دکمه "عضو شدم"
  keyboard.text("✅ عضو شدم", "check_membership");

  await ctx.reply(
    "🚩 لطفاً ابتدا در کانال‌های زیر عضو شوید و سپس روی دکمه «عضو شدم» کلیک کنید:",
    { reply_markup: keyboard }
  );
}

// دستور منو
bot.command("menu", async (ctx) => {
  // بررسی عضویت در کانال‌ها
  const notJoinedChannels = await checkMembership(ctx.from.id);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }
  await showFullMenu(ctx);
});

// دستور جستجوی بازی
bot.command("search_games", async (ctx) => {
  // بررسی عضویت در کانال‌ها
  const notJoinedChannels = await checkMembership(ctx.from.id);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }
  await ctx.reply("🚩 لطفاً نام بازی مورد نظر خود را وارد کنید:");
});

// دستور آموزش
bot.command("tutorial", async (ctx) => {
  // بررسی عضویت در کانال‌ها
  const notJoinedChannels = await checkMembership(ctx.from.id);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }

  try {
    // await ctx.reply("🎥 ویدیوی آموزش استفاده از ربات:");
    await ctx.replyWithVideo(videoFileId, {
      caption: tutorialCaption,
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  } catch (error) {
    // اگر ویدیو موجود نباشد، فقط متن راهنما را نمایش می‌دهیم
    await ctx.reply(tutorialCaption, {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  }
});

// هندلر دکمه "عضو شدم"
bot.callbackQuery("check_membership", async (ctx) => {
  const userId = ctx.from.id;

  // بررسی مجدد عضویت
  const notJoinedChannels = await checkMembership(userId);

  if (notJoinedChannels.length === 0) {
    // اگر در همه کانال‌ها عضو شده باشد
    await ctx.answerCallbackQuery({
      text: "✅ عضویت شما تایید شد!",
      show_alert: true,
    });
    await ctx.reply(`سلام ${ctx.from.first_name}! 👋 خوش اومدی.`);

    // بروزرسانی منوی دکمه‌ای
    await updateBotCommands(userId);

    await showFullMenu(ctx);
  } else {
    // اگر هنوز در همه کانال‌ها عضو نشده باشد
    await ctx.answerCallbackQuery({
      text: "❌ هنوز در همه کانال‌ها عضو نشده‌اید!",
      show_alert: true,
    });
    await showJoinMessage(ctx, notJoinedChannels);
  }
});

// ✅ دریافت بازی‌های انتخاب‌شده
bot.command("my_games", async (ctx) => {
  const userId = ctx.from.id;

  // بررسی عضویت در کانال‌ها
  const notJoinedChannels = await checkMembership(userId);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }

  const result = await pool.query(
    `SELECT games.clean_title, games.id 
     FROM user_games 
     JOIN games ON user_games.game_id = games.id 
     WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
    [userId]
  );

  if (result.rows.length === 0) {
    return await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
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

// ارسال دکمه‌های انتخاب کنسول
bot.command("select_console", async (ctx) => {
  const userId = ctx.from.id;

  // بررسی عضویت در کانال‌ها
  const notJoinedChannels = await checkMembership(userId);
  if (notJoinedChannels.length > 0) {
    await showJoinMessage(ctx, notJoinedChannels);
    return;
  }

  // بررسی تعداد بازی‌های انتخاب شده
  const hasGamesValue = await hasGames(userId);

  if (!hasGamesValue) {
    return await ctx.reply(
      "❌ ابتدا باید حداقل یک بازی به لیست خود اضافه کنید.",
      {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      }
    );
  }

  const keyboard = new InlineKeyboard()
    .text("PS4", "console:ps4")
    .text("PS5", "console:ps5")
    .row()
    .text("🔙 بازگشت به منو", "back_to_menu");

  await ctx.reply("🎮 لطفاً کنسول مورد نظر خود را انتخاب کنید:", {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(/^console:(ps4|ps5)$/, async (ctx) => {
  const selectedConsole = ctx.match[1]; // دریافت "ps4" یا "ps5"
  const priceColumn = selectedConsole === "ps4" ? "price_ps4" : "price_ps5"; // تعیین ستون مناسب
  const userId = ctx.from.id;

  try {
    // دریافت لیست بازی‌های انتخاب‌شده‌ی کاربر
    const gamesResult = await pool.query(
      `SELECT games.id 
       FROM user_games 
       JOIN games ON user_games.game_id = games.id 
       WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
      [userId]
    );

    if (gamesResult.rows.length === 0) {
      return await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      });
    }

    const gameIds = gamesResult.rows.map((row) => row.id);

    // چک کنیم که آرایه خالی نباشد و اعداد صحیح باشند
    if (gameIds.length === 0) {
      return await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      });
    }

    // جستجوی پست‌های مرتبط با بازی‌ها و کنسول انتخابی
    const postsResult = await pool.query(
      `SELECT p.content 
       FROM games_posts 
       JOIN posts p ON p.id = games_posts.post_id 
       WHERE game_id = ANY($1) 
       AND ${priceColumn} IS NOT NULL 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [gameIds] // ارسال آرایه به عنوان پارامتر
    );

    if (postsResult.rows.length === 0) {
      return await ctx.reply("❌ هیچ پستی برای بازی‌های شما یافت نشد.", {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      });
    }

    for (const post of postsResult.rows) {
      await ctx.reply(post.content);
    }

    // 🛑 حذف لیست بازی‌های کاربر از دیتابیس
    await pool.query(
      `DELETE FROM user_games 
      WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
      [userId]
    );

    // بروزرسانی منوی دکمه‌ای
    await updateBotCommands(userId);

    await ctx.reply(
      "✅ لیست بازی‌های انتخابی شما پاک شد. می‌توانید دوباره جستجو کنید.",
      {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      }
    );
  } catch (error) {
    console.error("❌ خطا در دریافت پست‌ها:", error);
    await ctx.reply("مشکلی پیش آمد. لطفاً دوباره امتحان کنید.", {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  }
});

// ✅ هندل حذف بازی
bot.callbackQuery(/^remove_game:(\d+)$/, async (ctx) => {
  const gameId = ctx.match[1];
  const userId = ctx.from.id;

  await pool.query(
    "DELETE FROM user_games WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1) AND game_id = $2",
    [userId, gameId]
  );

  await ctx.answerCallbackQuery({ text: "✅ بازی از لیست شما حذف شد." });

  // بروزرسانی منوی دکمه‌ای
  await updateBotCommands(userId);

  // نمایش مجدد لیست بازی‌ها
  const result = await pool.query(
    `SELECT games.clean_title, games.id 
     FROM user_games 
     JOIN games ON user_games.game_id = games.id 
     WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
    [userId]
  );

  if (result.rows.length === 0) {
    await ctx.reply("❌ لیست بازی‌های شما خالی شد.", {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  } else {
    const keyboard = new InlineKeyboard();
    result.rows.forEach((row) => {
      keyboard.text(row.clean_title, `remove_game:${row.id}`).row();
    });

    keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

    await ctx.reply(
      "🕹️ لیست بازی‌های انتخابی شما:\n(با کلیک بر روی نام هر بازی، آن را از لیست خود حذف کنید)",
      { reply_markup: keyboard }
    );
  }
});

// اضافه کردن هندلر برای دکمه جستجوی بازی
bot.callbackQuery("search_games", async (ctx) => {
  await ctx.reply("🚩 لطفاً نام بازی مورد نظر خود را وارد کنید:");
  await ctx.answerCallbackQuery();
});

// اضافه کردن هندلر برای دکمه لیست بازی‌ها
bot.callbackQuery("my_games_list", async (ctx) => {
  // اجرای همان کد my_games
  const userId = ctx.from.id;

  const result = await pool.query(
    `SELECT games.clean_title, games.id 
     FROM user_games 
     JOIN games ON user_games.game_id = games.id 
     WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
    [userId]
  );

  if (result.rows.length === 0) {
    await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  } else {
    const keyboard = new InlineKeyboard();
    result.rows.forEach((row) => {
      keyboard.text(row.clean_title, `remove_game:${row.id}`).row();
    });

    keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

    await ctx.reply(
      "🕹️ لیست بازی‌های انتخابی شما:\n(با کلیک بر روی نام هر بازی، آن را از لیست خود حذف کنید)",
      { reply_markup: keyboard }
    );
  }

  await ctx.answerCallbackQuery();
});

// هندلر برای دکمه انتخاب کنسول از منو
bot.callbackQuery("select_console_menu", async (ctx) => {
  const userId = ctx.from.id;

  // بررسی تعداد بازی‌های انتخاب شده
  const hasGamesValue = await hasGames(userId);

  if (!hasGamesValue) {
    await ctx.answerCallbackQuery({
      text: "❌ ابتدا باید حداقل یک بازی انتخاب کنید!",
      show_alert: true,
    });
    return await ctx.reply(
      "❌ شما هنوز هیچ بازی‌ای انتخاب نکرده‌اید. ابتدا باید حداقل یک بازی به لیست خود اضافه کنید.",
      {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      }
    );
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

// هندلر برای بازگشت به منوی اصلی
bot.callbackQuery("back_to_menu", async (ctx) => {
  await showFullMenu(ctx);
  await ctx.answerCallbackQuery();
});

// هندلر برای نمایش راهنمای دستورات
bot.callbackQuery("commands_help", async (ctx) => {
  let helpText =
    "📚 *راهنمای دستورات ربات* 📚\n\n" +
    "🔹 `/start` - شروع کار با ربات\n" +
    "🔹 `/menu` - نمایش منوی اصلی\n" +
    "🔹 `/search_games` - جستجوی بازی\n" +
    "🔹 `/my_games` - مشاهده لیست بازی‌های من\n";

  // اگر کاربر بازی انتخاب کرده باشد، دستور انتخاب کنسول را نیز نمایش می‌دهیم
  if (await hasGames(ctx.from.id)) {
    helpText += "🔹 `/select_console` - انتخاب کنسول برای جستجوی بازی‌ها\n";
  }

  helpText +=
    "🔹 `/tutorial` - آموزش استفاده از ربات\n\n" +
    "💡 *نحوه استفاده:*\n" +
    "1️⃣ ابتدا نام بازی مورد نظر خود را تایپ کنید\n" +
    "2️⃣ از لیست پیشنهادی، بازی مورد نظر را انتخاب کنید\n" +
    "3️⃣ تا 10 بازی می‌توانید به لیست خود اضافه کنید\n" +
    "4️⃣ سپس کنسول مورد نظر (PS4 یا PS5) را انتخاب کنید\n" +
    "5️⃣ پست‌های مرتبط با بازی‌های شما نمایش داده خواهد شد";

  await ctx.reply(helpText, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("🔙 بازگشت به منو", "back_to_menu"),
  });

  await ctx.answerCallbackQuery();
});

bot.callbackQuery("tutorial", async (ctx) => {
  try {
    // await ctx.reply("🎥 ویدیوی آموزش استفاده از ربات:");
    await ctx.replyWithVideo(videoFileId, {
      caption: tutorialCaption,
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  } catch (error) {
    // اگر ویدیو موجود نباشد، فقط متن راهنما را نمایش می‌دهیم
    await ctx.reply(tutorialCaption, {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  }

  await ctx.answerCallbackQuery();
});

// ✅ جستجوی بازی‌ها
bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  let searchQuery = ctx.message.text.trim();

  // بررسی عضویت در کانال‌ها
  const notJoinedChannels = await checkMembership(userId);
  if (notJoinedChannels.length > 0) {
    const inviteMessage =
      "❌ لطفاً ابتدا در کانال‌های زیر عضو شوید:\n\n" +
      notJoinedChannels
        .map((channel) => `🔹 [${channel.title}](${channel.link})`)
        .join("\n");

    await ctx.reply(inviteMessage, { parse_mode: "Markdown" });
    return;
  }

  // بررسی تعداد بازی‌های انتخاب شده
  const gamesCount = await pool.query(
    `SELECT COUNT(*) FROM user_games 
     WHERE user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
    [userId]
  );

  if (gamesCount.rows[0].count >= 10) {
    await ctx.reply(
      "❌ شما نمی‌توانید بیش از 10 بازی انتخاب کنید. برای تغییر لیست از دستور /my_games استفاده کنید.",
      {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      }
    );
    return;
  }

  searchQuery = searchQuery.replace(/\s+/g, "[\\s-]").replace(/[™®]/g, "").replace(/:\s*/g, "");
  // جستجوی بازی در دیتابیس
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
      return ctx.reply("❌ هیچ بازی‌ای با این نام پیدا نشد.", {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      });
    }
  }

  const keyboard = new InlineKeyboard();
  result.rows.forEach((row) => {
    keyboard.text(row.clean_title, `select_game:${row.id}`).row();
  });

  keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

  await ctx.reply("🔎 لطفاً بازی موردنظرتون رو از لیست انتخاب کنید:", {
    reply_markup: keyboard,
  });
});

bot.callbackQuery(/^select_game:(\d+)$/, async (ctx) => {
  const selectedGameId = ctx.match[1];
  const userId = ctx.from.id;

  // دریافت user_id از جدول users
  const user = await pool.query("SELECT id FROM users WHERE telegram_id = $1", [
    userId,
  ]);
  if (user.rows.length === 0) {
    return await ctx.reply(
      "❌ اطلاعات شما در ربات ثبت نشده! لطفاً با /start شروع کنید."
    );
  }

  const internalId = user.rows[0].id;

  // چک کردن تکراری نبودن بازی
  const existingGame = await pool.query(
    "SELECT 1 FROM user_games WHERE user_id = $1 AND game_id = $2",
    [internalId, selectedGameId]
  );

  if (existingGame.rows.length > 0) {
    await ctx.answerCallbackQuery();
    return await ctx.reply("⚠️ این بازی قبلاً در لیست شما ثبت شده است!");
  }

  // ذخیره انتخاب بازی در دیتابیس
  await pool.query(
    "INSERT INTO user_games (user_id, game_id) VALUES ($1, $2)",
    [internalId, selectedGameId]
  );

  // بروزرسانی منوی دکمه‌ای
  await updateBotCommands(userId);

  // دریافت عنوان بازی برای نمایش به کاربر
  const game = await pool.query("SELECT clean_title FROM games WHERE id = $1", [
    selectedGameId,
  ]);
  const gameTitle = game.rows[0].clean_title;

  await ctx.answerCallbackQuery();
  await ctx.reply(`✅ بازی **${gameTitle}** به لیست شما اضافه شد.`, {
    parse_mode: "Markdown",
  });

  // بررسی تعداد بازی‌های انتخاب شده برای نمایش گزینه‌های مناسب
  const hasGamesValue = await hasGames(userId);

  // ایجاد کیبورد با گزینه‌های مناسب
  const keyboard = new InlineKeyboard()
    .text("1) اسم بازی دیگه‌ای رو وارد کنید", "option_1")
    .row()
    .text("2) لیست بازیهای انتخابیتون رو ببینید", "option_2")
    .row();

  // نمایش گزینه انتخاب کنسول فقط اگر حداقل یک بازی انتخاب شده باشد
  if (hasGamesValue) {
    keyboard
      .text(
        "3) کنسولی که میخواید براش بازی تهیه کنید رو انتخاب کنید",
        "option_3"
      )
      .row();
  }

  keyboard.text("🔙 بازگشت به منو", "back_to_menu");

  await ctx.reply(" بازی به لیستتون اضافه شد🙂‍↕️✔️\n\n" + "الان میتونید :👇🏻", {
    reply_markup: keyboard,
  });
});

// هندلر گزینه 1
bot.callbackQuery("option_1", async (ctx) => {
  await ctx.reply("🚩 لطفاً نام بازی مورد نظر خود را وارد کنید:");
  await ctx.answerCallbackQuery();
});

// هندلر گزینه 2
bot.callbackQuery("option_2", async (ctx) => {
  const userId = ctx.from.id;

  const result = await pool.query(
    `SELECT games.clean_title, games.id 
     FROM user_games 
     JOIN games ON user_games.game_id = games.id 
     WHERE user_games.user_id = (SELECT id FROM users WHERE telegram_id = $1)`,
    [userId]
  );

  if (result.rows.length === 0) {
    await ctx.reply("❌ شما هیچ بازی‌ای انتخاب نکرده‌اید.", {
      reply_markup: new InlineKeyboard().text(
        "🔙 بازگشت به منو",
        "back_to_menu"
      ),
    });
  } else {
    const keyboard = new InlineKeyboard();
    result.rows.forEach((row) => {
      keyboard.text(row.clean_title, `remove_game:${row.id}`).row();
    });

    keyboard.text("🔙 بازگشت به منو", "back_to_menu").row();

    await ctx.reply(
      "🕹️ لیست بازی‌های انتخابی شما:\n(با کلیک بر روی نام هر بازی، آن را از لیست خود حذف کنید)",
      { reply_markup: keyboard }
    );
  }

  await ctx.answerCallbackQuery();
});

// هندلر گزینه 3
bot.callbackQuery("option_3", async (ctx) => {
  const userId = ctx.from.id;

  // بررسی تعداد بازی‌های انتخاب شده
  const hasGamesValue = await hasGames(userId);

  if (!hasGamesValue) {
    await ctx.answerCallbackQuery({
      text: "❌ ابتدا باید حداقل یک بازی انتخاب کنید!",
      show_alert: true,
    });
    return await ctx.reply(
      "❌ شما هنوز هیچ بازی‌ای انتخاب نکرده‌اید. ابتدا باید حداقل یک بازی به لیست خود اضافه کنید.",
      {
        reply_markup: new InlineKeyboard().text(
          "🔙 بازگشت به منو",
          "back_to_menu"
        ),
      }
    );
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

// شروع ربات
async function startBot() {
  await createTables();
  await setupDefaultBotCommands();
  console.log("🤖 ربات در حال اجراست...");
  bot.start();
}

startBot();
