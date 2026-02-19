require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const multer = require('multer'); // for file uploads

// ===== ENV VARIABLES =====
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SERVER_URL = process.env.SERVER_URL; // e.g., https://your-render-app.onrender.com

// ===== EXPRESS SETUP =====
const app = express();
app.use(express.json());

// ===== FILE UPLOAD SETUP =====
const upload = multer({ dest: 'uploads/' });

// ===== TELEGRAM BOT SETUP =====
let bot;
if (SERVER_URL) {
  // Use webhook if SERVER_URL is set
  bot = new TelegramBot(BOT_TOKEN);
  bot.setWebHook(`${SERVER_URL}/bot${BOT_TOKEN}`);
  console.log('🛠 Running in PRODUCTION (Webhook enabled)');
  
  // Webhook endpoint
  app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  // Local development: polling
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🛠 Running in DEVELOPMENT (Polling enabled)');
}

// ===== BOT LOGIC =====
const MODELS = [
  'iPhone XR','iPhone XR Pro','iPhone XR Pro Max',
  'iPhone XS','iPhone XS Pro','iPhone XS Pro Max',
  'iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max',
  'iPhone 12','iPhone 12 Pro','iPhone 12 Pro Max',
  'iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max',
  'iPhone 14','iPhone 14 Pro','iPhone 14 Pro Max',
  'iPhone 15','iPhone 15 Pro','iPhone 15 Pro Max',
  'iPhone 16','iPhone 16 Pro','iPhone 16 Pro Max',
  'iPhone 17','iPhone 17 Pro','iPhone 17 Pro Max'
];
const STORAGE = ['64GB','128GB','256GB','512GB','1TB'];
const COLORS = ['Black','White','Red','Blue','Gold'];

const userStates = {}; // track user steps

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // Start
  if (/hi|hello|\/start/i.test(text)) {
    userStates[chatId] = { step: 'model' };
    return bot.sendMessage(chatId, `👋 Welcome to our iPhone Shop!\nSelect a model:`, {
      reply_markup: { keyboard: chunkArray(MODELS, 4), resize_keyboard: true }
    });
  }

  const state = userStates[chatId];
  if (!state) return;

  // Step 1: Model
  if (state.step === 'model' && MODELS.includes(text)) {
    state.model = text;
    state.step = 'storage';
    return bot.sendMessage(chatId, `Select storage:`, {
      reply_markup: { keyboard: chunkArray(STORAGE, 3), resize_keyboard: true }
    });
  }

  // Step 2: Storage
  if (state.step === 'storage' && STORAGE.includes(text)) {
    state.storage = text;
    state.step = 'color';
    return bot.sendMessage(chatId, `Pick a color:`, {
      reply_markup: { keyboard: chunkArray(COLORS, 3), resize_keyboard: true }
    });
  }

  // Step 3: Color
  if (state.step === 'color') {
    state.color = text;
    state.step = 'name';
    return bot.sendMessage(chatId, `Enter your full name:`);
  }

  // Step 4: Name
  if (state.step === 'name') {
    state.name = text;
    state.step = 'phone';
    return bot.sendMessage(chatId, `Enter your phone number:`);
  }

  // Step 5: Phone
  if (state.step === 'phone') {
    state.phone = text;
    state.step = 'location';
    return bot.sendMessage(chatId, `Enter your location:`);
  }

  // Step 6: Location
  if (state.step === 'location') {
    state.location = text;
    state.step = 'delivery';
    return bot.sendMessage(chatId, `Delivery or Pickup?`, {
      reply_markup: { keyboard: [['🚚 Delivery'], ['🏪 Pickup']], resize_keyboard: true }
    });
  }

  // Step 7: Delivery
  if (state.step === 'delivery') {
    state.delivery = text;
    state.step = 'payment';
    return bot.sendMessage(chatId, `Optional Mobile Money payment:\n📞 0593827001\nAccount Name: Daa Yussif\nSend screenshot and click "Skip" if you don't want to pay now.`, {
      reply_markup: { keyboard: [['Send Screenshot'], ['Skip']], resize_keyboard: true }
    });
  }

  // Step 8: Payment
  if (state.step === 'payment') {
    if (text === 'Skip') {
      state.paymentScreenshot = 'Skipped';
      return finalizeOrder(chatId, state);
    } else if (text === 'Send Screenshot') {
      state.step = 'upload';
      return bot.sendMessage(chatId, `Please upload your payment screenshot as an image:`);
    } else {
      return bot.sendMessage(chatId, `Please choose "Send Screenshot" or "Skip".`);
    }
  }

  // Step 9: Upload
  if (state.step === 'upload' && msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const fileLink = await bot.getFileLink(fileId);
    state.paymentScreenshot = fileLink;
    return finalizeOrder(chatId, state);
  }
});

// ===== FINALIZE ORDER =====
function finalizeOrder(chatId, state) {
  const summary = `
🛒 ORDER SUMMARY
Model: ${state.model}
Storage: ${state.storage}
Color: ${state.color}

Name: ${state.name}
Phone: ${state.phone}
Location: ${state.location}
Delivery: ${state.delivery}
Payment Screenshot: ${state.paymentScreenshot || 'Skipped'}

⚠️ Prices are NOT fixed.
Our sales team will contact you shortly.
  `;
  bot.sendMessage(chatId, summary);
  bot.sendMessage(ADMIN_CHAT_ID, `📦 NEW ORDER\n${summary}`);

  // Reset user for new order
  userStates[chatId] = { step: 'model' };
  bot.sendMessage(chatId, `✅ You can place a new order. Select a model:`, {
    reply_markup: { keyboard: chunkArray(MODELS, 4), resize_keyboard: true }
  });
}

// ===== HELPERS =====
function chunkArray(arr, chunkSize) {
  const result = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    result.push(arr.slice(i, i + chunkSize));
  }
  return result;
}

// ===== START SERVER =====
app.listen(PORT, () => console.log(`🌍 Server running on port ${PORT}`));
