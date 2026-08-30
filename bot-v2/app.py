import os
import asyncio
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
CRM_TRACKING_SECRET = os.environ.get("CRM_TRACKING_SECRET", "")
CRM_TENANT_SLUG = os.environ.get("CRM_TENANT_SLUG", "xau-machine")
CRM_HEADERS = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"}

AI_RUNTIME_RULES = """Sei l'assistente commerciale ufficiale di XAU Machine su Telegram.
Rispondi in modo naturale, fluido e breve nella lingua usata dal cliente.
Non chiedere al cliente di usare comandi: i comandi sono riservati all'amministratore.
Segui il prompt commerciale del CRM e usa lo storico della conversazione.
Non inventare verifiche IB, depositi, risultati, saldi o rendimenti. Non promettere guadagni
e spiega con chiarezza che il trading comporta il rischio di perdita. Se non hai un dato
reale o non sai rispondere, proponi il passaggio a un operatore umano."""

DEFAULT_WELCOME_MESSAGE = "Ciao 👋 Benvenuto in XAU Machine! 🚀\n\nSe hai già le idee chiare e vuoi unirti a noi, ecco il percorso rapido 👇\n\n🆕 DEVI ANCORA REGISTRARTI?\n\n🔗 Registrati su PU Prime da questo link:\nhttps://puvip.co/la-partners/Pvzi1lQC\n\n• Lascia vuoto “Codice di riferimento”\n• Completa la verifica del documento\n• Inviami Nome e Cognome per controllare il collegamento ✅\n\n⚠️ Non depositare ancora: aspetta la mia conferma e la guida per aprire il conto corretto:\n\n• Copy Popular Trading\n• Standard\n• Valuta EUR\n• Nessun voucher\n\n♻️ HAI GIÀ PU PRIME?\n\nScrivimi prima di procedere. Ti guiderò nel trasferimento utilizzando il codice IB:\n\n👉 23217421\n\n📊 SALA SEGNALI\n\nPuoi entrare gratuitamente per 7 giorni e copiare tutti i nostri segnali 👇\n\nhttps://t.me/+-e1_tDFps0Q2YmE0\n\nSe vuoi iniziare subito, scrivimi cosa hai già fatto. Se invece vuoi conoscere risultati, rischi, differenze tra bot e sala segnali o capire come funziona tutto, chiedimi pure liberamente 😊"

# ---------------------------------------------------------- richieste MT5
# Parole/frasi che fanno riconoscere una richiesta di vedere l'andamento
# del conto reale, in testo libero (nessun comando obbligatorio).
_PAROLE_SCREENSHOT = (
    "screenshot", "screen shot", "uno screen", "una foto del conto",
    "vedere il conto", "vedi il conto", "far vedere il conto",
    "come sta andando", "come va il conto", "come vanno i risultati",
    "com'è andato", "come è andato", "com'e' andato",
    "andamento", "risultato di oggi",
    "risultati di oggi", "risultato della settimana", "risultato del mese",
    "quanto ha fatto", "quanto sta facendo", "saldo del conto",
    "aggiornamento del conto", "stato del conto",
    "mandami", "fammi vedere", "mostrami",
)
_PAROLE_PERIODO = (
    ("ultimi 6 mesi", "6mesi"), ("6 mesi", "6mesi"), ("sei mesi", "6mesi"),
    ("questo mese", "mese"), ("del mese", "mese"), ("mensile", "mese"), ("mese", "mese"),
    ("settimanale", "settimana"), ("settimana", "settimana"),
    ("oggi", "oggi"), ("giornata", "oggi"), ("giornaliero", "oggi"),
)


def rileva_richiesta_screenshot(testo: str) -> str | None:
    """Ritorna il periodo richiesto ('oggi'/'settimana'/'mese'/'6mesi') se il
    messaggio sembra chiedere l'andamento del conto, altrimenti None.
    Riconoscimento a parole chiave: nessuna chiamata AI, cosi' resta
    veloce, gratuito e prevedibile per un'intenzione cosi' specifica."""
    t = (testo or "").strip().lower()
    if not t:
        return None
    if not any(p in t for p in _PAROLE_SCREENSHOT):
        return None
    for chiave, periodo in _PAROLE_PERIODO:
        if chiave in t:
            return periodo
    return "oggi"


async def crea_richiesta_screenshot(table_row: dict) -> dict | None:
    """Crea una richiesta tramite RPC protetta.

    Railway non riceve la service_role: usa la stessa chiave pubblicabile
    delle altre RPC e il segreto runtime del tenant.
    """
    try:
        headers = dict(CRM_HEADERS)
        headers.pop("Prefer", None)
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/crm_request_mt5_snapshot",
                headers=headers,
                json={
                    "p_secret": CRM_TRACKING_SECRET,
                    "p_tenant_slug": CRM_TENANT_SLUG,
                    "p_telegram_chat_id": table_row["telegram_chat_id"],
                    "p_telegram_user_id": table_row.get("telegram_user_id"),
                    "p_periodo": table_row.get("periodo", "oggi"),
                    "p_richiesta_testo": table_row.get("richiesta_testo", ""),
                },
            )
        if r.status_code >= 300:
            log.warning("MT5 snapshot RPC insert %s: %s", r.status_code, r.text[:300])
            return None
        request_id = r.json()
        return {"id": request_id} if request_id else None
    except Exception as exc:
        log.warning("MT5 snapshot RPC insert non riuscito: %s", exc)
        return None


async def attendi_e_invia_screenshot(context: ContextTypes.DEFAULT_TYPE, chat_id: int,
                                      riga_id: str, tentativi_max: int = 20,
                                      attesa_secondi: float = 3.0) -> None:
    """Fa polling della riga finche' il worker MT5 sulla VPS non la segna
    'fatto' (o 'errore'), poi manda la foto nella stessa chat. Timeout
    totale: ~tentativi_max * attesa_secondi (default 60s)."""
    for _ in range(tentativi_max):
        await asyncio.sleep(attesa_secondi)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    f"{SUPABASE_URL}/rest/v1/rpc/crm_get_mt5_snapshot_request",
                    headers=CRM_HEADERS,
                    params={
                        "p_secret": CRM_TRACKING_SECRET,
                        "p_tenant_slug": CRM_TENANT_SLUG,
                        "p_request_id": riga_id,
                        "p_telegram_chat_id": str(chat_id),
                    },
                )
            righe = r.json() if r.status_code < 300 else []
        except Exception as exc:
            log.warning("Polling richiesta MT5 fallito: %s", exc)
            continue
        if not righe:
            continue
        riga = righe[0]
        stato = riga.get("stato")
        if stato == "fatto" and riga.get("immagine_url"):
            # Il conto deve essere realmente autenticato: profitto e numero di
            # operazioni possono essere zero in una giornata senza trade, ma
            # login, balance ed equity non possono mancare o essere a zero.
            try:
                metriche_valide = (
                    int(riga.get("account_login") or 0) > 0
                    and float(riga.get("balance") or 0) > 0
                    and float(riga.get("equity") or 0) > 0
                    and bool((riga.get("account_server") or "").strip())
                )
            except (TypeError, ValueError):
                metriche_valide = False
            if not metriche_valide:
                log.error("Snapshot MT5 %s rifiutato: conto non autenticato o saldo non valido", riga_id)
                await context.bot.send_message(
                    chat_id=chat_id,
                    text=("Il terminale MT5 non sta restituendo dati validi del conto. "
                          "Non ti mando uno screenshot vuoto: ho avvisato l'operatore "
                          "per controllare la connessione."),
                )
                if ADMIN_CHAT_ID:
                    try:
                        await context.bot.send_message(
                            chat_id=int(ADMIN_CHAT_ID),
                            text=f"⚠️ Snapshot MT5 {riga_id}: terminale non autenticato sul conto reale o saldo non valido.",
                        )
                    except Exception:
                        pass
                return
            try:
                await context.bot.send_photo(
                    chat_id=chat_id, photo=riga["immagine_url"],
                    caption="📊 Ecco l'andamento del conto reale.",
                )
            except Exception as exc:
                log.warning("Invio foto MT5 fallito: %s", exc)
                try:
                    await context.bot.send_message(
                        chat_id=chat_id,
                        text="Ho lo screenshot pronto ma non riesco a mandartelo adesso: riprova tra poco.",
                    )
                except Exception:
                    pass
            return
        if stato == "errore":
            try:
                await context.bot.send_message(
                    chat_id=chat_id,
                    text="Non sono riuscito a recuperare i dati del conto in questo momento. "
                         "Ci riprovo tra poco, oppure scrivi /intervento_umano.",
                )
            except Exception:
                pass
            return
    try:
        await context.bot.send_message(
            chat_id=chat_id,
            text="Ci sto mettendo più del previsto a recuperare i dati del conto: appena pronti te li mando qui.",
        )
    except Exception:
        pass


async def richiedi_screenshot_mt5(update: Update, context: ContextTypes.DEFAULT_TYPE,
                                   periodo: str, testo_originale: str = "") -> None:
    msg = update.effective_message
    chat = update.effective_chat
    if msg is None or chat is None:
        return
    user = update.effective_user
    await record_message(update, "in", testo_originale, "lead")
    riga = await crea_richiesta_screenshot({
        "telegram_chat_id": chat.id,
        "telegram_user_id": user.id if user else None,
        "periodo": periodo,
        "richiesta_testo": (testo_originale or "")[:500],
        "stato": "pending",
    })
    if not riga or not riga.get("id"):
        await msg.reply_text("Non sono riuscito a registrare la richiesta, riprova tra poco o scrivi /intervento_umano.")
        return
    attesa = "Un attimo, controllo il conto reale… 📊"
    await msg.reply_text(attesa)
    await record_message(update, "out", attesa, "ai")
    asyncio.create_task(attendi_e_invia_screenshot(context, chat.id, riga["id"]))


async def get_welcome_message(deep_link_code: str):
    """Read the active /start copy from the CRM, with a local fallback."""
    try:
        headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/crm_get_telegram_welcome",
                headers=headers,
                json={"p_deep_link_code": deep_link_code or "tg_direct"},
            )
        if r.status_code < 300:
            configured = r.json()
            if configured:
                return configured
        if r.status_code >= 300:
            log.warning("Welcome message CRM read failed: %s %s", r.status_code, r.text[:200])
    except Exception as exc:
        log.warning("Welcome message CRM unavailable: %s", exc)
    return DEFAULT_WELCOME_MESSAGE

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


async def record_message(update: Update, direction="in", body: str | None = None,
                         sender_type: str | None = None) -> dict:
    """Registra il messaggio nel CRM e restituisce prompt + memoria recente.

    La scrittura diretta precedente usava colonne che non esistono. Questa RPC
    protetta crea/aggiorna lead e conversazione e mantiene la memoria anche dopo
    un riavvio di Railway.
    """
    if not update.effective_user or not update.effective_chat:
        return {}
    user = update.effective_user
    if body is None:
        body = update.effective_message.text if update.effective_message else ""
    payload = {
        "p_secret": CRM_TRACKING_SECRET,
        "p_tenant_slug": CRM_TENANT_SLUG,
        "p_telegram_user_id": user.id,
        "p_telegram_chat_id": update.effective_chat.id,
        "p_full_name": user.full_name or "",
        "p_username": user.username or "",
        "p_direction": direction,
        "p_body": (body or "")[:8000],
        "p_sender_type": sender_type,
    }
    try:
        headers = dict(CRM_HEADERS)
        headers.pop("Prefer", None)
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/crm_bot_message",
                headers=headers, json=payload,
            )
        if r.status_code >= 300:
            log.warning("CRM bot message %s: %s", r.status_code, r.text[:300])
            return {}
        return r.json() or {}
    except Exception as exc:
        log.warning("CRM bot message non disponibile: %s", exc)
        return {}


def _testo_risposta_openai(data: dict) -> str:
    parti = []
    for item in data.get("output") or []:
        if item.get("type") != "message":
            continue
        for content in item.get("content") or []:
            if content.get("type") == "output_text" and content.get("text"):
                parti.append(content["text"])
    return "\n".join(parti).strip()


async def genera_risposta_ai(testo: str, contesto: dict) -> str:
    prompt_crm = (contesto.get("prompt") or "").strip()
    instructions = AI_RUNTIME_RULES
    if prompt_crm:
        instructions += "\n\nPROMPT COMMERCIALE ATTIVO DAL CRM:\n" + prompt_crm
    history = contesto.get("history") or []
    input_items = []
    for item in history[-20:]:
        role = item.get("role")
        content = (item.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            input_items.append({"role": role, "content": content[:8000]})
    if not input_items or input_items[-1].get("role") != "user":
        input_items.append({"role": "user", "content": testo[:8000]})
    # La chiave OpenAI rimane in Supabase Vault. Railway invia soltanto il
    # testo necessario alla Edge Function protetta e riceve la risposta.
    async with httpx.AsyncClient(timeout=55) as client:
        r = await client.post(
            f"{SUPABASE_URL}/functions/v1/crm-ai-chat",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "runtime_secret": CRM_TRACKING_SECRET,
                "tenant_slug": CRM_TENANT_SLUG,
                "instructions": instructions,
                "input": input_items,
            },
        )
    if r.status_code >= 300:
        raise RuntimeError(f"CRM AI {r.status_code}: {r.text[:240]}")
    risposta = (r.json().get("text") or "").strip()
    if not risposta:
        raise RuntimeError("OpenAI non ha restituito testo")
    return risposta

async def track_start(update: Update, deep_link_code: str):
    if not CRM_TRACKING_SECRET or not update.effective_user or not update.effective_chat:
        return
    user = update.effective_user
    payload = {
        "p_secret": CRM_TRACKING_SECRET,
        "p_telegram_user_id": user.id,
        "p_telegram_chat_id": update.effective_chat.id,
        "p_full_name": user.full_name or "",
        "p_username": user.username or "",
        "p_deep_link_code": deep_link_code or "tg_direct",
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/crm_track_telegram_start",
                headers=CRM_HEADERS,
                json=payload,
            )
        if r.status_code >= 300:
            log.warning("Campaign tracking failed: %s %s", r.status_code, r.text[:200])
    except Exception as exc:
        log.warning("Campaign tracking unavailable: %s", exc)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    if msg is None:
        return
    deep_link_code = context.args[0] if context.args else "tg_direct"
    await track_start(update, deep_link_code)
    await record_message(update, "in", msg.text or "/start", "lead")
    welcome_message = await get_welcome_message(deep_link_code)
    await msg.reply_text(welcome_message, disable_web_page_preview=True)
    await record_message(update, "out", welcome_message, "ai")

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    if msg is None:
        return
    await msg.reply_text("/registrazione - link e procedura\n/sala_segnali - informazioni sala\n/verifica_ib - verifica iscrizione\n/deposito - stato deposito\n/guida_bot - guida accesso\n/screenshot - richiedi aggiornamento MT5\n/intervento_umano - parla con un operatore")

async def simple_reply(update, text):
    msg = update.effective_message
    if msg is None:
        return
    await record_message(update, "in", msg.text or "", "lead")
    await msg.reply_text(text)
    await record_message(update, "out", text, "ai")

async def registration(update, context): await simple_reply(update, "Per registrarti usa il link PU Prime indicato dal tuo referente. Dopo l'iscrizione scrivi qui e verifichiamo l'IB.")
async def signals(update, context): await simple_reply(update, "La sala segnali pubblica operazioni e risultati. Posso spiegarti differenze, rischi e modalità di accesso.")
async def verify_ib(update, context): await simple_reply(update, "La verifica IB può richiedere tempo. Quando disponibile, invia uno screenshot dell'area conto e controlliamo il collegamento.")
async def deposit(update, context): await simple_reply(update, "Per assistenza sul deposito non inviare password o codici. Posso passare la richiesta a un operatore.")
async def guide(update, context): await simple_reply(update, "Quando l'iscrizione sotto l'IB è verificata, riceverai la guida di accesso al bot e alla sala.")

async def screenshot(update, context):
    msg = update.effective_message
    testo = (msg.text if msg else "") or "/screenshot"
    await richiedi_screenshot_mt5(update, context, "oggi", testo)

async def human(update, context):
    msg = update.effective_message
    chat = update.effective_chat
    if msg is None or chat is None:
        return
    await record_message(update)
    chat_id = str(chat.id)
    await crm_insert("crm_human_handoffs", {"reason": "Richiesta operatore dal bot v2", "priority": "high", "status": "open", "channels": ["telegram","email","whatsapp","ringover"], "metadata": {"telegram_chat_id": chat_id}})
    await msg.reply_text("Ho registrato la richiesta e avvisato l'operatore.")
    if ADMIN_CHAT_ID:
        try:
            await context.bot.send_message(chat_id=int(ADMIN_CHAT_ID), text=f"Nuova richiesta operatore dal chat {chat_id}")
        except Exception as e: log.warning("Admin notification failed: %s", e)

async def text_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.effective_message
    if msg is None or not update.effective_chat:
        return
    testo = msg.text or ""
    periodo = rileva_richiesta_screenshot(testo)
    if periodo:
        await richiedi_screenshot_mt5(update, context, periodo, testo)
        return
    contesto = await record_message(update, "in", testo, "lead")
    try:
        risposta = await genera_risposta_ai(testo, contesto)
    except Exception as exc:
        log.error("Risposta AI non disponibile: %s", exc)
        risposta = ("In questo momento l'assistente automatico non riesce a rispondere. "
                    "Ho segnalato il problema: puoi riprovare tra poco oppure chiedermi "
                    "di parlare con un operatore.")
    await msg.reply_text(risposta, disable_web_page_preview=True)
    await record_message(update, "out", risposta, "ai")

async def on_error(update, context: ContextTypes.DEFAULT_TYPE):
    """Rete di sicurezza: qualunque eccezione non prevista finisce qui
    invece di far cadere il processo o restare silenziosa nei log."""
    log.error("Aggiornamento non gestito: %s", update, exc_info=context.error)

async def post_init(app):
    me = await app.bot.get_me()
    log.info("Telegram bot connected: @%s (id=%s)", me.username, me.id)

def main():
    threading.Thread(target=start_health_server, daemon=True, name="healthcheck").start()
    app = Application.builder().token(BOT_TOKEN).post_init(post_init).build()
    app.add_error_handler(on_error)
    for cmd, fn in {"start":start,"help":help_cmd,"registrazione":registration,"sala_segnali":signals,"verifica_ib":verify_ib,"deposito":deposit,"guida_bot":guide,"screenshot":screenshot,"intervento_umano":human}.items():
        app.add_handler(CommandHandler(cmd, fn))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_message))
    log.info("XAU Machine Bot v2 online")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
