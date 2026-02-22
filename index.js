require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ===== ENV VARIABLES =====
const PORT = process.env.PORT || 10000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const SERVER_URL = process.env.SERVER_URL;

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !SERVER_URL) {
  console.error("❌ BOT_TOKEN, ADMIN_CHAT_ID, or SERVER_URL missing in .env");
  process.exit(1);
}

// ===== EXPRESS APP =====
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).send('✅ iPhone Bot is running');
});

// ===== TELEGRAM BOT (WEBHOOK MODE) =====
const bot = new TelegramBot(BOT_TOKEN);
bot.setWebHook(`${SERVER_URL}/bot${BOT_TOKEN}`);

app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

console.log(`🔹 Bot webhook set to: ${SERVER_URL}/bot${BOT_TOKEN}`);

// ===== DATA =====
const CONDITIONS = ['🆕 Brand New', '🇬🇧 UK Used iPhone'];
const MODELS = [
  'iPhone 7','iPhone 7 Plus','iPhone 8','iPhone 8 Plus',
  'iPhone X','iPhone XR','iPhone XS','iPhone XS Max',
  'iPhone 11','iPhone 11 Pro','iPhone 11 Pro Max',
  'iPhone 12','iPhone 12 Pro','iPhone 12 Pro Max',
  'iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max',
  'iPhone 14','iPhone 14 Pro','iPhone 14 Pro Max',
  'iPhone 15','iPhone 15 Pro','iPhone 15 Pro Max',
  'iPhone 16','iPhone 16 Pro','iPhone 16 Pro Max',
  'iPhone 17','iPhone 17 Pro','iPhone 17 Pro Max'
];
const STORAGE = ['32GB','64GB','128GB','256GB','512GB','1TB'];
const COLORS = ['Black','White','Red'];

const SHOP_LOCATION = "OBUASI OPPOSITE SARK MOMO SHOP";

const userStates = {};
const orders = {};

// ================= USER MESSAGES =================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text && !msg.photo && !msg.location) return;
  const state = userStates[chatId];

  // ===== ADMIN ENTER PRICE / REJECT REASON =====
  if (chatId.toString() === ADMIN_CHAT_ID && text) {
    const pendingOrder = Object.values(orders).find(o => o.awaitingPrice);
    const pendingReject = Object.values(orders).find(o => o.awaitingRejectReason);
    if (pendingOrder) {
      pendingOrder.price = text;
      pendingOrder.awaitingPrice = false;
      pendingOrder.status = 'confirmed'; 
      sendOrderToUserForConfirmation(pendingOrder);
      bot.sendMessage(ADMIN_CHAT_ID, `💚 Price sent for order ${pendingOrder.orderId}`);
      return;
    }
    if (pendingReject) {
      pendingReject.rejectReason = text;
      pendingReject.awaitingRejectReason = false;
      bot.sendMessage(pendingReject.userChatId, `❌ Payment rejected. Reason: ${text}\nYou can retry or skip.`);
      return;
    }
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

  // ===== LOCATION SHARING =====
  if (msg.location && state?.step === 'delivery') {
    const order = Object.values(orders).find(o => o.userChatId === chatId && o.awaitingLocation);
    if (!order) return;
    order.awaitingLocation = null;
    order.location = msg.location;

    bot.sendMessage(ADMIN_CHAT_ID,
      `📍 Delivery location for order ${order.orderId}:\n[View on Map](https://www.google.com/maps?q=${msg.location.latitude},${msg.location.longitude})`,
      { parse_mode: 'Markdown' }
    );

    bot.sendMessage(chatId, "✅ Location received! Your order is confirmed.");
    sendNewOrderButton(chatId);
    return;
  }

  // ===== START / WELCOME =====
  if (!state && /hi|hello|hey|\/start/i.test(text)) {
    userStates[chatId] = { step: 'condition' };
    return bot.sendMessage(chatId,
      `Welcome to *Abdul iPhone Shop*! 👋  

We offer the latest iPhone models at great prices.  
Send us a message to check stock, prices, or place an order.  
We’re here to help you 24/7! 💼

Select phone condition:`,
      { parse_mode: 'Markdown', reply_markup: { keyboard: chunkArray(CONDITIONS, 2), resize_keyboard: true } }
    );
  }

  if (!state) {
    return bot.sendMessage(chatId,
      `🤖 I didn't understand that.\nTo start using the bot, type: \n/start\nor say Hi, Hello, or Hey`
    );
  }

  // ===== CONDITION =====
  if (state.step === 'condition' && CONDITIONS.includes(text)) {
    state.condition = text;
    state.step = 'model';
    return bot.sendMessage(chatId, 'Select model:', { reply_markup: { keyboard: chunkArray(MODELS, 3), resize_keyboard: true } });
  }

  // ===== MODEL =====
  if (state.step === 'model' && MODELS.includes(text)) {
    state.model = text;
    state.step = 'storage';
    return bot.sendMessage(chatId, 'Select storage:', { reply_markup: { keyboard: chunkArray(STORAGE, 3), resize_keyboard: true } });
  }

  // ===== STORAGE =====
  if (state.step === 'storage' && STORAGE.includes(text)) {
    state.storage = text;
    state.step = 'color';
    return bot.sendMessage(chatId, 'Pick color or type your own:', { reply_markup: { keyboard: chunkArray(COLORS, 3), resize_keyboard: true } });
  }

  // ===== COLOR =====
  if (state.step === 'color') {
    state.color = text; 
    state.step = 'name';
    return bot.sendMessage(chatId, 'Enter full name:');
  }

  // ===== NAME =====
  if (state.step === 'name') {
    state.name = text;
    state.step = 'phone';
    return bot.sendMessage(chatId, 'Enter phone number:');
  }

  // ===== PHONE =====
  if (state.step === 'phone') {
    state.phone = text;
    return finalizeOrder(chatId, state);
  }
});

// ================= FINALIZE ORDER =================
function finalizeOrder(chatId, state) {
  const orderId = `ORD-${Date.now()}`;
  orders[orderId] = { orderId, userChatId: chatId, ...state, awaitingPrice: true, awaitingPayment: null, status: 'new' };

  const summary = getOrderTextForUser(orders[orderId]);
  bot.sendMessage(chatId, summary, { reply_markup: { remove_keyboard: true } });
  bot.sendMessage(chatId, "⏳ Your order is waiting for admin confirmation.");

  sendOrderToAdmin(orders[orderId]);
  delete userStates[chatId];
}

// ================= CALLBACK HANDLER =================
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const [action, orderId] = query.data.split('_');
  const order = orders[orderId];
  if (!order) return;

  // ===== ADMIN ACTIONS =====
  if (chatId.toString() === ADMIN_CHAT_ID) {
    if (action === 'confirm') {
      order.awaitingPrice = true;
      order.status = 'confirmed';
      bot.sendMessage(ADMIN_CHAT_ID, `💚 Order ${orderId} confirmed. Enter price:`);
    }
    if (action === 'out') {
      order.status = 'out';
      bot.sendMessage(order.userChatId,
        `❌ Sorry, your order (${orderId}) is out of stock. Restart if you want to order again.`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "🔄 Restart Order", callback_data: `restart_${orderId}` }]
            ]
          }
        }
      );
    }
    if (action === 'approve') {
      bot.sendMessage(order.userChatId, '✅ Payment confirmed! Will you pick up or delivery?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Pickup", callback_data: `pickup_${orderId}` }],
            [{ text: "Delivery", callback_data: `delivery_${orderId}` }]
          ]
        }
      });
    }
    if (action === 'reject') {
      order.awaitingRejectReason = true;
      bot.sendMessage(ADMIN_CHAT_ID, `Provide reason for rejecting payment of ${orderId}:`);
    }
  }

  // ===== USER CONFIRM / REJECT =====
  if (action === 'yes') {
    order.awaitingPayment = order.userChatId;
    bot.sendMessage(order.userChatId,
`💳 Please make payment:

📞 0593827001
Account Name: Daa Yussif

Send screenshot or tap Skip Payment.`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "💳 Send Payment Screenshot", callback_data: `pay_${orderId}` }],
          [{ text: "⏭ Skip Payment", callback_data: `skip_${orderId}` }]
        ]
      }
    });
  }

  if (action === 'no') {
    bot.sendMessage(order.userChatId, `❌ Order (${orderId}) cancelled. Restarting order...`);
    sendNewOrderButton(order.userChatId);
    delete orders[orderId];
  }

  // ===== SKIP PAYMENT =====
  if (action === 'skip') {
    order.awaitingPayment = null;
    bot.sendMessage(order.userChatId,
      `✅ You skipped payment. Now choose pickup or delivery:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Pickup", callback_data: `pickup_${orderId}` }],
            [{ text: "Delivery", callback_data: `delivery_${orderId}` }]
          ]
        }
      }
    );
  }

  // ===== PICKUP / DELIVERY =====
  if (action === 'pickup' || action === 'delivery') {
    const method = action === 'pickup' ? 'Pickup' : 'Delivery';

    if (method === 'Delivery') {
      order.awaitingLocation = true;
      order.step = 'delivery';
      bot.sendMessage(order.userChatId, "📍 Please share your location for delivery.");
      return;
    }

    // For Pickup, automatically share shop location
    if (method === 'Pickup') {
      const finalSummary = `
✅ ORDER COMPLETED
🛒 ORDER DETAILS
Order ID: ${order.orderId}
Model: ${order.model}
Condition: ${order.condition}
Storage: ${order.storage}
Color: ${order.color}
Customer: ${order.name}
Phone: ${order.phone}
💰 Price: GHS ${order.price}
Method: ${method}
Pickup Location: ${SHOP_LOCATION}
Status: PAID ✅
      `;

      bot.sendMessage(order.userChatId, finalSummary);
      bot.sendMessage(ADMIN_CHAT_ID, finalSummary);
      sendNewOrderButton(order.userChatId);
      delete orders[orderId];
    }
  }

  // ===== RESTART ORDER =====
  if (action === 'restart' || action === 'restart_manual') {
    userStates[order.userChatId || chatId] = { step: 'condition' };
    bot.sendMessage(order.userChatId || chatId,
      `🔄 Starting a new order. Select phone condition:`,
      { reply_markup: { keyboard: chunkArray(CONDITIONS, 2), resize_keyboard: true } }
    );
    delete orders[orderId];
  }

  bot.answerCallbackQuery(query.id);
});

// ===== HELPER FUNCTIONS =====
function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function getOrderTextForUser(order) {
  return `
🛒 ORDER SUMMARY
Order ID: ${order.orderId}

Model: ${order.model}
Condition: ${order.condition}
Storage: ${order.storage}
Color: ${order.color}

Name: ${order.name}
Phone: ${order.phone}
  `;
}

function sendOrderToAdmin(order) {
  let marker = '';
  if(order.status === 'new') marker = '🟡 NEW ORDER';
  if(order.status === 'confirmed') marker = '✅ CONFIRMED';
  if(order.status === 'out') marker = '❌ OUT OF STOCK';

  const text = `
${marker}
Order ID: ${order.orderId}
Model: ${order.model}
Condition: ${order.condition}
Storage: ${order.storage}
Color: ${order.color}
Customer: ${order.name}
Phone: ${order.phone}
Price: ${order.price || 'Pending'}
`;

  bot.sendMessage(ADMIN_CHAT_ID, text, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Confirm", callback_data: `confirm_${order.orderId}` }],
        [{ text: "❌ Out of Stock", callback_data: `out_${order.orderId}` }]
      ]
    }
  });
}

function sendOrderToUserForConfirmation(order) {
  bot.sendMessage(order.userChatId,
    `✅ Your order (${order.orderId}) is available!\n💰 Price: GHS ${order.price}\nDo you want to proceed?`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "✅ Yes", callback_data: `yes_${order.orderId}` }],
          [{ text: "❌ No", callback_data: `no_${order.orderId}` }]
        ]
      }
    }
  );
}

function sendNewOrderButton(chatId) {
  bot.sendMessage(chatId,
    `🔄 Want to place a new order? Tap below to start:`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🛒 Start New Order", callback_data: `restart_manual` }]
        ]
      }
    }
  );
}

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});