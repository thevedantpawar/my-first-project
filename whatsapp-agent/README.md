# WhatsApp Pharmacy + Skincare Agent

A Node.js WhatsApp Business (Cloud API) agent for an Indian pharmacy/skincare brand,
using the Claude API for natural-language handling. Answers stock/price
questions, takes OTC/skincare orders with a confirm-before-checkout step,
hard-routes anything prescription-related to a human pharmacist, sends
refill reminders, and logs every conversation.

## Architecture

```
WhatsApp Cloud API  <-->  src/whatsapp/*        (send/receive, signature verification)
                              |
                          src/routes/webhookRoutes.js
                              |
                    src/prescription/prescriptionGuard.js   <- deterministic gate, runs first, always
                              |
                          src/claude/agent.js    (orchestrates one turn)
                              |
                    Claude API (tool use) <---> src/claude/tools.js
                              |                        |
                              |                 src/catalog/catalogService.js  (data/products.json)
                              |                 src/orders/orderService.js     (SQLite)
                              |                 src/review/humanReviewQueue.js (SQLite)
                              |
                    src/conversation/conversationLogger.js  (every inbound/outbound message, always)

src/reminders/scheduler.js  --(node-cron, daily)-->  src/reminders/refillReminderService.js
```

### Why this shape

- **Grounding, not trust.** Claude never answers a price/stock/product question directly —
  it must call `search_catalog` / `get_product`, and the system prompt (`src/claude/systemPrompt.js`)
  forbids stating anything not returned by a tool this turn. `orderService.createDraftOrder`
  independently re-looks-up price/stock from the catalog when building an order, so a
  hallucinated number from the model can never make it into a real order.
- **Prescription requests never reach the model's judgment alone.** `prescriptionGuard.js`
  is a deterministic keyword/pattern check (`data/prescription_terms.json`) that runs
  *before* Claude is called. If it matches, the fixed response goes out and the
  conversation is queued for a human — no model call happens for that turn. Claude also
  has a `flag_for_human_review` tool as a second line of defence for phrasing the list
  misses, and any image/document upload (likely a prescription photo) is routed to a
  human automatically without ever being interpreted by the bot.
- **Catalog failures fail loud, not silent.** `catalogService.js` throws
  `CatalogUnavailableError` if the product data can't be read/parsed. That error is never
  caught and papered over — it propagates out of the whole turn, and the customer gets
  "Let me check with the team and get back to you" while the conversation is flagged for
  human review. The model is never given a chance to guess in this path.
- **Orders are two-step.** `start_order` only ever creates a `draft` order and returns a
  pre-formatted summary; nothing is finalized until the customer explicitly confirms and
  `confirm_pending_order` is called.
- **Everything is logged.** Every inbound and outbound message is written to the
  `conversations` table in `conversationLogger.js`, unconditionally — including the
  prescription fast-path and error fallback paths.

## Setup

```bash
cd whatsapp-agent
cp .env.example .env   # fill in real values — see below. Never commit .env.
npm install
npm test                # runs against an isolated temp DB + a copy of the catalog fixture
npm run seed             # optional: seed a demo customer due for a refill reminder
npm run dev               # starts the server with nodemon
```

### What you need in `.env`

| Variable | Where to get it |
| --- | --- |
| `WHATSAPP_TOKEN` | Meta App Dashboard → WhatsApp → API Setup (use a permanent token from a System User for production, not the 24h temporary token) |
| `WHATSAPP_PHONE_NUMBER_ID` | Same screen, "Phone number ID" |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Same screen, "WhatsApp Business Account ID" |
| `WHATSAPP_VERIFY_TOKEN` | Any string you choose — enter the same string in the Meta webhook config screen |
| `WHATSAPP_APP_SECRET` | Meta App Dashboard → App Settings → Basic → App Secret (used to verify webhook signatures) |
| `WHATSAPP_REMINDER_TEMPLATE_NAME` / `_LANG` | Name/language of an **approved** message template for refill reminders (proactive messages outside the 24h window require a template — create one under WhatsApp → Message Templates with two body variables: customer name, product name) |
| `ANTHROPIC_API_KEY` | console.anthropic.com |

Point your Meta webhook at `https://<your-domain>/webhook` (use `ngrok http 3000` for local
testing) with the verify token above, subscribed to the `messages` field.

## Product catalog

Currently backed by `data/products.json` (the "local JSON catalog" option). Every field
the bot can mention — name, price, stock — lives here; the bot is structurally unable to
mention a product that isn't in this file. Edit this file (or point
`PRODUCT_CATALOG_PATH` at a generated export) to update stock/prices.

**To swap to Shopify later:** replace `readCatalogFile` in
`src/catalog/catalogService.js` with an Admin API fetch that normalizes Shopify
products/variants into the same shape (`sku, name, brand, category, price, stock_qty,
duration_days, requires_prescription`). Every other module only depends on this file's
exports, so nothing else needs to change.

## Prescription safety list

`data/prescription_terms.json` is a maintained list of Schedule H/H1-type drug names,
suffix patterns (e.g. `-cillin`, `-oxacin`), and phrases. It's deliberately broad — a
false positive just means a human reviews a message that turns out to be OTC, which is
safe; a false negative is not. **A pharmacist should own and periodically extend this
list**, it is not something the bot infers on its own.

## Order → checkout

`start_order` validates stock/price against the live catalog and creates a `draft` order;
`confirm_pending_order` finalizes it. **Payment/fulfillment integration wasn't decided
yet**, so confirming an order today: records it, updates purchase history (for refill
reminders), decrements catalog stock, and pushes it to the human review queue
(`category = 'new_order'`) for your team to actually invoice/dispatch. Swap the end of
`orderService.confirmOrder` for a real integration (Shopify draft order + payment link,
Razorpay/UPI link, etc.) once that's decided.

## Refill reminders

Each product in the catalog can carry a `duration_days` (typical days of use — e.g. 30 for
a sunscreen). `src/reminders/scheduler.js` runs a daily cron (`REMINDER_CRON`, default
9am) that finds purchases past their due date (within `REMINDER_WINDOW_DAYS`) that haven't
been reminded yet, and sends a WhatsApp template message. Run it manually any time with
`npm run reminders:run`.

## Human review queue

Anything the bot isn't confident about — prescription requests, catalog/API failures,
anything Claude itself flags via `flag_for_human_review`, and every newly confirmed order
— lands in the `human_review_queue` SQLite table (`category` distinguishes the reason).
`src/review/notify.js` has stub Slack/email adapters; only `HUMAN_REVIEW_NOTIFY_METHOD=none`
(DB-only) is wired up by default — pick a channel and fill in the adapter when you're
ready.

## Testing

`npm test` runs `node`'s built-in test runner against catalog search, the prescription
gate, order creation/confirmation, and refill-reminder due-date logic. Each run copies
`data/products.json` into a temp directory first, so tests never mutate the committed
catalog even though order confirmation decrements stock on disk.

## Known gaps / next decisions

- Payment/fulfillment on order confirmation (currently hands off to a human).
- Human review notification channel (currently DB-only).
- The refill reminder message template needs to be created and approved in the Meta
  Business dashboard before `reminders:run` will actually deliver anything.
