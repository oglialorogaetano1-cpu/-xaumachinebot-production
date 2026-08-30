# XAU Machine — handoff per Claude Cowork

Questa cartella contiene l'ultima sorgente disponibile del progetto XAU Machine, recuperata dal repository GitHub.

## Componenti inclusi

- `bot-v2/`: bot Telegram v2 separato dal vecchio supervisore.
- `puprime_worker.py`: worker browser PU Prime e sincronizzazione protetta verso Supabase.
- `Dockerfile` e `requirements.txt`: immagine del worker PU Prime.
- `bot-v2/Dockerfile` e `bot-v2/requirements.txt`: immagine del bot Telegram v2.
- `.env.example`: soli nomi delle variabili, senza valori sensibili.
- `docs/PROJECT_STATUS.md`: stato funzionale, campagne, regole e attività mancanti.

## Regola di collaborazione

Lavora su un branch separato `claude-vps`. Non modificare direttamente `main`. Non inserire token, password, cookie, profili browser, credenziali MT5 o PU Prime nel repository.

Prima di ogni modifica:

1. Leggi `docs/PROJECT_STATUS.md`.
2. Controlla l'ultima versione di `main`.
3. Mantieni una sola istanza Telegram attiva per lo stesso token.
4. Esegui test locali senza utilizzare dati reali nei log.
5. Al termine crea commit e Pull Request con test eseguiti e variabili richieste.

## Avvio locale bot v2

```bash
cd bot-v2
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Su Windows PowerShell, l'attivazione dell'ambiente virtuale è `.venv\\Scripts\\Activate.ps1`.

## Avvio worker PU Prime

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
python puprime_worker.py
```

Per la produzione PU Prime usare la VPS Windows con profilo browser persistente. Il worker non deve tentare di aggirare CAPTCHA o verifiche: deve riutilizzare la sessione autorizzata e notificare quando serve intervento manuale.
