"""
Parser dei messaggi della sala segnali XAU Machine.

Regola fondamentale: se un dato non è scritto chiaramente nel messaggio,
il campo resta None. Non si inventano prezzi, simboli o direzioni.

Riconosce due tipi di messaggio:
- "apertura": un nuovo segnale (simbolo + direzione BUY/SELL, con o senza
  entry/SL/TP)
- "aggiornamento": un riferimento a un segnale già aperto (es. "TP1
  raggiunto", "SL colpito", "chiuso manualmente"), in italiano o inglese

Se il testo non corrisponde a nessuno dei due schemi, viene comunque salvato
in signal_messages (dal chiamante) ma parse_signal_message restituisce
tipo="non_riconosciuto" e nessun campo strutturato.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


SYMBOL_ALIASES = {
    "GOLD": "XAUUSD",
    "ORO": "XAUUSD",
    "XAU": "XAUUSD",
    "XAUUSD": "XAUUSD",
    "SILVER": "XAGUSD",
    "ARGENTO": "XAGUSD",
    "XAG": "XAGUSD",
    "XAGUSD": "XAGUSD",
}

# simboli forex/indici comuni, per non limitarsi solo a oro/argento
_SYMBOL_TOKEN = re.compile(
    r"\b(XAUUSD|XAGUSD|GOLD|ORO|SILVER|ARGENTO|XAU|XAG|"
    r"EURUSD|GBPUSD|USDJPY|USDCHF|AUDUSD|NZDUSD|USDCAD|"
    r"US30|NAS100|SPX500|GER40|BTCUSD|ETHUSD)\b",
    re.IGNORECASE,
)

_DIRECTION = re.compile(r"\b(BUY|LONG|COMPRA|ACQUISTO|SELL|SHORT|VENDI|VENDITA)\b", re.IGNORECASE)
_DIRECTION_MAP = {
    "BUY": "BUY", "LONG": "BUY", "COMPRA": "BUY", "ACQUISTO": "BUY",
    "SELL": "SELL", "SHORT": "SELL", "VENDI": "SELL", "VENDITA": "SELL",
}

_NUM = r"(\d{1,6}(?:[.,]\d{1,5})?)"

_ENTRY = re.compile(
    rf"(?:entry|ingresso|apertura|@)\s*[:=]?\s*{_NUM}", re.IGNORECASE
)
_SL = re.compile(
    rf"(?:stop\s*loss|s\.?l\.?)\s*[:=]?\s*{_NUM}", re.IGNORECASE
)
# TP1/TP2/TP3... con numero esplicito (il livello deve stare attaccato a
# "tp", o "take profit" seguito da un numero: senza questo vincolo "TP
# 2408/2400/2390" verrebbe letto per errore come "livello=2, prezzo=408").
# Oppure lista "TP 2420/2426/2435" (vedi _TP_LIST sotto).
_TP_NUMBERED = re.compile(
    rf"(?:tp(\d)|take\s*profit\s+(\d))\s*[:=]?\s*{_NUM}", re.IGNORECASE
)
_TP_LIST = re.compile(
    rf"(?:take\s*profit|tp)\s*[:=]?\s*({_NUM}(?:\s*[/,]\s*{_NUM})*)", re.IGNORECASE
)

_TP_HIT = re.compile(r"\btp\s*(\d)\b.{0,20}?(raggiunt|hit|preso|centrat)", re.IGNORECASE)
_TP_HIT_REVERSE = re.compile(r"(raggiunt|hit|preso|centrat).{0,20}?\btp\s*(\d)\b", re.IGNORECASE)
_SL_HIT = re.compile(r"\b(s\.?l\.?|stop\s*loss)\b.{0,20}?(raggiunt|hit|colpit|toccat)", re.IGNORECASE)
_CLOSED_MANUAL = re.compile(
    r"chius[oa]\s+manual|closed\s+manual|chiusura\s+manuale|chiudo\s+manual",
    re.IGNORECASE,
)
_CLOSED_GENERIC = re.compile(r"\bchius[oa]\b|\bclosed\b", re.IGNORECASE)


@dataclass
class ParsedSignal:
    tipo: str  # "apertura" | "aggiornamento" | "non_riconosciuto"
    symbol: str | None = None
    direction: str | None = None
    entry_price: float | None = None
    stop_loss: float | None = None
    targets: list[float] = field(default_factory=list)  # TP1, TP2, TP3... in ordine
    update_kind: str | None = None  # "tp_hit" | "sl_hit" | "closed_manual" | "closed"
    update_level: int | None = None  # per tp_hit: quale TP (1,2,3...)


def _to_float(s: str) -> float:
    return float(s.replace(",", "."))


def _normalize_symbol(raw: str | None) -> str | None:
    if not raw:
        return None
    return SYMBOL_ALIASES.get(raw.upper(), raw.upper())


def parse_signal_message(text: str) -> ParsedSignal:
    if not text or not text.strip():
        return ParsedSignal(tipo="non_riconosciuto")

    symbol_match = _SYMBOL_TOKEN.search(text)
    symbol = _normalize_symbol(symbol_match.group(1)) if symbol_match else None

    direction_match = _DIRECTION.search(text)
    direction = _DIRECTION_MAP.get(direction_match.group(1).upper()) if direction_match else None

    # --- caso "aggiornamento" di un segnale esistente ---------------------
    tp_hit = _TP_HIT.search(text) or _TP_HIT_REVERSE.search(text)
    if tp_hit:
        level_str = tp_hit.group(1) if tp_hit.re is _TP_HIT else tp_hit.group(2)
        return ParsedSignal(
            tipo="aggiornamento", symbol=symbol, update_kind="tp_hit",
            update_level=int(level_str),
        )
    if _SL_HIT.search(text):
        return ParsedSignal(tipo="aggiornamento", symbol=symbol, update_kind="sl_hit")
    if _CLOSED_MANUAL.search(text):
        return ParsedSignal(tipo="aggiornamento", symbol=symbol, update_kind="closed_manual")
    if _CLOSED_GENERIC.search(text) and not (symbol and direction):
        # "chiuso"/"closed" da solo, senza contesto di apertura -> aggiornamento generico
        return ParsedSignal(tipo="aggiornamento", symbol=symbol, update_kind="closed")

    # --- caso "apertura" di un nuovo segnale -------------------------------
    if symbol and direction:
        entry_m = _ENTRY.search(text)
        sl_m = _SL.search(text)

        targets: list[float] = []
        numbered = _TP_NUMBERED.findall(text)
        if numbered:
            # ogni match è (livello_forma_corta, livello_forma_lunga, prezzo)
            ordered = sorted(
                ((int(n1 or n2), _to_float(v)) for n1, n2, v in numbered),
                key=lambda x: x[0],
            )
            targets = [v for _, v in ordered]
        else:
            list_m = _TP_LIST.search(text)
            if list_m:
                nums = re.split(r"\s*[/,]\s*", list_m.group(1))
                targets = [_to_float(n) for n in nums if n]

        return ParsedSignal(
            tipo="apertura",
            symbol=symbol,
            direction=direction,
            entry_price=_to_float(entry_m.group(1)) if entry_m else None,
            stop_loss=_to_float(sl_m.group(1)) if sl_m else None,
            targets=targets,
        )

    return ParsedSignal(tipo="non_riconosciuto", symbol=symbol, direction=direction)
