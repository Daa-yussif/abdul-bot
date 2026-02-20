require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ===== ENV VARIABLES =====
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SERVER_URL = process.env.SERVER_URL;
const CHANNEL_ID = process.env.CHANNEL_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !SERVER_URL || !CHANNEL_ID) {
  console.error("❌ BOT_TOKEN, ADMIN_CHAT_ID, SERVER_URL, or CHANNEL_ID missing in .env");
  process.exit(1);
}

// ===== EXPRESS APP =====
const app = express();
app.use(express.json());
app.get('/', (req, res) => res.status(200).send('✅ iPhone Bot is running'));

// ===== TELEGRAM BOT (WEBHOOK MODE) =====
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(`${SERVER_URL}/bot${BOT_TOKEN}`);
app.post(`/bot${BOT_TOKEN}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
console.log(`🔹 Bot webhook set to: ${SERVER_URL}/bot${BOT_TOKEN}`);

// ===== DATA =====
const CONDITIONS = ['🆕 Brand New', '🇬🇧 UK Used iPhone'];
const MODELS = [
  'iPhone 7','iPhone 7 Plus','iPhone 8','iPhone 8 Plus','iPhone X','iPhone XR','iPhone XS','iPhone XS Max',
  'iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max','iPhone 12','iPhone 12 Pro','iPhone 12 Pro Max',
  'iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max','iPhone 14','iPhone 14 Pro','iPhone 14 Pro Max',
  'iPhone 15','iPhone 15 Pro','iPhone 15 Pro Max','iPhone 16','iPhone 16 Pro','iPhone 16 Pro Max',
  'iPhone 17','iPhone 17 Pro','iPhone 17 Pro Max'
];
const STORAGE = ['128GB','256GB','512GB'];
const COLORS = ['Black','White','Blue'];
const IPHONE_17_COLORS = ['Orange','White','Black'];

const userStates = {};
const orders = {};

// ===== HELPER: POST TO CHANNEL STORY =====
function postToStory(status) {
  const timestamp = new Date().toLocaleString();
  bot.sendMessage(CHANNEL_ID, `📌 ${status}\n🕒 ${timestamp}`);
}

// ===== HELPER: CHUNK ARRAY FOR KEYBOARD =====
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ================= USER MESSAGES =================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const location = msg.location;
  const state = userStates[chatId];

  if (!text && !msg.photo && !location) return;

  // ===== START =====
  if (/hi|hello|\/start/i.test(text) && !state) {
    userStates[chatId] = { step: 'condition' };
    return bot.sendMessage(chatId, `👋 Welcome! Select phone condition:`, { reply_markup: { keyboard: chunkArray(CONDITIONS,2), resize_keyboard: true } });
  }
  if (!state) return;

  // ===== ORDER FLOW =====
  if (state.step === 'condition' && CONDITIONS.includes(text)) { state.condition = text; state.step = 'model'; return bot.sendMessage(chatId, 'Select model:', { reply_markup: { keyboard: chunkArray(MODELS,3), resize_keyboard: true } }); }
  if (state.step === 'model' && MODELS.includes(text)) { state.model = text; state.step = 'storage'; return bot.sendMessage(chatId, 'Select storage:', { reply_markup: { keyboard: chunkArray(STORAGE,3), resize_keyboard: true } }); }
  if (state.step === 'storage') { state.storage = text; state.step = 'color'; const colors = state.model.includes('iPhone 17') ? IPHONE_17_COLORS : COLORS; return bot.sendMessage(chatId, 'Pick color:', { reply_markup: { keyboard: chunkArray(colors,3), resize_keyboard: true } }); }
  if (state.step === 'color') { state.color = text; state.step = 'name'; return bot.sendMessage(chatId, 'Enter full name:'); }
  if (state.step === 'name') { state.name = text; state.step = 'phone'; return bot.sendMessage(chatId, 'Enter phone number:'); }
  if (state.step === 'phone') { state.phone = text; return askPaymentOption(chatId); }

  // ===== PAYMENT SCREENSHOT (OPTIONAL) =====
  if (msg.photo && state.step === 'payment') {
    state.paymentScreenshot = msg.photo[msg.photo.length-1].file_id;
    bot.sendPhoto(ADMIN_CHAT_ID, state.paymentScreenshot, { caption: `💳 PAYMENT RECEIVED\nOrder by ${state.name}` });
    bot.sendMessage(chatId, "✅ Screenshot received by admin.");
    postToStory(`Payment screenshot received from ${state.name}`);
    state.step = 'delivery';
    return askDeliveryOption(chatId);
  }

  // ===== SKIP PAYMENT =====
  if (text && text.toLowerCase() === 'skip' && state.step === 'payment') { state.step = 'delivery'; return askDeliveryOption(chatId); }

  // ===== DELIVERY OR PICKUP =====
  if (state.step === 'delivery' && (text === 'Pickup' || text === 'Delivery')) {
    state.deliveryType = text;
    if (text === 'Delivery') { state.step = 'location'; return bot.sendMessage(chatId, '📍 Please share your location:', { reply_markup: { keyboard: [['Send Location']], resize_keyboard: true } }); }
    return finalizeBeforePrice(chatId, state);
  }

  // ===== LOCATION FOR DELIVERY =====
  if (location && state.step === 'location') { state.location = location; return finalizeBeforePrice(chatId, state); }

  // ===== ADMIN ENTER PRICE =====
  if (chatId.toString() === ADMIN_CHAT_ID && text) {
    const pendingOrder = Object.values(orders).find(o => o.awaitingPrice);
    if (pendingOrder) {
      pendingOrder.price = text;
      pendingOrder.awaitingPrice = false;
      bot.sendMessage(pendingOrder.userChatId, `✅ Price set: GHS ${text}`);
      postToStory(`Price set for order ${pendingOrder.orderId}`);
      sendFinalSummary(pendingOrder);
    }
  }
});

// ===== ASK PAYMENT OPTION =====
function askPaymentOption(chatId) {
  userStates[chatId].step = 'payment';
  bot.sendMessage(chatId, "💳 Payment is optional. Send screenshot or type 'skip' to continue.", { reply_markup: { keyboard: [['skip']], resize_keyboard: true } });
}

// ===== ASK DELIVERY OR PICKUP =====
function askDeliveryOption(chatId) {
  userStates[chatId].step = 'delivery';
  bot.sendMessage(chatId, "🏠 Pickup or Delivery?", { reply_markup: { keyboard: [['Pickup','Delivery']], resize_keyboard: true } });
}

// ===== SAVE ORDER AND WAIT FOR ADMIN PRICE =====
function finalizeBeforePrice(chatId, state) {
  const orderId = `ORD-${Date.now()}`;
  orders[orderId] = { orderId, userChatId: chatId, ...state, awaitingPrice: true };
  delete userStates[chatId];

  let summary = `
🛒 ORDER SUMMARY
Order ID: ${orderId}
Model: ${state.model}
Condition: ${state.condition}
Storage: ${state.storage}
Color: ${state.color}
Name: ${state.name}
Phone: ${state.phone}
Delivery type: ${state.deliveryType}
Location: ${state.location ? `lat:${state.location.latitude}, long:${state.location.longitude}` : 'N/A'}
  `;
  bot.sendMessage(chatId, "⏳ Your order is waiting for admin price confirmation.");
  bot.sendMessage(ADMIN_CHAT_ID, `📦 NEW ORDER (Awaiting price)\n${summary}`, {
    reply_markup: { inline_keyboard: [[{ text: "✅ Confirm Order", callback_data: `confirm_${orderId}` }]] }
  });
  postToStory(`New order ${orderId} awaiting price`);
}

// ===== SEND FINAL SUMMARY TO USER =====
function sendFinalSummary(order) {
  const summary = `
✅ ORDER CONFIRMED
🛒 ORDER DETAILS
Order ID: ${order.orderId}
Model: ${order.model}
Condition: ${order.condition}
Storage: ${order.storage}
Color: ${order.color}
Customer: ${order.name}
Phone: ${order.phone}
Delivery type: ${order.deliveryType}
Location: ${order.location ? `lat:${order.location.latitude}, long:${order.location.longitude}` : 'N/A'}
💰 Price: GHS ${order.price}
Status: PAID ✅
  `;
  bot.sendMessage(order.userChatId, summary);
  bot.sendMessage(ADMIN_CHAT_ID, `📦 ORDER COMPLETED\n${summary}`);
  postToStory(`Order ${order.orderId} completed for ${order.name}`);
}

// ===== CALLBACK HANDLER =====
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const [action, orderId] = query.data.split('_');
  const order = orders[orderId];
  if (!order) return;

  if (chatId.toString() === ADMIN_CHAT_ID && action === 'confirm') {
    bot.sendMessage(ADMIN_CHAT_ID, `💰 Enter price for order ${orderId}:`);
  }
  bot.answerCallbackQuery(query.id);
});

// ===== START SERVER =====
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));