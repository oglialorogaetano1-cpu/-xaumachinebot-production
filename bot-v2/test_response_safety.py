"""Simulazione locale di 50 risposte cliente: nessuna API o chat reale."""
from __future__ import annotations

import ast
import json
import re
from pathlib import Path


def load_parser():
    source = Path(__file__).with_name("app.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    parser = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == "_estrai_risposta_cliente"
    )
    module = ast.Module(body=[parser], type_ignores=[])
    ast.fix_missing_locations(module)
    namespace = {"json": json, "re": re}
    exec(compile(module, "app.py", "exec"), namespace)
    return namespace["_estrai_risposta_cliente"]


def main() -> None:
    parse = load_parser()
    metadata = {
        "intent": "faq",
        "reply_text": "Testo interno che non deve mai essere inviato due volte.",
        "next_action": "wait_customer_reply",
    }
    metadata_json = json.dumps(metadata)
    cases: list[tuple[str, str]] = []

    # 15 risposte normali in lingue diverse.
    replies = [
        "Certo, ti spiego il passaggio successivo.",
        "Yes, I can guide you through the registration.",
        "Oui, je peux vous guider pour l'inscription.",
        "Claro, te ayudo con el siguiente paso.",
        "Natürlich, ich helfe dir bei der Registrierung.",
    ]
    for index in range(15):
        reply = replies[index % len(replies)]
        cases.append((reply, reply))

    # 15 casi osservati: testo cliente seguito da JSON in blocco Markdown.
    for index in range(15):
        reply = f"Risposta breve al cliente {index + 1}."
        cases.append((f"{reply}\n```json\n{metadata_json}\n```", reply))

    # 10 varianti senza delimitatori Markdown.
    for index in range(10):
        reply = f"Risposta senza metadati visibili {index + 1}."
        cases.append((f"{reply}\n{metadata_json}", reply))

    # 10 risposte JSON pure: deve uscire soltanto reply_text.
    for _ in range(10):
        cases.append((metadata_json, metadata["reply_text"]))

    assert len(cases) == 50
    for number, (raw, expected) in enumerate(cases, start=1):
        reply, _ = parse(raw)
        assert reply == expected, f"scenario {number}: {reply!r}"
        assert "```" not in reply and '"intent"' not in reply

    print("50/50 scenari risposta superati")


if __name__ == "__main__":
    main()
