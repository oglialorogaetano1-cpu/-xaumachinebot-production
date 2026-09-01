"""
Test locali del parser — nessuna rete, nessun database. Esegui con:
    python3 test_parser.py
"""

from parser import parse_signal_message

CASI = [
    # (testo, atteso: dict di controlli parziali)
    (
        "XAUUSD BUY Entry 2415.50 SL 2408.00 TP1 2420 TP2 2426 TP3 2435",
        dict(tipo="apertura", symbol="XAUUSD", direction="BUY",
             entry_price=2415.50, stop_loss=2408.00, targets=[2420.0, 2426.0, 2435.0]),
    ),
    (
        "🟢 GOLD SELL @2415 SL 2422 TP 2408/2400/2390",
        dict(tipo="apertura", symbol="XAUUSD", direction="SELL",
             entry_price=2415.0, stop_loss=2422.0, targets=[2408.0, 2400.0, 2390.0]),
    ),
    (
        "Nuovo segnale: ORO COMPRA ingresso: 2410 Stop Loss: 2402 Take Profit 1: 2418 Take Profit 2: 2425",
        dict(tipo="apertura", symbol="XAUUSD", direction="BUY",
             entry_price=2410.0, stop_loss=2402.0, targets=[2418.0, 2425.0]),
    ),
    (
        "TP1 raggiunto ✅ XAUUSD complimenti a tutti",
        dict(tipo="aggiornamento", symbol="XAUUSD", update_kind="tp_hit", update_level=1),
    ),
    (
        "XAUUSD hit TP2, ottimo lavoro team",
        dict(tipo="aggiornamento", symbol="XAUUSD", update_kind="tp_hit", update_level=2),
    ),
    (
        "SL colpito su GOLD, si riparte",
        dict(tipo="aggiornamento", symbol="XAUUSD", update_kind="sl_hit"),
    ),
    (
        "Chiuso manualmente XAUUSD in profitto parziale",
        dict(tipo="aggiornamento", symbol="XAUUSD", update_kind="closed_manual"),
    ),
    (
        "EURUSD SELL Entry 1.0850 SL 1.0890 TP1 1.0800",
        dict(tipo="apertura", symbol="EURUSD", direction="SELL",
             entry_price=1.0850, stop_loss=1.0890, targets=[1.0800]),
    ),
    (
        "Buongiorno a tutti, oggi partiamo con calma",
        dict(tipo="non_riconosciuto", symbol=None, direction=None),
    ),
    (
        "XAUUSD SELL",  # direzione+simbolo ma nessun prezzo: NON deve inventare nulla
        dict(tipo="apertura", symbol="XAUUSD", direction="SELL",
             entry_price=None, stop_loss=None, targets=[]),
    ),
]


def check(testo, attese):
    r = parse_signal_message(testo)
    ok = True
    dettagli = []
    for campo, atteso in attese.items():
        val = getattr(r, campo)
        if val != atteso:
            ok = False
            dettagli.append(f"{campo}: atteso={atteso!r} ottenuto={val!r}")
    return ok, dettagli


def main():
    passati = 0
    for testo, attese in CASI:
        ok, dettagli = check(testo, attese)
        stato = "OK " if ok else "FAIL"
        print(f"[{stato}] {testo[:60]!r}")
        if not ok:
            for d in dettagli:
                print(f"        {d}")
        else:
            passati += 1
    print(f"\n{passati}/{len(CASI)} casi passati")
    if passati != len(CASI):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
