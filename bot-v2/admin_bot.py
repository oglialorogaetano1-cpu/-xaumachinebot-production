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
# HTTP client URLs include the Telegram bot token.  Keep transport logging out
# of Railway logs while retaining the bot's own operational messages.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
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
oggetto con action tra prompt_update, ai_control, topic_lookup, topic_update,
sales_send, sales_broadcast, lead_create, lead_update, channel_create,
followup_rule_create e conversation_update.
Per prompt_update usa payload.content, name e language; per ai_control usa
payload.chat_id e mode (on, off, pause_1h). Per topic_update usa
telegram_user_id, telegram_chat_id, message_thread_id e topic_name. Per
sales_send usa telegram_chat_id, conversation_id e body. Non inviare mai un
messaggio al cliente senza far usare /conferma. Quando l'amministratore chiede
di contattare tutti i clienti senza deposito, usa sales_broadcast con
payload.segment="not_deposited" e payload.body. Non usare sales_broadcast per
un segmento diverso senza chiedere prima un chiarimento. reply e' obbligatorio:
deve essere una risposta conversazionale utile e completa alla domanda, mai
una frase generica come "Ho analizzato la richiesta". Se non serve una modifica,
imposta change a null ma rispondi comunque in modo concreto. Prepara una
modifica soltanto se l'amministratore l'ha richiesta in modo esplicito e i
parametri necessari sono completi. Non dichiarare mai di non avere accesso alle
conversazioni CRM: per analizzarne una, guida l'amministratore a usare
/conversazioni e /analizza <id> quando manca l'identificativo."""


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


def response_text(data):
    """Support both compact and full Responses API payload shapes."""
    if data.get("output_text"):
        return str(data["output_text"])
    chunks = []
    for item in data.get("output") or []:
        for content in item.get("content") or []:
            text = content.get("text")
            if isinstance(text, str):
                chunks.append(text)
            elif isinstance(text, dict) and isinstance(text.get("value"), str):
                chunks.append(text["value"])
    return "\n".join(chunks)


def valid_change(change):
    """Never stage an incomplete AI proposal that could fail on confirmation."""
    if not isinstance(change, dict) or not change.get("action"):
        return False, ""
    payload = change.get("payload") or {}
    required = {
        "prompt_update": ("content",),
        "ai_control": ("chat_id", "mode"),
        "topic_update": ("telegram_user_id", "telegram_chat_id", "message_thread_id", "topic_name"),
        "sales_send": ("telegram_chat_id", "conversation_id", "body"),
        "sales_broadcast": ("segment", "body"),
        "lead_create": ("full_name",),
        "lead_update": ("id",),
        "channel_create": ("name", "telegram_url", "campaign_code"),
        "followup_rule_create": ("name", "message_template"),
        "conversation_update": ("id",),
    }
    missing = [key for key in required.get(change.get("action"), ()) if not str(payload.get(key) or "").strip()]
    if missing:
        return False, ", ".join(missing)
    return True, ""


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
    raw = response_text(data) or "{}"
    return json.loads(raw)


async def openai_text(text):
    """Plain-language fallback when the structured planner omits its reply."""
    payload = {
        "model": "gpt-4.1-mini",
        "input": [
            {"role": "developer", "content": "Sei l'assistente amministratore XAU Machine. Rispondi in italiano in modo naturale, concreto e utile. Non dire che hai analizzato una richiesta; rispondi direttamente. Non affermare di aver effettuato modifiche o invii."},
            {"role": "user", "content": text},
        ],
    }
    headers = {"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers=headers, json=payload)
    response.raise_for_status()
    return response_text(response.json()).strip()


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


async def translate_sales_text(text, language):
    """Translate a human-approved campaign while retaining its sales meaning."""
    language = (language or "it").lower()
    if language in {"it", "italian", "italiano"}:
        return text
    prompt = ("Translate the following approved sales message into " + language +
              ". Return only the translated message. Preserve placeholders, URLs, "
              "names and factual claims. Do not add promises, disclaimers, or commentary.\n\n" + text)
    headers = {"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers=headers, json={"model": "gpt-4.1-mini", "input": prompt})
    response.raise_for_status()
    return (response.json().get("output_text") or text).strip()


def supabase_headers():
    return {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}


async def execute_change(change):
    action, payload = change.get("action"), change.get("payload") or {}
    if action == "sales_broadcast":
        return await execute_broadcast(payload)
    headers = supabase_headers()
    async with httpx.AsyncClient(timeout=20) as client:
        if action == "ai_control":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_set_ai_control", headers=headers, json={"p_secret": CRM_SECRET, "p_tenant_slug": "xau-machine", "p_telegram_chat_id": int(payload["chat_id"]), "p_mode": payload["mode"]})
        elif action == "topic_lookup":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_get_telegram_topic", headers=headers, json={"p_secret": CRM_SECRET, "p_tenant_slug": "xau-machine", "p_telegram_user_id": int(payload["telegram_user_id"])} )
        elif action == "prompt_update":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_save_master_prompt", headers=headers, json={"p_name": payload.get("name", "Prompt XAU Machine"), "p_content": payload["content"]})
        elif action == "topic_update":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/rpc/crm_upsert_telegram_topic", headers=headers, json={"p_secret": CRM_SECRET, "p_tenant_slug": "xau-machine", "p_telegram_user_id": int(payload["telegram_user_id"]), "p_telegram_chat_id": int(payload["telegram_chat_id"]), "p_message_thread_id": int(payload["message_thread_id"]), "p_topic_name": payload["topic_name"]})
        elif action == "sales_send":
            chat_id = str(payload["telegram_chat_id"])
            body = str(payload["body"])[:8000]
            queued = await client.post(f"{SUPABASE_URL}/rest/v1/crm_operator_outbox", headers={**headers, "Prefer": "return=representation"}, json={"tenant_id": "00000000-0000-4000-8000-000000000001", "tenant_slug": "xau-machine", "telegram_chat_id": chat_id, "body": body})
            if queued.status_code >= 300:
                return False, f"Coda Telegram rifiutata ({queued.status_code})."
            r = await client.post(f"{SUPABASE_URL}/rest/v1/crm_messages", headers=headers, json={"conversation_id": payload["conversation_id"], "tenant_id": "00000000-0000-4000-8000-000000000001", "direction": "outbound", "sender_type": "human", "body": body})
        elif action == "lead_create":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/crm_leads", headers={**headers, "Prefer": "return=representation"}, json=payload)
        elif action == "lead_update":
            lead_id = payload.pop("id")
            r = await client.patch(f"{SUPABASE_URL}/rest/v1/crm_leads?id=eq.{lead_id}", headers={**headers, "Prefer": "return=representation"}, json=payload)
        elif action == "channel_create":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/crm_channel_sources", headers={**headers, "Prefer": "return=representation"}, json=payload)
        elif action == "followup_rule_create":
            r = await client.post(f"{SUPABASE_URL}/rest/v1/crm_followup_rules", headers={**headers, "Prefer": "return=representation"}, json=payload)
        elif action == "conversation_update":
            conversation_id = payload.pop("id")
            r = await client.patch(f"{SUPABASE_URL}/rest/v1/crm_conversations?id=eq.{conversation_id}", headers={**headers, "Prefer": "return=representation"}, json=payload)
        else:
            return False, "Operazione non supportata in modo sicuro."
    if r.status_code >= 300:
        return False, f"CRM ha rifiutato l'operazione ({r.status_code})."
    return True, r.text[:1000]


async def crm_get(path, params):
    """Read CRM data using the bot's server-side credentials only."""
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=supabase_headers(), params=params)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else []


async def broadcast_targets(segment):
    if segment != "not_deposited":
        raise ValueError("Segmento non supportato")
    leads = await crm_get("crm_leads", {"select": "id,full_name,language,telegram_chat_id,telegram_user_id,deposit_total,status", "deposit_total": "eq.0", "limit": "500"})
    conversations = await crm_get("crm_conversations", {"select": "id,lead_id", "limit": "1000"})
    by_lead = {str(row.get("lead_id")): row.get("id") for row in conversations}
    result = []
    for lead in leads:
        chat_id = lead.get("telegram_chat_id") or lead.get("telegram_user_id")
        conversation_id = by_lead.get(str(lead.get("id")))
        if chat_id and conversation_id:
            result.append({"chat_id": str(chat_id), "conversation_id": conversation_id, "language": lead.get("language") or "it", "name": lead.get("full_name") or "Cliente"})
    return result


async def execute_broadcast(payload):
    body = str(payload.get("body") or "").strip()
    if not body:
        return False, "Messaggio campagna mancante."
    targets = await broadcast_targets(payload.get("segment"))
    if not targets:
        return False, "Nessun destinatario idoneo con conversazione Telegram disponibile."
    if len(targets) > 500:
        return False, "Segmento troppo grande: riduci il pubblico prima dell'invio."
    headers = {**supabase_headers(), "Prefer": "return=minimal"}
    translated = {}
    sent, failed = 0, 0
    async with httpx.AsyncClient(timeout=25) as client:
        for target in targets:
            try:
                language = str(target["language"]).lower()
                if language not in translated:
                    translated[language] = await translate_sales_text(body, language)
                message = translated[language]
                queue = await client.post(f"{SUPABASE_URL}/rest/v1/crm_operator_outbox", headers=headers, json={"tenant_id": "00000000-0000-4000-8000-000000000001", "tenant_slug": "xau-machine", "telegram_chat_id": target["chat_id"], "body": message})
                if queue.status_code >= 300:
                    failed += 1
                    continue
                history = await client.post(f"{SUPABASE_URL}/rest/v1/crm_messages", headers=headers, json={"conversation_id": target["conversation_id"], "tenant_id": "00000000-0000-4000-8000-000000000001", "direction": "outbound", "sender_type": "human", "body": message})
                if history.status_code >= 300:
                    failed += 1
                else:
                    sent += 1
            except Exception:
                failed += 1
    return (sent > 0), f"Campagna completata: {sent} inviati, {failed} da verificare."


async def list_conversations(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    try:
        rows = await crm_get("crm_conversations", {"select": "id,lead_id,last_message_at,ai_enabled,labels", "order": "last_message_at.desc.nullslast", "limit": "30"})
        if not rows:
            await update.effective_message.reply_text("Non trovo conversazioni disponibili.")
            return
        lines = ["💬 Ultime conversazioni (usa /analizza <id>):"]
        for row in rows:
            lines.append(f"• {row.get('id')} · lead {row.get('lead_id')} · {row.get('last_message_at') or 'senza messaggi'}")
        await update.effective_message.reply_text("\n".join(lines)[:4000])
    except Exception:
        log.exception("Conversation list unavailable")
        await update.effective_message.reply_text("⚠️ Non riesco a leggere le conversazioni dal CRM in questo momento.")


async def analyze_conversation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    if not context.args:
        await update.effective_message.reply_text("Uso: /analizza <id_conversazione>")
        return
    conversation_id = context.args[0]
    try:
        rows = await crm_get("crm_messages", {"select": "direction,sender_type,body,created_at", "conversation_id": f"eq.{conversation_id}", "order": "created_at.asc", "limit": "120"})
        if not rows:
            await update.effective_message.reply_text("Non trovo messaggi per questa conversazione.")
            return
        transcript = "\n".join(f"[{r.get('created_at','')}] {r.get('direction','')}/{r.get('sender_type','')}: {r.get('body','')}" for r in rows)
        request = "Analizza questa conversazione CRM. Riporta: intenzione, stato lead, obiezioni, urgenza, prossima azione e una bozza di risposta sales etica (senza promesse o dati inventati). Non applicare modifiche.\n\n" + transcript[:30000]
        result = await openai_json(update.effective_chat.id, request)
        await update.effective_message.reply_text(str(result.get("reply") or "Analisi non disponibile.")[:4000])
    except Exception:
        log.exception("Conversation analysis unavailable")
        await update.effective_message.reply_text("⚠️ Analisi conversazione non disponibile al momento.")


async def briefing(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    try:
        leads, followups, conversations = await asyncio.gather(
            crm_get("crm_leads", {"select": "id,status,deposit_total,created_at", "limit": "500"}),
            crm_get("crm_followups", {"select": "id,scheduled_for,sent_at,cancelled_at", "sent_at": "is.null", "cancelled_at": "is.null", "limit": "500"}),
            crm_get("crm_conversations", {"select": "id,last_message_at,ai_enabled", "order": "last_message_at.desc.nullslast", "limit": "500"}),
        )
        not_deposited = sum(1 for row in leads if float(row.get("deposit_total") or 0) <= 0)
        ai_off = sum(1 for row in conversations if row.get("ai_enabled") is False)
        latest = conversations[0].get("last_message_at") if conversations else "—"
        text = ("📊 Briefing CRM\n"
                f"• Lead totali: {len(leads)}\n"
                f"• Senza deposito: {not_deposited}\n"
                f"• Follow-up aperti: {len(followups)}\n"
                f"• Conversazioni monitorate: {len(conversations)}\n"
                f"• AI disattivata: {ai_off}\n"
                f"• Ultima attività: {latest}\n\n"
                "Prossima azione: chiedimi di analizzare una conversazione, oppure prepara una campagna per i non depositati.")
        await update.effective_message.reply_text(text[:4000])
    except Exception:
        log.exception("CRM briefing unavailable")
        await update.effective_message.reply_text("⚠️ Briefing CRM non disponibile in questo momento.")


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
    await update.effective_message.reply_text("✅ Console amministratore XAU Machine attiva.\n\nDirezione: /briefing · /conversazioni · /analizza <id>\nCRM: /lead nome | lingua | campagna | nota · /stato id | stato · /etichette conversazione | tag1,tag2\nAutomazioni: /regola nome | stato_lead | minuti | messaggio | canale\nCanali: /canale nome | url | lingua | codice | prodotto · /topic utente | chat | thread | nome\nAI/vendite: /prompt Nome | testo · invia un file .txt per importare un prompt · /invia chat | conversazione | testo · /nondepositati messaggio\n\nLe modifiche e gli invii richiedono sempre /conferma.")


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
    is_valid, missing = valid_change(change)
    if is_valid:
        ok, detail = await execute_change(change)
    else:
        ok, detail = False, "Bozza incompleta annullata: mancano " + missing + "."
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


async def prepare_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    raw = " ".join(context.args)
    if "|" not in raw:
        await update.effective_message.reply_text("Uso: /prompt Nome prompt | contenuto completo")
        return
    name, content = (part.strip() for part in raw.split("|", 1))
    if len(content) < 20:
        await update.effective_message.reply_text("Il prompt deve contenere almeno 20 caratteri.")
        return
    change = {"action": "prompt_update", "payload": {"name": name or "Prompt XAU Machine", "content": content}}
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("INSERT OR REPLACE INTO pending_changes(chat_id,payload,created_at) VALUES(?,?,?)", (str(update.effective_chat.id), json.dumps(change), now())); conn.commit()
    await update.effective_message.reply_text("Prompt preparato come nuova versione. Usa /conferma per salvarlo e attivarlo, oppure /annulla.")


async def prepare_topic(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    raw = " ".join(context.args)
    parts = [part.strip() for part in raw.split("|")]
    if len(parts) != 4 or not all(parts):
        await update.effective_message.reply_text("Uso: /topic telegram_user_id | telegram_chat_id | thread_id | nome topic")
        return
    try:
        int(parts[0]); int(parts[1]); int(parts[2])
    except ValueError:
        await update.effective_message.reply_text("I primi tre valori devono essere ID numerici.")
        return
    change = {"action": "topic_update", "payload": {"telegram_user_id": parts[0], "telegram_chat_id": parts[1], "message_thread_id": parts[2], "topic_name": parts[3]}}
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("INSERT OR REPLACE INTO pending_changes(chat_id,payload,created_at) VALUES(?,?,?)", (str(update.effective_chat.id), json.dumps(change), now())); conn.commit()
    await update.effective_message.reply_text("Topic preparato. Usa /conferma per applicare la modifica.")


async def prepare_sales_send(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    raw = " ".join(context.args)
    parts = [part.strip() for part in raw.split("|", 2)]
    if len(parts) != 3 or not all(parts):
        await update.effective_message.reply_text("Uso: /invia telegram_chat_id | id_conversazione | messaggio")
        return
    try:
        int(parts[0])
    except ValueError:
        await update.effective_message.reply_text("telegram_chat_id deve essere numerico.")
        return
    change = {"action": "sales_send", "payload": {"telegram_chat_id": parts[0], "conversation_id": parts[1], "body": parts[2]}}
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("INSERT OR REPLACE INTO pending_changes(chat_id,payload,created_at) VALUES(?,?,?)", (str(update.effective_chat.id), json.dumps(change), now())); conn.commit()
    await update.effective_message.reply_text("Messaggio sales preparato e non ancora inviato. Usa /conferma per inviarlo o /annulla.")


async def prepare_non_deposit_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update):
        return
    body = " ".join(context.args).strip()
    if len(body) < 5:
        await update.effective_message.reply_text("Uso: /nondepositati messaggio da inviare")
        return
    try:
        targets = await broadcast_targets("not_deposited")
    except Exception:
        log.exception("Broadcast preview unavailable")
        await update.effective_message.reply_text("⚠️ Non riesco a calcolare il segmento non depositati adesso.")
        return
    if not targets:
        await update.effective_message.reply_text("Non ci sono clienti non depositati con una conversazione Telegram disponibile.")
        return
    preview = ", ".join(f"{x['name']} ({x['language']})" for x in targets[:5])
    change = {"action": "sales_broadcast", "payload": {"segment": "not_deposited", "body": body}}
    await stage_change(update, change, f"Campagna preparata per {len(targets)} non depositati. Lingua personalizzata per cliente. Anteprima: {preview}.")


async def stage_change(update: Update, change, message):
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.execute("INSERT OR REPLACE INTO pending_changes(chat_id,payload,created_at) VALUES(?,?,?)", (str(update.effective_chat.id), json.dumps(change), now())); conn.commit()
    await update.effective_message.reply_text(message + " Usa /conferma per applicare oppure /annulla.")


async def prepare_lead(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    parts = [x.strip() for x in " ".join(context.args).split("|")]
    if len(parts) != 4 or not all(parts):
        await update.effective_message.reply_text("Uso: /lead nome | lingua | campagna | nota")
        return
    payload = {"full_name": parts[0], "language": parts[1].lower(), "product": "xau_machine", "first_source": parts[2], "last_source": parts[2], "notes": parts[3]}
    await stage_change(update, {"action": "lead_create", "payload": payload}, "Nuovo lead preparato.")


async def prepare_channel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    parts = [x.strip() for x in " ".join(context.args).split("|")]
    if len(parts) != 5 or not all(parts):
        await update.effective_message.reply_text("Uso: /canale nome | url Telegram | lingua | codice campagna | prodotto")
        return
    code = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in parts[3].lower()).strip("_")
    payload = {"name": parts[0], "telegram_url": parts[1], "language": parts[2].lower(), "campaign_code": code, "product": parts[4]}
    await stage_change(update, {"action": "channel_create", "payload": payload}, "Canale Telegram preparato.")


async def prepare_rule(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    parts = [x.strip() for x in " ".join(context.args).split("|")]
    if len(parts) != 5 or not all(parts):
        await update.effective_message.reply_text("Uso: /regola nome | stato_lead | attesa_minuti | messaggio | canale")
        return
    try:
        delay = int(parts[2])
        if delay < 1: raise ValueError
    except ValueError:
        await update.effective_message.reply_text("attesa_minuti deve essere un numero positivo.")
        return
    payload = {"name": parts[0], "trigger_event": "no_reply", "lead_status": parts[1], "delay_minutes": delay, "channel": parts[4], "message_template": parts[3], "stop_on_reply": True, "enabled": True}
    await stage_change(update, {"action": "followup_rule_create", "payload": payload}, "Regola follow-up preparata.")


async def prepare_status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    parts = [x.strip() for x in " ".join(context.args).split("|", 1)]
    if len(parts) != 2 or not all(parts):
        await update.effective_message.reply_text("Uso: /stato id_lead | nuovo_stato")
        return
    await stage_change(update, {"action": "lead_update", "payload": {"id": parts[0], "status": parts[1]}}, "Stato lead preparato.")


async def prepare_labels(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not authorized(update): return
    parts = [x.strip() for x in " ".join(context.args).split("|", 1)]
    if len(parts) != 2 or not all(parts):
        await update.effective_message.reply_text("Uso: /etichette id_conversazione | tag1,tag2")
        return
    labels = [x.strip() for x in parts[1].split(",") if x.strip()]
    await stage_change(update, {"action": "conversation_update", "payload": {"id": parts[0], "labels": labels}}, "Etichette conversazione preparate.")


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
    reply = str(result.get("reply") or result.get("message") or result.get("answer") or "").strip()
    if not reply:
        try:
            reply = await openai_text(text)
        except Exception:
            log.exception("AI conversational fallback unavailable")
    if not reply:
        reply = "Sono qui. Posso aiutarti con CRM, conversazioni, lead, prompt, canali, follow-up e campagne. Dimmi cosa vuoi fare."
    change = result.get("change")
    if isinstance(change, dict) and change.get("action"):
        is_valid, missing = valid_change(change)
        if not is_valid:
            reply += "\n\nNon ho preparato alcuna modifica: mancano dati necessari (" + missing + ")."
            change = None
    if isinstance(change, dict) and change.get("action"):
        if change.get("action") == "sales_broadcast":
            try:
                targets = await broadcast_targets((change.get("payload") or {}).get("segment"))
                if not targets:
                    await update.effective_message.reply_text("Non ho trovato destinatari idonei: non ho preparato alcun invio.")
                    return
                reply += f"\n\nPubblico trovato: {len(targets)} clienti con conversazione Telegram."
            except Exception:
                log.exception("AI broadcast preview unavailable")
                await update.effective_message.reply_text("⚠️ Non riesco a verificare il pubblico: non ho preparato alcun invio.")
                return
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


async def prompt_txt_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Stage a UTF-8 text file as a new CRM prompt version; never execute it."""
    if not authorized(update):
        return
    document = update.effective_message.document
    if not document:
        return
    filename = document.file_name or "prompt.txt"
    if not filename.lower().endswith(".txt"):
        await update.effective_message.reply_text("Invia un file .txt per importare un prompt.")
        return
    if document.file_size and document.file_size > 1_000_000:
        await update.effective_message.reply_text("Il file supera 1 MB: invia un prompt più piccolo.")
        return
    try:
        telegram_file = await document.get_file()
        raw = bytes(await telegram_file.download_as_bytearray())
        content = raw.decode("utf-8-sig").strip()
    except UnicodeDecodeError:
        await update.effective_message.reply_text("Il file deve essere testo UTF-8.")
        return
    except Exception:
        log.exception("TXT prompt download failed")
        await update.effective_message.reply_text("⚠️ Non riesco a leggere il file TXT.")
        return
    if len(content) < 20:
        await update.effective_message.reply_text("Il file è vuoto o troppo corto per essere un prompt.")
        return
    prompt_name = Path(filename).stem.replace("_", " ")[:120]
    change = {"action": "prompt_update", "payload": {"name": prompt_name, "content": content}}
    await stage_change(update, change, f"📄 Prompt '{prompt_name}' letto ({len(content):,} caratteri). Nuova versione pronta:")


def main():
    init_db()
    log.info("Starting XAU Machine admin Telegram bot")
    threading.Thread(target=start_health_server, name="health-server", daemon=True).start()
    async def post_init(application):
        me = await application.bot.get_me()
        log.info("Admin Telegram bot connected: @%s; authorized IDs configured: %s", me.username, bool(ADMIN_IDS))

    app = Application.builder().token(TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("briefing", briefing))
    app.add_handler(CommandHandler("conversazioni", list_conversations))
    app.add_handler(CommandHandler("analizza", analyze_conversation))
    app.add_handler(CommandHandler("prompt", prepare_prompt))
    app.add_handler(CommandHandler("topic", prepare_topic))
    app.add_handler(CommandHandler("invia", prepare_sales_send))
    app.add_handler(CommandHandler("nondepositati", prepare_non_deposit_broadcast))
    app.add_handler(CommandHandler("lead", prepare_lead))
    app.add_handler(CommandHandler("canale", prepare_channel))
    app.add_handler(CommandHandler("regola", prepare_rule))
    app.add_handler(CommandHandler("stato", prepare_status))
    app.add_handler(CommandHandler("etichette", prepare_labels))
    app.add_handler(CommandHandler("conferma", confirm))
    app.add_handler(CommandHandler("annulla", cancel))
    app.add_handler(MessageHandler(filters.VOICE, voice_message))
    app.add_handler(MessageHandler(filters.PHOTO, photo_message))
    app.add_handler(MessageHandler(filters.Document.ALL, prompt_txt_message))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
    app.run_polling(drop_pending_updates=False)


if __name__ == "__main__":
    main()
