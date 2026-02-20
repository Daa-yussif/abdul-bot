require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SERVER_URL = process.env.SERVER_URL;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN missing");
  process.exit(1);
}

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('✅ iPhone Bot is running');
});

let bot;

if (SERVER_URL) {
  bot = new TelegramBot(BOT_TOKEN);
  bot.setWebHook(`${SERVER_URL}/bot${BOT_TOKEN}`);
  app.post(`/bot${BOT_TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  bot = new TelegramBot(BOT_TOKEN, { polling: true });
}

// ===== DATA =====
const CONDITIONS = ['🆕 Brand New', '🇬🇧 UK Used iPhone'];
const MODELS = [
  'iPhone 14','iPhone 15','iPhone 16',
  'iPhone 17','iPhone 17 Pro','iPhone 17 Pro Max'
];
const STORAGE = ['128GB','256GB','512GB'];
const COLORS = ['Black','White','Blue'];
const IPHONE_17_COLORS = ['Orange','White','Black'];

const userStates = {};
const orders = {};
let awaitingPriceOrder = null;

// ================= USER MESSAGES =================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text && !msg.photo) return;

  // ===== ADMIN ENTER PRICE =====
  if (chatId.toString() === ADMIN_CHAT_ID && awaitingPriceOrder && text) {
    const order = orders[awaitingPriceOrder];
    if (!order) return;

    order.price = text;

    bot.sendMessage(order.userChatId,
      `✅ Your order (${awaitingPriceOrder}) is available!\n\n💰 Price: GHS ${text}\n\nDo you want to proceed?`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "✅ Yes", callback_data: `yes_${awaitingPriceOrder}` }],
            [{ text: "❌ No", callback_data: `no_${awaitingPriceOrder}` }]
          ]
        }
      }
    );

    bot.sendMessage(chatId, "Price sent to customer ✅");
    awaitingPriceOrder = null;
    return;
  }

  // ===== PAYMENT SCREENSHOT =====
  if (msg.photo) {
    const order = Object.values(orders).find(o => o.awaitingPayment === chatId);
    if (!order) return;

    const fileId = msg.photo[msg.photo.length - 1].file_id;

    bot.sendPhoto(ADMIN_CHAT_ID, fileId, {
      caption: `💳 PAYMENT RECEIVED\nOrder: ${order.orderId}\nCustomer: ${order.name}`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Approve Payment", callback_data: `approve_${order.orderId}` }],
          [{ text: "❌ Reject Payment", callback_data: `reject_${order.orderId}` }]
        ]
      }
    });

    bot.sendMessage(chatId, "⏳ Payment proof sent. Waiting for admin approval.");
    order.awaitingPayment = null;
    return;
  }

  // ===== START =====
  if (/hi|hello|\/start/i.test(text)) {
    userStates[chatId] = { step: 'condition' };
    return bot.sendMessage(chatId,
      `👋 Welcome to our iPhone Shop!\nSelect phone condition:`,
      { reply_markup: { keyboard: chunkArray(CONDITIONS, 2), resize_keyboard: true } }
    );
  }

  const state = userStates[chatId];
  if (!state) return;

  if (state.step === 'condition' && CONDITIONS.includes(text)) {
    state.condition = text;
    state.step = 'model';
    return bot.sendMessage(chatId, 'Select model:', {
      reply_markup: { keyboard: chunkArray(MODELS, 3), resize_keyboard: true }
    });
  }

  if (state.step === 'model' && MODELS.includes(text)) {
    state.model = text;
    state.step = 'storage';
    return bot.sendMessage(chatId, 'Select storage:', {
      reply_markup: { keyboard: chunkArray(STORAGE, 3), resize_keyboard: true }
    });
  }

  if (state.step === 'storage') {
    state.storage = text;
    state.step = 'color';
    const colors = state.model.includes('iPhone 17') ? IPHONE_17_COLORS : COLORS;

    return bot.sendMessage(chatId, 'Pick color:', {
      reply_markup: { keyboard: chunkArray(colors, 3), resize_keyboard: true }
    });
  }

  if (state.step === 'color') {
    state.color = text;
    state.step = 'name';
    return bot.sendMessage(chatId, 'Enter full name:');
  }

  if (state.step === 'name') {
    state.name = text;
    state.step = 'phone';
    return bot.sendMessage(chatId, 'Enter phone number:');
  }

  if (state.step === 'phone') {
    state.phone = text;
    return finalizeOrder(chatId, state);
  }
});

// ================= FINALIZE ORDER =================
function finalizeOrder(chatId, state) {

  const orderId = `ORD-${Date.now()}`;
  orders[orderId] = {
    orderId,
    userChatId: chatId,
    ...state
  };

  const summary = `
🛒 ORDER SUMMARY
Order ID: ${orderId}

Model: ${state.model}
Condition: ${state.condition}
Storage: ${state.storage}
Color: ${state.color}

Name: ${state.name}
Phone: ${state.phone}
  `;

  // Send to customer
  bot.sendMessage(chatId, summary, { reply_markup: { remove_keyboard: true } });

  // Send to admin
  bot.sendMessage(ADMIN_CHAT_ID,
    `📦 NEW ORDER\n${summary}`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Confirm", callback_data: `confirm_${orderId}` }],
          [{ text: "❌ Out of Stock", callback_data: `out_${orderId}` }]
        ]
      }
    }
  );

  delete userStates[chatId];
}

// ================= CALLBACK HANDLER =================
bot.on('callback_query', (query) => {

  const chatId = query.message.chat.id;
  const [action, orderId] = query.data.split('_');
  const order = orders[orderId];
  if (!order) return;

  // ===== ADMIN CONFIRM =====
  if (chatId.toString() === ADMIN_CHAT_ID && action === 'confirm') {
    awaitingPriceOrder = orderId;
    bot.sendMessage(ADMIN_CHAT_ID, `💰 Enter price for order ${orderId}:`);
  }

  if (chatId.toString() === ADMIN_CHAT_ID && action === 'out') {
    bot.sendMessage(order.userChatId,
      `❌ Sorry, your order (${orderId}) is out of stock.`
    );
  }

  // ===== CUSTOMER YES =====
  if (action === 'yes') {
    order.awaitingPayment = order.userChatId;
    bot.sendMessage(order.userChatId,
`💳 Please make payment:

📞 0593827001
Account Name: Daa Yussif

After payment, send screenshot here.`
    );
  }

  // ===== CUSTOMER NO =====
  if (action === 'no') {
    bot.sendMessage(order.userChatId,
      `❌ Order (${orderId}) cancelled.`
    );
  }

  // ===== ADMIN APPROVE PAYMENT =====
  if (chatId.toString() === ADMIN_CHAT_ID && action === 'approve') {

    const finalSummary = `
✅ PAYMENT CONFIRMED

🛒 ORDER DETAILS
Order ID: ${order.orderId}

Model: ${order.model}
Condition: ${order.condition}
Storage: ${order.storage}
Color: ${order.color}

Customer: ${order.name}
Phone: ${order.phone}

💰 Price: GHS ${order.price}

Status: PAID ✅
    `;

    // Send to customer & admin
    bot.sendMessage(order.userChatId, finalSummary);
    bot.sendMessage(ADMIN_CHAT_ID, `📦 ORDER COMPLETED\n${finalSummary}`);
  }

  // ===== ADMIN REJECT PAYMENT =====
  if (chatId.toString() === ADMIN_CHAT_ID && action === 'reject') {
    order.awaitingPayment = order.userChatId;
    bot.sendMessage(order.userChatId,
      `❌ Payment not approved.\nPlease resend correct payment proof for order (${orderId}).`
    );
  }

  bot.answerCallbackQuery(query.id);
});

// ===== HELPER =====
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
