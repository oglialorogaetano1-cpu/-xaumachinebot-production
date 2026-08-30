# XAU Machine — stato progetto

Aggiornamento: 30 agosto 2026.

## Infrastruttura

- CRM pubblico: `https://xau-machine-crm.vercel.app/`
- Repository: `oglialorogaetano1-cpu/-xaumachinebot-production`
- Supabase: progetto XAU esistente, ID `vtssggkdfwuglmqsyxuo`
- Bot Telegram v2: `@XauMachineAisupport_bot`
- Il vecchio servizio supervisore deve restare separato e sospeso.

## Funzioni presenti nella sorgente

- Healthcheck HTTP del bot v2.
- Polling Telegram.
- Tracciamento `/start` tramite deep link e RPC Supabase protetta.
- Messaggio di benvenuto localizzato letto dal CRM, con fallback locale.
- Registrazione messaggi nel CRM.
- Richiesta intervento umano nel CRM.
- Comandi provvisori per registrazione, sala segnali, verifica IB, deposito, guida, screenshot e intervento umano.
- Worker PU Prime per i tre IB `23215978`, `23217421`, `7527073`.
- Scrittura PU Prime protetta verso Supabase senza cancellare dati quando il portale restituisce zero righe.

## Campagne Telegram tracciate

| Lingua/canale | Codice deep link |
|---|---|
| Russo | `tg_ru_russo` |
| LeoTrading inglese | `tg_en_leotrading` |
| Cinese | `tg_zh_cinese` |
| New Zealand | `tg_en_nz` |
| Francese | `tg_fr_francese` |
| Spagnolo | `tg_es_spagnolo` |
| Tedesco | `tg_de_tedesco` |
| Norvegese | `tg_no_norvegese` |
| Emirati Arabi | `tg_ar_uae` |
| Alice Trading | `tg_it_alice` |
| Arabo | `tg_ar_arabo` |
| Leo Italia | `tg_it_leoitalia` |
| Diretto | `tg_direct` |

Il messaggio `/start` deve partire nella lingua associata al codice. Il benvenuto fisso non deve consumare token AI.

## Follow-up memorizzati nel CRM

### Follow1 — Assenza 2 ore

- Condizione: nessuna risposta, lead non registrato e nessun cambio IB richiesto.
- Ritardo: 120 minuti.
- Stop immediato quando il cliente risponde.
- Testo: `Ciao 👋 Avevi altre domande? Posso aiutarti con qualcosa oppure vuoi che ti mostri qualche risultato del sistema? 😊`

### Follow2 — Cambio IB richiesto

- Condizione: cambio IB richiesto ma nessuna conferma ricevuta.
- Ritardo: 3 giorni.
- Chiede conferma email PU Prime o verifica nell'area personale dell'IB `23217421`.
- Accetta screenshot come verifica provvisoria da sottoporre all'operatore.
- Dopo verifica: accesso permanente alla sala segnali e guida bot.

Le regole sono presenti nel database, ma il worker che le valuta e invia automaticamente non è incluso/completato in questa revisione.

## Regole conversazione

- Clienti: testo libero gestito dall'AI, senza menu numerati e senza obbligo di comandi.
- Traduzione CRM: servizio di traduzione non generativa, non LLM.
- L'AI deve classificare stato e obiezione: indeciso, registrazione, cambio IB, verifica IB, deposito, richiesta umana.
- La guida completa del bot viene inviata solo dopo verifica IB; lo screenshot può aprire una verifica umana provvisoria.
- Richiesta umana quando l'AI non sa rispondere o su richiesta esplicita.

## Comandi amministratore previsti

- `/iscritti_oggi`
- `/iscritti_settimana`
- `/clienti_ib`
- `/rebate_oggi`
- `/rebate_settimana`
- `/richieste_umane`
- `/non_gestite`

Sono specificati nel CRM ma non risultano tutti implementati nella sorgente attuale.

## Da completare prima di dichiarare il sistema operativo

1. Collegare il motore AI alle conversazioni libere; `text_message` risponde ancora con testo statico.
2. Correggere e verificare il mapping tra `record_message()` e lo schema reale di `crm_messages`.
3. Implementare il worker dei follow-up con lock, idempotenza, stop su risposta e registro invii.
4. Implementare davvero i comandi amministratore con dati Supabase.
5. Collegare MT5 dalla VPS per statistiche, andamento e screenshot richiesti dal cliente.
6. Collegare sala segnali e materiali/guide caricati dal CRM.
7. Collegare Ringover, WhatsApp e Brevo lato server; i segreti non devono essere salvati nel browser o nel database in chiaro.
8. Implementare notifiche di uscita cliente dai tre IB e riepilogo rebate notturno.
9. Verificare end-to-end: Telegram -> CRM -> AI -> PU Prime/MT5 -> risposta cliente -> follow-up/intervento umano.

## Sicurezza

- Tutte le credenziali devono stare nelle variabili protette di Railway/Vercel/VPS.
- Non inserire segreti nello ZIP, nel repository o nei log.
- Ruotare le credenziali già condivise in chat prima della produzione definitiva.
- Non avviare contemporaneamente vecchio bot e bot v2 con lo stesso token Telegram.
