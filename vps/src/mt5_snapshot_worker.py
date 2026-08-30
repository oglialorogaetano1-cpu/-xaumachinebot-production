"""Worker che genera screenshot MT5 reali su richiesta del CRM (Railway).

Come funziona (disegno a "coda protetta", niente porte aperte sulla VPS):

  1. Il bot CRM (bot-v2, su Railway) riceve dal cliente una richiesta in
     linguaggio libero ("fammi vedere il conto", "risultato di oggi", ecc.)
     o il comando /screenshot, e inserisce una riga in
     ``crm_mt5_snapshots`` su Supabase con stato "pending".
  2. Questo modulo, chiamato periodicamente dallo scheduler di servizio.py
     (ogni ~15 secondi), legge le righe "pending", le genera usando il
     terminale MT5 GIA' autenticato su questa VPS (stessa funzione usata da
     /provascreensettimana ecc.), carica l'immagine sullo Storage di
     Supabase e segna la riga come "fatto" con un link firmato temporaneo.
  3. Il bot CRM, che sta facendo polling della stessa riga, la vede
     "fatto" e manda la foto al cliente nella stessa chat.

Le credenziali MT5 (login/password/server) restano SOLO in config.yaml su
questa VPS: non vengono mai lette da questo modulo ne' spedite a Supabase.
Le uniche credenziali che questo modulo usa sono SUPABASE_URL e
SUPABASE_SERVICE_KEY, lette da ".env" alla radice del progetto (mai da
config.yaml/impostazioni.yaml, che finiscono nei backup zip) - stesso
schema gia' usato in iscrizioni.py per le credenziali email.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import requests

log = logging.getLogger("mt5bot.mt5_snapshot_worker")

TABELLA = "crm_mt5_snapshot_requests"
BUCKET = "mt5-screenshots"
TIMEOUT = 12          # secondi, per ogni singola chiamata HTTP
MAX_TENTATIVI = 3     # dopo tanti fallimenti la riga resta "errore" (niente retry infinito)
SCADENZA_LINK_SECONDI = 24 * 3600   # il link firmato dura 24h

_PERIODI_VALIDI = {"oggi": "oggi", "settimana": "settimana", "mese": "mese", "6mesi": "6mesi"}


# ------------------------------------------------------------ credenziali
def _credenziali(cfg: dict) -> tuple[str, str]:
    """Legge SUPABASE_URL / SUPABASE_SERVICE_KEY da ".env" alla radice.

    Deliberatamente separato da config.yaml, per lo stesso motivo delle
    credenziali email in iscrizioni.py: sono segreti, non vanno nei
    backup/zip del progetto."""
    try:
        from dotenv import dotenv_values
        valori = dotenv_values(Path(cfg["_root"]) / ".env")
    except Exception:
        valori = {}
    url = (valori.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    chiave = (valori.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY") or "").strip()
    return url, chiave


def _headers(chiave: str, extra: Optional[dict] = None) -> dict:
    h = {
        "apikey": chiave,
        "Authorization": f"Bearer {chiave}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def attivo(cfg: dict) -> bool:
    """Il worker si attiva da solo SOLO se le credenziali Supabase ci sono:
    su chi non usa ancora questa funzione (o durante il collaudo) non deve
    fare nulla, ne' scrivere errori nel log ad ogni giro."""
    url, chiave = _credenziali(cfg)
    return bool(url and chiave)


# ------------------------------------------------------------------ query
def _righe_pendenti(url: str, chiave: str, limite: int) -> list[dict]:
    r = requests.get(
        f"{url}/rest/v1/{TABELLA}",
        headers=_headers(chiave),
        params={
            "select": "*",
            "stato": "eq.pending",
            "order": "creato_il.asc",
            "limit": str(limite),
        },
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return r.json() or []


def _reclama(url: str, chiave: str, riga_id: str) -> bool:
    """Passa la riga a 'in_lavorazione' SOLO se e' ancora 'pending' (evita
    che due giri dello scheduler la processino due volte)."""
    r = requests.patch(
        f"{url}/rest/v1/{TABELLA}",
        headers=_headers(chiave, {"Prefer": "return=representation"}),
        params={"id": f"eq.{riga_id}", "stato": "eq.pending"},
        json={"stato": "in_lavorazione"},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    return bool(r.json())


def _aggiorna(url: str, chiave: str, riga_id: str, campi: dict) -> None:
    from datetime import datetime, timezone
    campi = dict(campi)
    campi["aggiornato_il"] = datetime.now(timezone.utc).isoformat()
    r = requests.patch(
        f"{url}/rest/v1/{TABELLA}",
        headers=_headers(chiave),
        params={"id": f"eq.{riga_id}"},
        json=campi,
        timeout=TIMEOUT,
    )
    r.raise_for_status()


def _segna_errore(url: str, chiave: str, riga: dict, messaggio: str) -> None:
    tentativi = int(riga.get("tentativi") or 0) + 1
    stato = "pending" if tentativi < MAX_TENTATIVI else "errore"
    try:
        _aggiorna(url, chiave, riga["id"], {
            "stato": stato,
            "tentativi": tentativi,
            "errore": messaggio[:500],
        })
    except Exception:
        log.exception("Non riesco nemmeno a segnare l'errore sulla riga %s", riga.get("id"))
    log.warning("Richiesta screenshot %s fallita (tentativo %s/%s): %s",
                riga.get("id"), tentativi, MAX_TENTATIVI, messaggio)


# ------------------------------------------------------------------ storage
def _carica_immagine(url: str, chiave: str, riga_id: str, percorso_png: str) -> str:
    """Carica il PNG nello Storage e restituisce un link firmato temporaneo."""
    oggetto = f"{riga_id}.png"
    with open(percorso_png, "rb") as fh:
        dati = fh.read()
    r = requests.post(
        f"{url}/storage/v1/object/{BUCKET}/{oggetto}",
        headers=_headers(chiave, {"Content-Type": "image/png", "x-upsert": "true"}),
        data=dati,
        timeout=TIMEOUT,
    )
    r.raise_for_status()

    r2 = requests.post(
        f"{url}/storage/v1/object/sign/{BUCKET}/{oggetto}",
        headers=_headers(chiave),
        json={"expiresIn": SCADENZA_LINK_SECONDI},
        timeout=TIMEOUT,
    )
    r2.raise_for_status()
    firmato = (r2.json() or {}).get("signedURL", "")
    if not firmato:
        raise RuntimeError("Supabase non ha restituito un link firmato per l'immagine")
    if firmato.startswith("/"):
        firmato = f"{url}/storage/v1{firmato}"
    return firmato


# -------------------------------------------------------------- una riga
def _elabora_una(cfg: dict, url: str, chiave: str, riga: dict) -> None:
    from . import app as app_mod
    from datetime import datetime, timezone
    import MetaTrader5 as mt5

    riga_id = riga["id"]
    periodo = _PERIODI_VALIDI.get(str(riga.get("periodo") or "oggi").lower(), "oggi")
    slot: dict = {"canale": "risultati", "bottone": False}
    if periodo != "oggi":
        slot["finestra"] = periodo

    cfg_periodo = app_mod._cfg_slot(cfg, slot)   # riuso interno: stessa finestra usata sopra
    snap = app_mod.snapshot(cfg_periodo)

    # snapshot() usa il terminale configurato dal progetto. Prima di produrre
    # o pubblicare immagini, verifichiamo direttamente la sessione MT5 attiva.
    info = mt5.account_info()
    if info is None:
        raise RuntimeError(f"MT5 non autenticato: {mt5.last_error()}")
    login = int(getattr(info, "login", 0) or 0)
    balance = float(getattr(info, "balance", 0) or 0)
    equity = float(getattr(info, "equity", 0) or 0)
    server = str(getattr(info, "server", "") or "").strip()
    expected_raw = (cfg.get("conto") or {}).get("login")
    try:
        expected_login = int(str(expected_raw).strip()) if expected_raw not in (None, "") else 0
    except (TypeError, ValueError):
        expected_login = 0

    if login <= 0 or balance <= 0 or equity <= 0 or not server:
        raise RuntimeError(
            f"Sessione MT5 non valida (login={login}, server={server or '-'}, "
            f"balance={balance:.2f}, equity={equity:.2f})"
        )
    if expected_login and login != expected_login:
        raise RuntimeError(
            f"Terminale MT5 collegato al conto sbagliato: atteso {expected_login}, trovato {login}"
        )

    png, _testo = app_mod.pubblica_aggiornamento(cfg, slot, dry=True)
    if not png:
        raise RuntimeError("Immagine MT5 non generata per il periodo richiesto")

    link = _carica_immagine(url, chiave, riga_id, png)

    _aggiorna(url, chiave, riga_id, {
        "stato": "fatto",
        "immagine_url": link,
        "profitto": snap.profit,
        "percentuale": snap.profit_pct,
        "operazioni": snap.total,
        "account_login": login,
        "account_server": server,
        "balance": balance,
        "equity": equity,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "errore": None,
    })
    log.info("Screenshot MT5 generato per richiesta %s (periodo=%s, %s operazioni, profitto %s)",
              riga_id, periodo, snap.total, snap.profit)


# --------------------------------------------------------------- ciclo
def elabora_richieste_pendenti(cfg: dict, limite: int = 5) -> int:
    """Chiamata dallo scheduler ogni ~15s. Restituisce quante righe ha
    processato (0 se non c'e' nulla da fare o se le credenziali Supabase
    non sono configurate)."""
    url, chiave = _credenziali(cfg)
    if not url or not chiave:
        return 0

    try:
        righe = _righe_pendenti(url, chiave, limite)
    except Exception as e:
        log.warning("Lettura coda screenshot MT5 fallita: %s", e)
        return 0

    fatte = 0
    for riga in righe:
        riga_id = riga.get("id")
        if not riga_id:
            continue
        try:
            if not _reclama(url, chiave, riga_id):
                continue   # gia' presa da un altro giro/processo
        except Exception as e:
            log.warning("Non riesco a prendere in carico la richiesta %s: %s", riga_id, e)
            continue

        try:
            _elabora_una(cfg, url, chiave, riga)
            fatte += 1
        except Exception as e:
            log.exception("Generazione screenshot MT5 fallita per richiesta %s", riga_id)
            _segna_errore(url, chiave, riga, str(e))
    return fatte
