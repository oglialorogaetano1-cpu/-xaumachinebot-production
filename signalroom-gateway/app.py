"""
signalroom-gateway — riceve i messaggi della sala segnali Telegram via
webhook, li salva integralmente, li interpreta con parser.py e aggiorna
Supabase. Nessun dato viene inventato: se il parser non riconosce un campo,
resta NULL.

Variabili d'ambiente richieste (impostate su Railway, mai stampate qui):
  BOT_TOKEN                 token del bot Telegram DEDICATO alla sala segnali
                             (deve essere un bot diverso da quello che parla
                             con i clienti, altrimenti i due entrano in
                             conflitto: un bot non può avere sia un webhook
                             sia il polling attivi insieme)
  WEBHOOK_SECRET             stringa segreta: Telegram la rimanda nell'header
                             X-Telegram-Bot-Api-Secret-Token, e la confrontiamo
                             per essere sicuri che la chiamata venga davvero
                             da Telegram
  WEBHOOK_AUTO_ENFORCE       "true"/"false": se true, all'avvio il servizio
                             chiama Telegram setWebhook per puntare al proprio
                             dominio pubblico Railway
  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_GATEWAY_SECRET
                             per scrivere nelle tabelle sala segnali via RPC
  CRM_TENANT_SLUG            default "xau-machine"
  TELEGRAM_SIGNAL_CHAT_ID    (opzionale) id numerico della chat/canale della
                             sala segnali. Se non impostata, il servizio
                             accetta messaggi da qualsiasi chat in cui il bot
                             è stato aggiunto e lo scrive nei log al primo
                             messaggio ricevuto, cosi' si puo' recuperare il
                             valore e impostarlo dopo, per restringere.
  PORT                       porta HTTP (Railway la imposta da sola)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx
from aiohttp import web

from parser import parse_signal_message

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("signalroom-gateway")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
WEBHOOK_AUTO_ENFORCE = os.environ.get("WEBHOOK_AUTO_ENFORCE", "false").lower() == "true"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_GATEWAY_SECRET = os.environ.get("SUPABASE_GATEWAY_SECRET", "")
CRM_TENANT_SLUG = os.environ.get("CRM_TENANT_SLUG", "xau-machine")

TELEGRAM_SIGNAL_CHAT_ID = os.environ.get("TELEGRAM_SIGNAL_CHAT_ID", "").strip()
TELEGRAM_SIGNAL_CHAT_ID = int(TELEGRAM_SIGNAL_CHAT_ID) if TELEGRAM_SIGNAL_CHAT_ID else None

PUBLIC_URL = os.environ.get("RAILWAY_PUBLIC_DOMAIN", "")

SUPA_HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
}

# stato di sincronizzazione in memoria, esposto da /health e utile al CRM
_stato = {
    "ultimo_messaggio_ricevuto": None,   # datetime ISO
    "ultimo_errore": None,               # testo breve, mai segreti
    "messaggi_ricevuti_totali": 0,
    "chat_id_visti": set(),
}


async def _rpc(client: httpx.AsyncClient, fn: str, payload: dict) -> httpx.Response:
    return await client.post(f"{SUPABASE_URL}/rest/v1/rpc/{fn}", headers=SUPA_HEADERS, json=payload)


def _costruisci_link_messaggio(chat_id: int, message_id: int) -> str | None:
    # Per canali/gruppi privati Telegram usa il formato t.me/c/<id_interno>/<msg>
    # (funziona solo per chi è già membro, ma è comunque il link "giusto").
    cid = str(chat_id)
    if cid.startswith("-100"):
        return f"https://t.me/c/{cid[4:]}/{message_id}"
    return None


async def _gestisci_messaggio(msg: dict, modificato: bool) -> None:
    chat = msg.get("chat", {})
    chat_id = chat.get("id")
    message_id = msg.get("message_id")
    text = msg.get("text") or msg.get("caption") or ""
    date_ts = msg.get("edit_date") if modificato else msg.get("date")
    message_date = datetime.fromtimestamp(date_ts, tz=timezone.utc).isoformat() if date_ts else None
    autore = None
    if msg.get("author_signature"):
        autore = msg["author_signature"]
    elif msg.get("from"):
        autore = msg["from"].get("username") or msg["from"].get("first_name")

    if TELEGRAM_SIGNAL_CHAT_ID is not None and chat_id != TELEGRAM_SIGNAL_CHAT_ID:
        log.info("Messaggio ignorato: chat_id %s diverso dalla sala configurata", chat_id)
        return

    _stato["chat_id_visti"].add(chat_id)
    _stato["ultimo_messaggio_ricevuto"] = datetime.now(tz=timezone.utc).isoformat()
    _stato["messaggi_ricevuti_totali"] += 1

    if not text:
        log.info("Messaggio senza testo (chat_id=%s, message_id=%s) ignorato dal parser, non salvato", chat_id, message_id)
        return

    link = _costruisci_link_messaggio(chat_id, message_id)

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await _rpc(client, "crm_signal_ingest_message", {
                "p_secret": SUPABASE_GATEWAY_SECRET,
                "p_tenant_slug": CRM_TENANT_SLUG,
                "p_telegram_chat_id": chat_id,
                "p_telegram_message_id": message_id,
                "p_author": autore,
                "p_message_text": text,
                "p_message_date": message_date,
                "p_message_link": link,
                "p_raw_update": msg,
            })
            r.raise_for_status()
            signal_message_id = r.json()
        except Exception as exc:
            _stato["ultimo_errore"] = f"scrittura signal_messages fallita: {exc}"
            log.warning(_stato["ultimo_errore"])
            return

        parsed = parse_signal_message(text)

        try:
            if parsed.tipo == "apertura":
                r2 = await _rpc(client, "crm_signal_upsert_trade", {
                    "p_secret": SUPABASE_GATEWAY_SECRET,
                    "p_tenant_slug": CRM_TENANT_SLUG,
                    "p_signal_message_id": signal_message_id,
                    "p_symbol": parsed.symbol,
                    "p_direction": parsed.direction,
                    "p_entry_price": parsed.entry_price,
                    "p_stop_loss": parsed.stop_loss,
                    "p_strategia": None,
                    "p_testo_originale": text,
                    "p_opened_at": message_date,
                })
                r2.raise_for_status()
                trading_signal_id = r2.json()

                if parsed.stop_loss is not None:
                    await _rpc(client, "crm_signal_set_target", {
                        "p_secret": SUPABASE_GATEWAY_SECRET, "p_tenant_slug": CRM_TENANT_SLUG,
                        "p_trading_signal_id": trading_signal_id, "p_target_kind": "SL",
                        "p_level": None, "p_price": parsed.stop_loss,
                    })
                for livello, prezzo in enumerate(parsed.targets, start=1):
                    await _rpc(client, "crm_signal_set_target", {
                        "p_secret": SUPABASE_GATEWAY_SECRET, "p_tenant_slug": CRM_TENANT_SLUG,
                        "p_trading_signal_id": trading_signal_id, "p_target_kind": "TP",
                        "p_level": livello, "p_price": prezzo,
                    })

            elif parsed.tipo == "aggiornamento" and parsed.symbol:
                # trova il segnale aperto più recente su questo simbolo per collegare l'update
                # (RPC, non una select diretta: le tabelle sono leggibili solo da
                # "authenticated"/CRM, il gateway usa la anon key + secret)
                r3 = await _rpc(client, "crm_find_open_signal", {
                    "p_secret": SUPABASE_GATEWAY_SECRET,
                    "p_tenant_slug": CRM_TENANT_SLUG,
                    "p_symbol": parsed.symbol,
                })
                r3.raise_for_status()
                trading_signal_id = r3.json()
                if not trading_signal_id:
                    log.info("Aggiornamento (%s) su %s senza un segnale aperto corrispondente: solo il messaggio grezzo resta salvato", parsed.update_kind, parsed.symbol)
                else:
                    if parsed.update_kind == "tp_hit":
                        await _rpc(client, "crm_signal_hit_target", {
                            "p_secret": SUPABASE_GATEWAY_SECRET, "p_tenant_slug": CRM_TENANT_SLUG,
                            "p_trading_signal_id": trading_signal_id, "p_target_kind": "TP",
                            "p_level": parsed.update_level, "p_hit_at": message_date,
                        })
                    elif parsed.update_kind == "sl_hit":
                        await _rpc(client, "crm_signal_hit_target", {
                            "p_secret": SUPABASE_GATEWAY_SECRET, "p_tenant_slug": CRM_TENANT_SLUG,
                            "p_trading_signal_id": trading_signal_id, "p_target_kind": "SL",
                            "p_level": None, "p_hit_at": message_date,
                        })
                        await _rpc(client, "crm_signal_close", {
                            "p_secret": SUPABASE_GATEWAY_SECRET, "p_tenant_slug": CRM_TENANT_SLUG,
                            "p_trading_signal_id": trading_signal_id, "p_status": "sl",
                            "p_closed_at": message_date,
                        })
                    elif parsed.update_kind in ("closed_manual", "closed"):
                        stato = "chiuso_manuale" if parsed.update_kind == "closed_manual" else "chiuso"
                        await _rpc(client, "crm_signal_close", {
                            "p_secret": SUPABASE_GATEWAY_SECRET, "p_tenant_slug": CRM_TENANT_SLUG,
                            "p_trading_signal_id": trading_signal_id, "p_status": stato,
                            "p_closed_at": message_date,
                        })
            # tipo == "non_riconosciuto": il messaggio grezzo resta comunque
            # salvato sopra, senza creare/aggiornare nessun segnale strutturato.

        except Exception as exc:
            _stato["ultimo_errore"] = f"aggiornamento trading_signals fallito: {exc}"
            log.warning(_stato["ultimo_errore"])


async def handle_webhook(request: web.Request) -> web.Response:
    header_secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not WEBHOOK_SECRET or header_secret != WEBHOOK_SECRET:
        log.warning("Webhook chiamato con secret_token mancante o errato, rifiutato (401)")
        return web.json_response({"ok": False}, status=401)

    try:
        update = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "json non valido"}, status=400)

    msg = update.get("channel_post") or update.get("message")
    edited = update.get("edited_channel_post") or update.get("edited_message")

    if msg:
        await _gestisci_messaggio(msg, modificato=False)
    elif edited:
        await _gestisci_messaggio(edited, modificato=True)
    # Nota: l'API Bot di Telegram non invia alcun evento quando un messaggio
    # viene CANCELLATO (solo per le modifiche, tramite edited_*). Per
    # rilevare le cancellazioni servirebbe un account utente Telegram
    # (Telethon/Pyrogram con API_ID/API_HASH/sessione) — vedi nota nel
    # README del servizio: funzionalità non presente in questa versione,
    # dichiarata esplicitamente, non finta.

    return web.json_response({"ok": True})


async def handle_health(request: web.Request) -> web.Response:
    return web.json_response({
        "status": "ok",
        "tenant": CRM_TENANT_SLUG,
        "chat_id_configurato": TELEGRAM_SIGNAL_CHAT_ID,
        "chat_id_visti_finora": sorted(_stato["chat_id_visti"]),
        "ultimo_messaggio_ricevuto": _stato["ultimo_messaggio_ricevuto"],
        "messaggi_ricevuti_totali": _stato["messaggi_ricevuti_totali"],
        "ultimo_errore": _stato["ultimo_errore"],
    })


async def _enforce_webhook(app: web.Application) -> None:
    if not (WEBHOOK_AUTO_ENFORCE and BOT_TOKEN and WEBHOOK_SECRET and PUBLIC_URL):
        log.info("WEBHOOK_AUTO_ENFORCE disattivo o variabili mancanti: setWebhook NON eseguito automaticamente")
        return
    url = f"https://{PUBLIC_URL}/webhook"
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook",
                json={
                    "url": url,
                    "secret_token": WEBHOOK_SECRET,
                    "allowed_updates": ["channel_post", "edited_channel_post", "message", "edited_message"],
                },
            )
            body = r.json()
            if body.get("ok"):
                log.info("Webhook Telegram impostato correttamente su %s", url)
            else:
                log.warning("setWebhook risposta non ok: %s", body.get("description"))
        except Exception as exc:
            log.warning("setWebhook fallito: %s", exc)


def crea_app() -> web.Application:
    app = web.Application()
    app.router.add_post("/webhook", handle_webhook)
    # Compatibilità con il vecchio webhook già registrato su Telegram.
    # Il nuovo endpoint canonico resta /webhook, ma /telegram evita di
    # perdere gli aggiornamenti durante la migrazione.
    app.router.add_post("/telegram", handle_webhook)
    app.router.add_get("/health", handle_health)
    app.on_startup.append(_enforce_webhook)
    return app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    web.run_app(crea_app(), port=port)
