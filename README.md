# Promemoria oratori

Invia via WhatsApp, il lunedì prima del discorso, il promemoria agli oratori dei discorsi pubblici.

- **Sito**: https://lucioros.github.io/promemoria.oratori/

## Come si usa

1. **Importa file**: carica il CSV del programma dei discorsi e lo ZIP degli oratori (un CSV per congregazione), così come li esporti dall'app.
2. **Messaggio**: imposta il testo predefinito e i dati della congregazione (indirizzo, link Google Maps, orario, firma).
3. **Da inviare**: ogni lunedì trovi gli oratori da avvisare. Puoi modificare il messaggio per il singolo oratore e aprirlo in WhatsApp con il testo già scritto.

Il messaggio chiede sempre se l'oratore rimane per tutta l'adunanza, se è disponibile per l'ospitalità e se ha immagini da proiettare. Chiede il numero del cantico solo se nel programma non è indicato.

### Segnaposto del messaggio

`{nome}` `{nome_completo}` `{data}` `{data_completa}` `{data_breve}` `{discorso}` `{numero}` `{tema}` `{cantico}` `{richiesta_cantico}` `{congregazione}` `{congregazione_ospitante}` `{sala}` `{mappa}` `{orario}` `{firma}`

## Come sono protetti i dati

Programma, oratori (con numeri di telefono ed email), messaggi e invii sono salvati in `dati.json`, **cifrati** con AES-GCM. La chiave si ricava dalla password con PBKDF2.
Senza la password il file è illeggibile, anche se il repository è pubblico.
Anche il token di GitHub che serve per salvare è cifrato nello stesso file.

## File

| File | Cosa contiene |
|---|---|
| `index.html` | L'applicazione |
| `dati.json` | Dati cifrati (si crea al primo avvio; non modificarlo a mano) |

## SMS automatici dall'iPhone

Ogni lunedì alle 8:30 un'automazione dell'app **Comandi** ti manda una notifica con gli oratori da avvisare; alle 9 un'altra automazione dell'app **Comandi** chiede alla funzione Supabase `promemoria-sms` (codice in `supabase/promemoria-sms/index.ts`) i messaggi del giorno, li invia come SMS dal tuo numero e li segna come inviati nell'app.

- La funzione decifra `dati.json` con la password salvata nel secret `APP_PASSWORD` del progetto Supabase.
- Gli indirizzi da usare in Comandi (notifica delle 8:30 e SMS delle 9:00), con la chiave personale, si trovano nell'app: **Messaggio → Automazioni dall'iPhone**, con le istruzioni passo passo.
- Se cambi la password dell'app, aggiorna anche il secret `APP_PASSWORD`.
