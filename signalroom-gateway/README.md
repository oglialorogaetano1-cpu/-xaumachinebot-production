# signalroom-gateway

Riceve i messaggi della sala segnali Telegram XAU Machine, li salva grezzi
in `signal_messages` e li interpreta (simbolo, direzione, entry, SL, TP,
aggiornamenti "TP1 raggiunto"/"SL colpito"/"chiuso manualmente") scrivendo
in `trading_signals` / `signal_targets` / `signal_events` su Supabase.
Nessun dato viene inventato: un campo assente nel testo resta NULL.

Sostituisce il servizio Railway "signalroom-gateway" attualmente fermo su
`sleep infinity` (immagine placeholder, mai stato collegato a un vero
sorgente).

## Come funziona

Un bot Telegram **dedicato** alla sala segnali (deve essere un bot
DIVERSO da quello che parla con i clienti — vedi sotto) ha un webhook
puntato su `https://<dominio-railway>/webhook`. Ogni messaggio nuovo o
modificato nella sala arriva come update Telegram, viene validato con
l'header `X-Telegram-Bot-Api-Secret-Token` e processato.

## Variabili d'ambiente (impostate su Railway, servizio signalroom-gateway)

Già impostate da Claude in questa sessione (valori generati, non estratti
da nessuna parte, quindi sicuri da avere qui in chiaro nel codice/SQL):
- `SUPABASE_GATEWAY_SECRET` — generato, già su Railway e già nella
  migration SQL (`sql/signal_room_migration.sql`)
- `WEBHOOK_SECRET` — generato, già su Railway
- `SUPABASE_URL` — `https://vtssggkdfwuglmqsyxuo.supabase.co`
- `SUPABASE_ANON_KEY` — la publishable key pubblica del progetto
- `CRM_TENANT_SLUG` — `xau-machine`
- `WEBHOOK_AUTO_ENFORCE` — `true`

Da verificare/impostare da parte di chi ha accesso a Telegram e Railway
(non richiesti qui, solo elencati):
- `BOT_TOKEN` — **ATTENZIONE, verificato il 1 settembre con Gaetano:
  oggi questa variabile su signalroom-gateway è impostata con lo stesso
  bot che parla con i clienti, @XauMachineAisupport_bot (xau-machine-bot-v2).
  Questo è SBAGLIATO e va cambiato prima del deploy**: un bot Telegram
  non può avere sia un webhook attivo sia il polling (`getUpdates`)
  attivo insieme, quindi con la configurazione attuale attivare questo
  servizio spegnerebbe le risposte ai clienti. Anche @Postapro1_bot NON
  va usato (Gaetano ha confermato che fa già un altro lavoro). Serve un
  **terzo bot, nuovo, creato con @BotFather**, dedicato solo alla sala
  segnali, e il suo token va messo qui al posto di quello attuale.
  Per sicurezza, Claude ha già rimesso `WEBHOOK_AUTO_ENFORCE` a `false`
  su Railway: NON rimetterlo a `true` finché BOT_TOKEN non è stato
  cambiato con quello del bot nuovo, altrimenti si rischia di rompere il
  bot clienti.
- `TELEGRAM_SIGNAL_CHAT_ID` (opzionale ma consigliata) — id numerico della
  chat/canale della sala segnali. Senza questa variabile il servizio
  accetta messaggi da qualunque chat in cui il bot dedicato viene
  aggiunto (utile per scoprire l'id guardando i log/`/health` la prima
  volta, poi si restringe impostando questa variabile).

Passo Telegram che **solo un umano può fare** (non è una questione di
variabili): il bot dedicato deve essere aggiunto come **amministratore**
della sala segnali (`https://t.me/+-e1_tDFps0Q2YmE0`), altrimenti Telegram
non gli invia i messaggi. Questo passaggio va fatto da chi amministra la
sala, dentro l'app Telegram.

## Limite noto, dichiarato (non finto): cancellazioni

L'API Bot di Telegram invia un evento per i messaggi **modificati**
(`edited_channel_post`, gestito) ma **nessun evento per i messaggi
cancellati**. Per rilevare le cancellazioni servirebbe un account
Telegram "utente" (libreria Telethon o Pyrogram) con queste variabili,
che oggi NON esistono e non sono state richieste a nessuno:
`TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_SESSION_STRING`.
Idem per recuperare lo **storico** di messaggi pubblicati prima
dell'attivazione del webhook (il Bot API non dà accesso alla cronologia
di un canale). Se in futuro serve, è un servizio aggiuntivo separato, non
incluso in questa versione.

## Test eseguiti (in locale, nessun dato reale toccato)

- `python3 test_parser.py` — 10/10 casi di parsing italiano/inglese
- Test end-to-end con un Postgres locale sandbox (non il progetto Supabase
  reale) e un sostituto minimo di PostgREST (`mock_postgrest.py`, usato
  solo per i test): apertura segnale, TP1 raggiunto, messaggio modificato
  (niente duplicati), secondo segnale chiuso in stop loss, secret errato
  rifiutato con 401 — vedi `sql/signal_room_migration.sql` per le stesse
  query eseguite manualmente con esito corretto.

## Deploy

Il servizio Railway "signalroom-gateway" (progetto `xaumachinebot`) va
collegato a questa cartella (root directory `signalroom-gateway` in
questo stesso repository, come già fa `xau-machine-bot-v2` con
`bot-v2`), poi Railway builda con il `Dockerfile` qui incluso.
