require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ===== ENV VARIABLES =====
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SERVER_URL = process.env.SERVER_URL; // Only needed for webhook
const CHANNEL_ID = process.env.CHANNEL_ID; // Optional for posting story

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !SERVER_URL) {
  console.error("❌ BOT_TOKEN, ADMIN_CHAT_ID, or SERVER_URL missing in .env");
  process.exit(1);
}

// ===== EXPRESS SETUP =====
const app = express();
app.use(express.json());

app.get('/', (req, res) => res.status(200).send('✅ iPhone Bot is running'));

// ===== TELEGRAM BOT SETUP =====
let bot;
bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(`${SERVER_URL}/bot${BOT_TOKEN}`);

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

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

// ===== HELPER: POST TO STORY =====
function postToStory(status) {
  if (CHANNEL_ID) {
    const timestamp = new Date().toLocaleString();
    bot.sendMessage(CHANNEL_ID, `📌 ${status}\n🕒 ${timestamp}`);
  }
}

// ===== HELPER: CHUNK ARRAY FOR KEYBOARD =====
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ===== HELPER: ASK PAYMENT =====
function askPaymentOption(chatId) {
  userStates[chatId].step = 'payment';
  bot.sendMessage(chatId, "💳 Payment is optional. Send screenshot or type 'skip' to continue.", { reply_markup: { keyboard: [['Skip']], resize_keyboard: true } });
}

// ===== HELPER: ASK DELIVERY =====
function askDeliveryOption(chatId) {
  userStates[chatId].step = 'delivery';
  bot.sendMessage(chatId, "🏠 Pickup or Delivery?", { reply_markup: { keyboard: [['Pickup','Delivery']], resize_keyboard: true } });
}

// ===== HELPER: FINAL SUMMARY TO USER =====
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
Delivery type: ${order.deliveryType || 'Pickup'}
Location: ${order.location ? `lat:${order.location.latitude}, long:${order.location.longitude}` : 'N/A'}
💰 Price: GHS ${order.price}
Status: PAID ✅
  `;
  bot.sendMessage(order.userChatId, summary);
  bot.sendMessage(ADMIN_CHAT_ID, `📦 ORDER COMPLETED\n${summary}`);
  postToStory(`Order ${order.orderId} completed for ${order.name}`);
}

// ===== FINALIZE ORDER =====
function finalizeBeforePrice(chatId, state) {
  const orderId = `ORD-${Date.now()}`;
  orders[orderId] = { orderId, userChatId: chatId, ...state, awaitingPrice: true };
  delete userStates[chatId];

  const summary = `
🛒 ORDER SUMMARY
Order ID: ${orderId}
Model: ${state.model}
Condition: ${state.condition}
Storage: ${state.storage}
Color: ${state.color}
Name: ${state.name}
Phone: ${state.phone}
Delivery: ${state.deliveryType || 'Pickup'}
Location: ${state.location ? `lat:${state.location.latitude}, long:${state.location.longitude}` : 'N/A'}
Payment: ${state.paymentScreenshot || 'Skipped'}
⚠️ Prices are NOT fixed. Admin will confirm.
  `;
  bot.sendMessage(chatId, "⏳ Your order is waiting for admin price confirmation.");
  bot.sendMessage(ADMIN_CHAT_ID, `📦 NEW ORDER (Awaiting price)\n${summary}`, {
    reply_markup: { inline_keyboard: [[{ text: "✅ Confirm Order", callback_data: `confirm_${orderId}` }]] }
  });
  postToStory(`New order ${orderId} awaiting price`);
}

// ===== BOT LOGIC =====
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const location = msg.location;

  if (!text && !msg.photo && !location) return;

  if (/hi|hello|\/start/i.test(text) && !userStates[chatId]) {
    userStates[chatId] = { step: 'condition' };
    return bot.sendMessage(chatId, "👋 Welcome! Select phone condition:", { reply_markup: { keyboard: chunkArray(CONDITIONS,2), resize_keyboard: true } });
  }

  const state = userStates[chatId];
  if (!state) return;

  // ===== CONDITION =====
  if (state.step === 'condition' && CONDITIONS.includes(text)) { state.condition = text; state.step='model'; return bot.sendMessage(chatId,'Select model:',{ reply_markup:{keyboard:chunkArray(MODELS,3), resize_keyboard:true }}); }
  // ===== MODEL =====
  if (state.step === 'model' && MODELS.includes(text)) { state.model = text; state.step='storage'; return bot.sendMessage(chatId,'Select storage:',{ reply_markup:{keyboard:chunkArray(STORAGE,3), resize_keyboard:true }}); }
  // ===== STORAGE =====
  if (state.step === 'storage' && STORAGE.includes(text)) { state.storage=text; state.step='color'; const colors=state.model.includes('iPhone 17')?IPHONE_17_COLORS:COLORS; return bot.sendMessage(chatId,'Pick color:',{keyboard:chunkArray(colors,3),resize_keyboard:true}); }
  // ===== COLOR =====
  if (state.step==='color') { state.color=text; state.step='name'; return bot.sendMessage(chatId,'Enter full name:'); }
  // ===== NAME =====
  if (state.step==='name') { state.name=text; state.step='phone'; return bot.sendMessage(chatId,'Enter phone number:'); }
  // ===== PHONE =====
  if (state.step==='phone') { state.phone=text; return askDeliveryOption(chatId); }
  // ===== LOCATION =====
  if (state.step==='location' && location) { state.location=location; return finalizeBeforePrice(chatId,state); }
  // ===== DELIVERY =====
  if (state.step==='delivery') {
    state.deliveryType=text;
    if(text==='Delivery'){ state.step='location'; return bot.sendMessage(chatId,'📍 Please share your location:'); }
    return finalizeBeforePrice(chatId,state);
  }
  // ===== PAYMENT SCREENSHOT (OPTIONAL) =====
  if(state.step==='payment' && msg.photo){
    state.paymentScreenshot=msg.photo[msg.photo.length-1].file_id;
    bot.sendPhoto(ADMIN_CHAT_ID,state.paymentScreenshot,{caption:`💳 PAYMENT RECEIVED\nOrder by ${state.name}`});
    postToStory(`Payment screenshot received from ${state.name}`);
    return finalizeBeforePrice(chatId,state);
  }
  if(state.step==='payment' && text && text.toLowerCase()==='skip'){ state.paymentScreenshot='Skipped'; return finalizeBeforePrice(chatId,state); }
});

// ===== CALLBACK HANDLER =====
bot.on('callback_query',(query)=>{
  const chatId=query.message.chat.id;
  const [action,orderId]=query.data.split('_');
  const order=orders[orderId];
  if(!order) return;

  if(chatId.toString()===ADMIN_CHAT_ID && action==='confirm'){
    order.awaitingPrice=true;
    bot.sendMessage(ADMIN_CHAT_ID,`💰 Enter price for order ${orderId}:`);
  }
});

// ===== START SERVER =====
app.listen(PORT,()=>console.log(`🌍 Server running on port ${PORT}`));