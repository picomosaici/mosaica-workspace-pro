; ===================================================================
; Mosaica Workspace Pro - Script NSIS personalizzato (multilingua)
; ===================================================================
; Personalizza l'installer aggiungendo:
;  - pagina di benvenuto con versione MM.YYYY
;  - dettagli installazione visibili (lista file)
;  - barra di progresso "smooth" animata
;  - branding personalizzato Pico Mosaici
;  - messaggi tradotti (IT + EN) tramite LangString
;
; ARCHITETTURA MULTILINGUA:
;  electron-builder, con multiLanguageInstaller=true e installerLanguages
;  ["it_IT","en_US"] (vedi package.json), include automaticamente i
;  language pack NSIS Italian.nlf e English.nlf e mostra un selettore
;  di lingua all'avvio (displayLanguageSelector=true). Tutte le stringhe
;  user-facing che aggiungiamo qui sono dichiarate come LangString e
;  risolte runtime da $(NomeStringa). MUI2 risolve in automatico le
;  stringhe standard (pulsanti Next/Back/Cancel/Install/Finish, titoli
;  pagine, ecc.) per ciascuna lingua caricata.
; ===================================================================

; --- Versione di display (formato MM.YYYY, da aggiornare ad ogni release) ---
!define DISPLAY_VERSION "06.2026"

; ──────────────────────────────────────────────────────────────────
;  PRE-DEFINIZIONE LCID LINGUE
;  -----------------------------------------------------------------
;  electron-builder include questo file PRIMA di emettere
;  !insertmacro MUI_LANGUAGE "Italian"/"English", quindi al momento
;  in cui NSIS legge le LangString qui sotto ${LANG_ITALIAN} e
;  ${LANG_ENGLISH} non sono ancora definite e NSIS emette il
;  warning 7025 — che electron-builder tratta come errore e fa
;  fallire la build.
;
;  Le predefiniamo noi con i loro LCID standard (1040 = Italian,
;  1033 = English). Il guardia !ifndef evita conflitti se in futuro
;  electron-builder dovesse caricare i language pack prima dell'
;  include (in quel caso useremmo i define MUI senza ridefinirli).
;  Le LangString sotto continuano a funzionare identiche: NSIS le
;  associa all'LCID a prescindere dal nome simbolico usato.
; ──────────────────────────────────────────────────────────────────
!ifndef LANG_ITALIAN
  !define LANG_ITALIAN 1040
!endif
!ifndef LANG_ENGLISH
  !define LANG_ENGLISH 1033
!endif

; ──────────────────────────────────────────────────────────────────
;  STRINGHE LOCALIZZATE
;  -----------------------------------------------------------------
;  Ogni stringa visibile all'utente è dichiarata due volte (una per
;  lingua). Sintassi: LangString NOME ${LANG_CODICE} "testo".
;  ${LANG_ITALIAN} e ${LANG_ENGLISH} sono predefinite da MUI2 una volta
;  che electron-builder ha caricato i rispettivi .nlf.
;  $\r$\n = CRLF (a capo nei dialog NSIS).
;  $_CLICK = placeholder MUI per "Premi Avanti per continuare".
; ──────────────────────────────────────────────────────────────────

; --- Branding (testo in basso a sinistra dell'installer) ---
LangString MSP_BRANDING_TEXT ${LANG_ITALIAN} "Mosaica Workspace Pro ${DISPLAY_VERSION}  -  Pico Mosaici"
LangString MSP_BRANDING_TEXT ${LANG_ENGLISH} "Mosaica Workspace Pro ${DISPLAY_VERSION}  -  Pico Mosaici"

; --- Pagina di benvenuto ---
LangString MSP_WELCOME_TITLE ${LANG_ITALIAN} "Mosaica Workspace Pro ${DISPLAY_VERSION}"
LangString MSP_WELCOME_TITLE ${LANG_ENGLISH} "Mosaica Workspace Pro ${DISPLAY_VERSION}"

LangString MSP_WELCOME_TEXT ${LANG_ITALIAN} "Stai per installare Mosaica Workspace Pro versione ${DISPLAY_VERSION}.$\r$\n$\r$\nMosaica è uno strumento professionale per la creazione di mosaici, il disegno a mano libera e le tecniche ad acquerello in formato digitale.$\r$\n$\r$\nPrima di procedere assicurati di aver chiuso eventuali altre istanze del programma.$\r$\n$\r$\n$_CLICK"
LangString MSP_WELCOME_TEXT ${LANG_ENGLISH} "You are about to install Mosaica Workspace Pro version ${DISPLAY_VERSION}.$\r$\n$\r$\nMosaica is a professional tool for creating mosaics, freehand drawing and digital watercolor techniques.$\r$\n$\r$\nBefore continuing, please make sure you have closed any other running instances of the program.$\r$\n$\r$\n$_CLICK"

; --- DetailPrint INSTALL: header con copyright ---
LangString MSP_DET_HEADER_SEP ${LANG_ITALIAN} "============================================"
LangString MSP_DET_HEADER_SEP ${LANG_ENGLISH} "============================================"

LangString MSP_DET_TITLE ${LANG_ITALIAN} "Mosaica Workspace Pro ${DISPLAY_VERSION}"
LangString MSP_DET_TITLE ${LANG_ENGLISH} "Mosaica Workspace Pro ${DISPLAY_VERSION}"

LangString MSP_DET_COPYRIGHT ${LANG_ITALIAN} "Copyright (C) 2026 Pico Mosaici"
LangString MSP_DET_COPYRIGHT ${LANG_ENGLISH} "Copyright (C) 2026 Pico Mosaici"

; --- DetailPrint INSTALL: steps ---
LangString MSP_INST_START         ${LANG_ITALIAN} "Avvio installazione..."
LangString MSP_INST_START         ${LANG_ENGLISH} "Starting installation..."

LangString MSP_INST_APP_FILES     ${LANG_ITALIAN} "Copia dei file dell'applicazione..."
LangString MSP_INST_APP_FILES     ${LANG_ENGLISH} "Copying application files..."

LangString MSP_INST_TEXTURES      ${LANG_ITALIAN} "Copia delle texture per i mosaici..."
LangString MSP_INST_TEXTURES      ${LANG_ENGLISH} "Copying mosaic textures..."

LangString MSP_INST_GUIDE         ${LANG_ITALIAN} "Copia della guida utente..."
LangString MSP_INST_GUIDE         ${LANG_ENGLISH} "Copying user guide..."

LangString MSP_INST_CHANGELOG     ${LANG_ITALIAN} "Copia delle note di rilascio (CHANGELOG)..."
LangString MSP_INST_CHANGELOG     ${LANG_ENGLISH} "Copying release notes (CHANGELOG)..."

LangString MSP_INST_SHORTCUTS     ${LANG_ITALIAN} "Creazione collegamenti..."
LangString MSP_INST_SHORTCUTS     ${LANG_ENGLISH} "Creating shortcuts..."

LangString MSP_INST_UNINSTALLER   ${LANG_ITALIAN} "Registrazione disinstaller..."
LangString MSP_INST_UNINSTALLER   ${LANG_ENGLISH} "Registering uninstaller..."

LangString MSP_INST_DONE          ${LANG_ITALIAN} "Installazione completata con successo."
LangString MSP_INST_DONE          ${LANG_ENGLISH} "Installation completed successfully."

; --- DetailPrint UNINSTALL ---
LangString MSP_UNINST_TITLE       ${LANG_ITALIAN} "Rimozione di Mosaica Workspace Pro"
LangString MSP_UNINST_TITLE       ${LANG_ENGLISH} "Removing Mosaica Workspace Pro"

LangString MSP_UNINST_CLOSING     ${LANG_ITALIAN} "Chiusura processi in corso..."
LangString MSP_UNINST_CLOSING     ${LANG_ENGLISH} "Closing running processes..."

LangString MSP_UNINST_APP_FILES   ${LANG_ITALIAN} "Rimozione file applicazione..."
LangString MSP_UNINST_APP_FILES   ${LANG_ENGLISH} "Removing application files..."

LangString MSP_UNINST_TEXTURES    ${LANG_ITALIAN} "Rimozione texture e risorse..."
LangString MSP_UNINST_TEXTURES    ${LANG_ENGLISH} "Removing textures and resources..."

LangString MSP_UNINST_SHORTCUTS   ${LANG_ITALIAN} "Rimozione collegamenti..."
LangString MSP_UNINST_SHORTCUTS   ${LANG_ENGLISH} "Removing shortcuts..."

LangString MSP_UNINST_REGISTRY    ${LANG_ITALIAN} "Pulizia voci di registro..."
LangString MSP_UNINST_REGISTRY    ${LANG_ENGLISH} "Cleaning registry entries..."

LangString MSP_UNINST_DONE        ${LANG_ITALIAN} "Disinstallazione completata."
LangString MSP_UNINST_DONE        ${LANG_ENGLISH} "Uninstallation completed."

; ──────────────────────────────────────────────────────────────────
;  MACRO INSTALLER
; ──────────────────────────────────────────────────────────────────

; --- Header personalizzato (eseguito per primo) ---
!macro customHeader
  ; Mostra il pannello dettagli durante installazione/disinstallazione
  ; (lista file copiati in tempo reale invece di sola barra)
  ShowInstDetails show
  ShowUnInstDetails show

  ; Nota: la barra di progresso "smooth" e' gia' impostata di default
  ; da electron-builder, non serve ridefinirla qui (causa errore NSIS).

  ; Testo in basso a sinistra (sostituisce "Nullsoft Install System")
  BrandingText "$(MSP_BRANDING_TEXT)"
!macroend

; --- Pagina di benvenuto personalizzata ---
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "$(MSP_WELCOME_TITLE)"
  !define MUI_WELCOMEPAGE_TEXT "$(MSP_WELCOME_TEXT)"
  !insertmacro MUI_PAGE_WELCOME
!macroend

; --- Messaggi visibili nel pannello dettagli durante l'installazione ---
!macro customInstall
  ; Forza l'apertura del pannello "dettagli" runtime: senza questo
  ; il template MUI2 di electron-builder lo lascia collassato e
  ; l'utente vede solo il riquadro bianco con la barra di progresso.
  ; ShowInstDetails in customHeader non basta perché electron-builder
  ; lo sovrascrive col proprio template — qui agiamo a runtime.
  SetDetailsView show

  DetailPrint "$(MSP_DET_HEADER_SEP)"
  DetailPrint "$(MSP_DET_TITLE)"
  DetailPrint "$(MSP_DET_COPYRIGHT)"
  DetailPrint "$(MSP_DET_HEADER_SEP)"
  DetailPrint "$(MSP_INST_START)"
  DetailPrint "$(MSP_INST_APP_FILES)"
  DetailPrint "$(MSP_INST_TEXTURES)"
  DetailPrint "$(MSP_INST_GUIDE)"
  DetailPrint "$(MSP_INST_CHANGELOG)"
  DetailPrint "$(MSP_INST_SHORTCUTS)"
  DetailPrint "$(MSP_INST_UNINSTALLER)"
  DetailPrint "$(MSP_INST_DONE)"
!macroend

; --- Messaggi visibili durante la disinstallazione ---
!macro customUnInstall
  ; Stesso fix di customInstall: apre runtime il pannello dettagli.
  SetDetailsView show

  DetailPrint "$(MSP_DET_HEADER_SEP)"
  DetailPrint "$(MSP_UNINST_TITLE)"
  DetailPrint "$(MSP_DET_HEADER_SEP)"
  DetailPrint "$(MSP_UNINST_CLOSING)"
  DetailPrint "$(MSP_UNINST_APP_FILES)"
  DetailPrint "$(MSP_UNINST_TEXTURES)"
  DetailPrint "$(MSP_UNINST_SHORTCUTS)"
  DetailPrint "$(MSP_UNINST_REGISTRY)"
  DetailPrint "$(MSP_UNINST_DONE)"
!macroend