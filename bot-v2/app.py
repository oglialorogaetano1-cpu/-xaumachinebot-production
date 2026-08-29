import os
import logging
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("xau-bot-v2")

BOT_TOKEN = os.environ["BOT_TOKEN"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
ADMIN_CHAT_ID = os.environ.get("ADMIN_CHAT_ID", "")
CRM_HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"}

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"ok")
        else:
            self.send_response(404)
            self.end_headers()
    def log_message(self, fmt, *args):
        return

def start_health_server():
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer(("0.0.0.0", port), HealthHandler).serve_forever()

async def crm_insert(table, payload):
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{SUPABASE_URL}/rest/v1/{table}", headers=CRM_HEADERS, json=payload)
        if r.status_code >= 300:
            log.warning("CRM %s %s: %s", table, r.status_code, r.text[:300])

async def record_message(update: Update, direction="in"):
    if not update.effective_user or not update.effective_chat:
        return
    text = update.effective_message.text if update.effective_message else ""
    chat_id = str(update.effective_chat.id)
    await crm_insert("crm_messages", {"telegram_chat_id": chat_id, "direction": direction, "content": text or "", "created_at": datetime.now(timezone.utc).isoformat()})

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await record_message(update)
    await update.message.reply_text("Ciao! Sono l'assistente XAU Machine. Ti spiego sala segnali, bot, registrazione e prossimi passaggi. Scrivi /help per iniziare.")
    await record_message(update, "out")

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("/registrazione - link e procedura\n/sala_segnali - informazioni sala\n/verifica_ib - verifica iscrizione\n/deposito - stato deposito\n/guida_bot - guida accesso\n/screenshot - richiedi aggiornamento MT5\n/intervento_umano - parla con un operatore")

async def simple_reply(update, text):
    await record_message(update)
    await update.message.reply_text(text)
    await record_message(update, "out")

async def registration(update, context): await simple_reply(update, "Per registrarti usa il link PU Prime indicato dal tuo referente. Dopo l'iscrizione scrivi qui e verifichiamo l'IB.")
async def signals(update, context): await simple_reply(update, "La sala segnali pubblica operazioni e risultati. Posso spiegarti differenze, rischi e modalità di accesso.")
async def verify_ib(update, context): await simple_reply(update, "La verifica IB può richiedere tempo. Quando disponibile, invia uno screenshot dell'area conto e controlliamo il collegamento.")
async def deposit(update, context): await simple_reply(update, "Per assistenza sul deposito non inviare password o codici. Posso passare la richiesta a un operatore.")
async def guide(update, context): await simple_reply(update, "Quando l'iscrizione sotto l'IB è verificata, riceverai la guida di accesso al bot e alla sala.")
async def screenshot(update, context): await simple_reply(update, "Richiesta screenshot MT5 registrata. Il worker VPS invierà l'ultimo risultato disponibile nel CRM.")
async def human(update, context):
    await record_message(update)
    chat_id = str(update.effective_chat.id)
    await crm_insert("crm_human_handoffs", {"reason": "Richiesta operatore dal bot v2", "priority": "high", "status": "open", "channels": ["telegram","email","whatsapp","ringover"], "metadata": {"telegram_chat_id": chat_id}})
    await update.message.reply_text("Ho registrato la richiesta e avvisato l'operatore.")
    if ADMIN_CHAT_ID:
        try:
            await context.bot.send_message(chat_id=int(ADMIN_CHAT_ID), text=f"Nuova richiesta operatore dal chat {chat_id}")
        except Exception as e: log.warning("Admin notification failed: %s", e)

async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await record_message(update)
    await update.message.reply_text("Ho ricevuto il messaggio. Posso aiutarti con registrazione, sala segnali, verifica IB, deposito o passaggio a un operatore. Scrivi /help.")
    await record_message(update, "out")

def main():
    threading.Thread(target=start_health_server, daemon=True, name="healthcheck").start()
    app = Application.builder().token(BOT_TOKEN).build()
    for cmd, fn in {"start":start,"help":help_cmd,"registrazione":registration,"sala_segnali":signals,"verifica_ib":verify_ib,"deposito":deposit,"guida_bot":guide,"screenshot":screenshot,"intervento_umano":human}.items():
        app.add_handler(CommandHandler(cmd, fn))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
    log.info("XAU Machine Bot v2 online")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
