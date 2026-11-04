"""Private Telegram administrator for the XAU Machine CRM.

This process is intentionally separate from the customer-facing bot.  It uses
only environment variables, keeps an audit/memory database on /data, and never
executes a requested change before the administrator confirms it.
"""
import asyncio
import base64
import json
import logging
import os
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

import httpx
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters
from health_server import start_health_server

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("xau-admin-bot")

TOKEN = os.environ["ADMIN_BOT_TOKEN"]
OPENAI_KEY = os.environ["ADMIN_OPENAI_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
CRM_SECRET = os.environ["CRM_TRACKING_SECRET"]
ADMIN_IDS = {item.strip() for item in os.environ.get("ADMIN_CHAT_ID", "").split(",") if item.strip()}
BOOTSTRAP_CODE = os.environ.get("ADMIN_BOOTSTRAP_CODE", "")
DB_PATH = Path(os.environ.get("ADMIN_MEMORY_DB", "/data/admin-bot.sqlite3"))

SYSTEM = """Sei l'assistente amministratore privato del CRM XAU Machine.
Parli italiano e assisti esclusivamente gli amministratori autorizzati. Puoi
analizzare prompt, conversazioni, topic, traduzioni e stato AI. Non inventare
azioni riuscite: per ogni modifica proponi una sintesi precisa e chiedi
conferma. Rispondi in JSON con chiavi reply e change. change e' null oppure un
oggetto con action tra prompt_update, ai_control, topic_lookup, translation_review.
Per prompt_update usa payload.content, name e language; per ai_control usa
payload.chat_id e mode (on, off, pause_1h)."""


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS memory (
            id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, role TEXT NOT NULL,
            body TEXT NOT NULL, created_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS pending_changes (
            chat_id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL)""")
        conn.execute("""CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY, chat_id TEXT NOT NULL, action TEXT NOT NULL,
            payload TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT NOT NULL)""")
        conn.execute("CREATE TABLE IF NOT EXISTS admins (telegram_id TEXT PRIMARY KEY, created_at TEXT NOT NULL)")
        conn.commit()


def now():
    return datetime.now(timezone.utc).isoformat()


def remember(chat_id, role, body):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("INSERT INTO memory(chat_id,role,body,created_at) VALUES(?,?,?,?)", (str(chat_id), role, body[:12000], now()))
        conn.execute("DELETE FROM memory WHERE id NOT IN (SELECT id FROM memory WHERE chat_id=? ORDER BY id DESC LIMIT 80)", (str(chat_id),))
        conn.commit()


def history(chat_id):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        rows = conn.execute("SELECT role,body FROM memory WHERE chat_id=? ORDER BY id DESC LIMIT 20", (str(chat_id),)).fetchall()
    return [{"role": role, "content": body} for role, body in reversed(rows)]


def authorized(update):
    if not update.effective_user:
        return False
    user_id = str(update.effective_user.id)
    if user_id in ADMIN_IDS:
        return True
    with closing(sqlite3.connect(DB_PATH)) as conn:
        return conn.execute("SELECT 1 FROM admins WHERE telegram_id=?", (user_id,)).fetchone() is not None


async def openai_json(chat_id, text):
    items = [{"role": "developer", "content": SYSTEM}]
    items += history(chat_id)
    items.append({"role": "user", "content": text})
    payload = {"model": "gpt-4.1-mini", "input": items, "text": {"format": {"type": "json_object"}}}
    headers = {"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers=headers, json=payload)
    response.raise_for_status()
    data = response.json()
    raw = data.get("output_text") or "{}"
    return json.loads(raw)


async def transcribe(file_bytes, filename):
    headers = {"Authorization": f"Bearer {OPENAI_KEY}"}
    files = {"file": (filename, file_bytes, "audio/ogg"), "model": (None, "gpt-4o-mini-transcribe")}
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post("https://api.openai.com/v1/audio/transcriptions", headers=headers, files=files)
    response.raise_for_status()
    return response.json().get("text", "")


async def inspect_image(file_bytes, caption):
    image = base64.b64encode(file_bytes).decode()
    payload = {"model": "gpt-4.1-mini", "input": [{"role": "developer", "content": SYSTEM}, {"role": "user", "content": [{"type": "input_text", "text": "Analizza questa immagine nel contesto CRM. " + (caption or "")}, {"type": "input_image", "image_url": f"data:image/jpeg;base64,{image}"}]}]}
    headers = {"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers=headers, json=payload)
    response.raise_for_status()
    return response.json().get("output_text", "Immagine ricevuta.")


def supabase_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


async def execute_change(change):
    action, payload = change.get("action"), change.get("payload") or {}
    headers = supabase_headers()
    async with httpx.AsyncClient(timeout=20) as client:
        if action == "ai_control":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_set_ai_control", headers=headers, json={"p_secret": CRM_SECRET, "p_tenant_slug": "xau-machine", "p_telegram_chat_id": int(payload["chat_id"]), "p_mode": payload["mode"]})
        elif action == "topic_lookup":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_get_telegram_topic", headers=headers, json={"p_secret": CRM_SECRET, "p_tenant_slug": "xau-machine", "p_telegram_user_id": int(payload["telegram_user_id"])} )
        elif action == "prompt_update":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_admin_save_prompt", headers=headers, json={"p_secret": CRM_SECRET, "p_tenant_slug": "xau-machine", "p_name": payload.get("name", "Prompt amministratore"), "p_language": payload.get("language", "it"), "p_content": payload["content"]})
        else:
            return False, "Operazione non supportata in modo sicuro."
    if r.status_code >= 300:
        return False, f"CRM ha rifiutato l'operazione ({r.status_code})."
    return True, r.text[:1000]


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        supplied = context.args[0] if context.args else ""
        if BOOTSTRAP_CODE and supplied == BOOTSTRAP_CODE and update.effective_user:
            with closing(sqlite3.connect(DB_PATH)) as conn:
                conn.execute("INSERT OR IGNORE INTO admins(telegram_id,created_at) VALUES(?,?)", (str(update.effective_user.id), now()))
                conn.commit()
            await update.effective_message.reply_text("✅ Account amministratore collegato. Ora invia /start.")
            return
        log.warning("Admin bot access denied for Telegram user %s", getattr(update.effective_user, "id", "unknown"))
        await update.effective_message.reply_text("⛔ Questo bot e' riservato agli amministratori autorizzati.")
        return
    await update.effective_message.reply_text("✅ Console amministratore XAU Machine attiva. Scrivimi cosa vuoi controllare o modificare. Le modifiche richiedono sempre /conferma.")


async def confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    chat_id = str(update.effective_chat.id)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        row = conn.execute("SELECT payload FROM pending_changes WHERE chat_id=?", (chat_id,)).fetchone()
    if not row:
        await update.effective_message.reply_text("Non ci sono modifiche in attesa.")
        return
    change = json.loads(row[0])
    ok, detail = await execute_change(change)
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("DELETE FROM pending_changes WHERE chat_id=?", (chat_id,))
        conn.execute("INSERT INTO audit(chat_id,action,payload,outcome,created_at) VALUES(?,?,?,?,?)", (chat_id, change.get("action", ""), json.dumps(change), "ok" if ok else detail, now()))
        conn.commit()
    await update.effective_message.reply_text("✅ Modifica applicata." if ok else f"⚠️ Modifica non applicata: {detail}")


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if authorized(update):
        with closing(sqlite3.connect(DB_PATH)) as conn:
            conn.execute("DELETE FROM pending_changes WHERE chat_id=?", (str(update.effective_chat.id),)); conn.commit()
        await update.effective_message.reply_text("Modifica annullata.")


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE, text):
    if not authorized(update):
        return
    chat_id = update.effective_chat.id
    remember(chat_id, "user", text)
    try:
        result = await openai_json(chat_id, text)
    except Exception as exc:
        log.exception("AI admin unavailable")
        await update.effective_message.reply_text("⚠️ Assistente AI non disponibile; la modifica non è stata eseguita.")
        return
    reply = str(result.get("reply") or "Ho analizzato la richiesta.")
    change = result.get("change")
    if isinstance(change, dict) and change.get("action"):
        with closing(sqlite3.connect(DB_PATH)) as conn:
            conn.execute("INSERT OR REPLACE INTO pending_changes(chat_id,payload,created_at) VALUES(?,?,?)", (str(chat_id), json.dumps(change), now())); conn.commit()
        reply += "\n\nModifica preparata. Controlla il riepilogo e usa /conferma per applicarla oppure /annulla."
    remember(chat_id, "assistant", reply)
    await update.effective_message.reply_text(reply[:4000])


async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await handle_text(update, context, update.effective_message.text or "")


async def voice_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    telegram_file = await update.effective_message.voice.get_file()
    raw = bytes(await telegram_file.download_as_bytearray())
    text = await transcribe(raw, "voice.ogg")
    await update.effective_message.reply_text("🎙 Trascrizione: " + (text or "non rilevata"))
    if text: await handle_text(update, context, text)


async def photo_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    telegram_file = await update.effective_message.photo[-1].get_file()
    raw = bytes(await telegram_file.download_as_bytearray())
    text = await inspect_image(raw, update.effective_message.caption or "")
    await handle_text(update, context, "Analisi immagine ricevuta:\n" + text)


def main():
    init_db()
    log.info("Starting XAU Machine admin Telegram bot")
    threading.Thread(target=start_health_server, name="health-server", daemon=True).start()
    async def post_init(application):
        me = await application.bot.get_me()
        log.info("Admin Telegram bot connected: @%s; authorized IDs configured: %s", me.username, bool(ADMIN_IDS))

    app = Application.builder().token(TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("conferma", confirm))
    app.add_handler(CommandHandler("annulla", cancel))
    app.add_handler(MessageHandler(filters.VOICE, voice_message))
    app.add_handler(MessageHandler(filters.PHOTO, photo_message))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
    app.run_polling(drop_pending_updates=False)


if __name__ == "__main__":
    main()
