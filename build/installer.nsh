; ===================================================================
; Mosaica Workspace Pro - Script NSIS personalizzato
; ===================================================================
; Personalizza l'installer aggiungendo:
;  - pagina di benvenuto con versione MM.YYYY
;  - dettagli installazione visibili (lista file)
;  - barra di progresso "smooth" animata
;  - branding personalizzato Pico Mosaici
;  - messaggi italiani durante installazione/disinstallazione
; ===================================================================

; --- Versione di display (formato MM.YYYY, da aggiornare ad ogni release) ---
!define DISPLAY_VERSION "05.2026"

; --- Header personalizzato (eseguito per primo) ---
!macro customHeader
  ; Mostra il pannello dettagli durante installazione/disinstallazione
  ; (lista file copiati in tempo reale invece di sola barra)
  ShowInstDetails show
  ShowUnInstDetails show

  ; Nota: la barra di progresso "smooth" e' gia' impostata di default
  ; da electron-builder, non serve ridefinirla qui (causa errore NSIS).

  ; Testo in basso a sinistra (sostituisce "Nullsoft Install System")
  BrandingText "Mosaica Workspace Pro ${DISPLAY_VERSION}  -  Pico Mosaici"
!macroend

; --- Pagina di benvenuto personalizzata ---
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Mosaica Workspace Pro ${DISPLAY_VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "Stai per installare Mosaica Workspace Pro versione ${DISPLAY_VERSION}.$\r$\n$\r$\nMosaica è uno strumento professionale per la creazione di mosaici, il disegno a mano libera e le tecniche ad acquerello in formato digitale.$\r$\n$\r$\nPrima di procedere assicurati di aver chiuso eventuali altre istanze del programma.$\r$\n$\r$\n$_CLICK"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; --- Messaggi visibili nel pannello dettagli durante l'installazione ---
!macro customInstall
  DetailPrint "============================================"
  DetailPrint "Mosaica Workspace Pro ${DISPLAY_VERSION}"
  DetailPrint "Copyright (C) 2026 Pico Mosaici"
  DetailPrint "============================================"
  DetailPrint "Avvio installazione..."
  DetailPrint "Copia dei file dell'applicazione..."
  DetailPrint "Copia delle texture per i mosaici..."
  DetailPrint "Copia della guida utente..."
  DetailPrint "Copia delle note di rilascio (CHANGELOG)..."
  DetailPrint "Creazione collegamenti..."
  DetailPrint "Registrazione disinstaller..."
  DetailPrint "Installazione completata con successo."
!macroend

; --- Messaggi visibili durante la disinstallazione ---
!macro customUnInstall
  DetailPrint "============================================"
  DetailPrint "Rimozione di Mosaica Workspace Pro"
  DetailPrint "============================================"
  DetailPrint "Chiusura processi in corso..."
  DetailPrint "Rimozione file applicazione..."
  DetailPrint "Rimozione texture e risorse..."
  DetailPrint "Rimozione collegamenti..."
  DetailPrint "Pulizia voci di registro..."
  DetailPrint "Disinstallazione completata."
!macroend