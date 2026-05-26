#!/usr/bin/env node
/**
 * Bump versione Mosaica Workspace Pro
 * ============================================================
 * Convenzioni di versioning (rigorose):
 *
 *   package.json  →  "M.YYYY.X"    (semver, es. 6.2026.0)
 *   UI utente / installer / nome file →  "MM.YYYY"  (zero-pad mese, es. 06.2026)
 *   git tag / GitHub release        →  "vM.YYYY[.X]"  (es. v6.2026 o v6.2026.1)
 *
 * USO:
 *   npm run bump 7.2026        → release nuova del mese
 *   npm run bump 7.2026.1      → hotfix dello stesso mese
 *
 * COSA TOCCA:
 *   • package.json       (version, artifactName, uninstallDisplayName)
 *   • build/installer.nsh (!define DISPLAY_VERSION)
 *   • Guida_utente.html  (logo-badge + footer)
 *   • Guida_utente_EN.html (logo-badge)
 *
 * COSA NON TOCCA (apposta):
 *   • build/CHANGELOG.txt → contiene narrativa per ogni release,
 *     lo script si limita a CONTROLLARE che esista una sezione per
 *     la nuova versione e ti avvisa se manca.
 *   • README.md → non ha versioni hardcoded, usa il placeholder
 *     MM.YYYY come parte del nome installer (descrittivo).
 * ============================================================ */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// ──────────────────────── Parse / validazione versione ────────────────────────
function parseVersion(input) {
  const m = /^(\d{1,2})\.(\d{4})(?:\.(\d+))?$/.exec(String(input || "").trim());
  if (!m) {
    throw new Error(
      `Versione "${input}" non valida.\n` +
      `Formato atteso: M.YYYY (es. 7.2026) oppure M.YYYY.X per hotfix (es. 7.2026.1).`
    );
  }
  const month = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  const hotfix = m[3] != null ? parseInt(m[3], 10) : 0;

  if (month < 1 || month > 12) throw new Error(`Mese non valido (1-12): ${month}`);
  if (year < 2025 || year > 2099) throw new Error(`Anno fuori range (2025-2099): ${year}`);

  const mm = String(month).padStart(2, "0");
  return {
    month, year, hotfix,
    semver:       `${month}.${year}.${hotfix}`,                                  // package.json
    mmYYYY:       `${mm}.${year}`,                                               // UI base
    mmYYYYHotfix: hotfix > 0 ? `${mm}.${year}.${hotfix}` : `${mm}.${year}`,      // changelog
    gitTag:       hotfix > 0 ? `v${month}.${year}.${hotfix}` : `v${month}.${year}` // tag git
  };
}

// ──────────────────────── I/O helpers ────────────────────────
const read   = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const write  = (rel, c) => fs.writeFileSync(path.join(ROOT, rel), c, "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const report = []; // log finale

function note(file, ok, detail) {
  report.push({ file, ok, detail: detail || "" });
}

// ──────────────────────── Patcher per ogni file ────────────────────────

function patchPackageJson(v) {
  const rel = "package.json";
  if (!exists(rel)) return note(rel, false, "file non trovato");
  const raw = read(rel);
  let out = raw;
  let hits = 0;

  // "version": "M.YYYY.X"
  out = out.replace(/("version"\s*:\s*")[^"]*(")/, (m, a, b) => {
    hits++; return `${a}${v.semver}${b}`;
  });

  // "artifactName": "...-Setup-MM.YYYY.${ext}"  (PRESERVA il placeholder ${ext})
  out = out.replace(
    /("artifactName"\s*:\s*"[^"]*-Setup-)\d{1,2}\.\d{4}(\.\$\{ext\}")/,
    (m, a, b) => { hits++; return `${a}${v.mmYYYY}${b}`; }
  );

  // "uninstallDisplayName": "Mosaica Workspace Pro MM.YYYY"
  out = out.replace(
    /("uninstallDisplayName"\s*:\s*"Mosaica Workspace Pro )\d{1,2}\.\d{4}(")/,
    (m, a, b) => { hits++; return `${a}${v.mmYYYY}${b}`; }
  );

  if (out !== raw) { write(rel, out); note(rel, true, `${hits} occorrenze sostituite`); }
  else             { note(rel, false, "nessuna sostituzione effettuata (controlla che i campi siano nei formati attesi)"); }
}

function patchInstallerNsh(v) {
  const rel = "build/installer.nsh";
  if (!exists(rel)) return note(rel, false, "file non trovato");
  const raw = read(rel);
  let hits = 0;
  const out = raw.replace(
    /(!define\s+DISPLAY_VERSION\s+")\d{1,2}\.\d{4}(")/,
    (m, a, b) => { hits++; return `${a}${v.mmYYYY}${b}`; }
  );
  if (out !== raw) { write(rel, out); note(rel, true, `DISPLAY_VERSION → ${v.mmYYYY}`); }
  else             { note(rel, false, "DISPLAY_VERSION non trovato"); }
}

function patchGuidaIT(v) {
  const rel = "Guida_utente.html";
  if (!exists(rel)) return note(rel, false, "file non trovato");
  const raw = read(rel);
  let out = raw;
  let hits = 0;

  // logo-badge: "Guida Utente · V MM.YYYY"
  out = out.replace(/(Guida Utente · V )\d{1,2}\.\d{4}/, (m, a) => {
    hits++; return `${a}${v.mmYYYY}`;
  });
  // footer: "Aggiornata alla versione · V MM.YYYY"
  out = out.replace(/(Aggiornata alla versione · V )\d{1,2}\.\d{4}/, (m, a) => {
    hits++; return `${a}${v.mmYYYY}`;
  });

  if (out !== raw) { write(rel, out); note(rel, true, `${hits} occorrenze sostituite`); }
  else             { note(rel, false, "header/footer non trovati nei formati attesi"); }
}

function patchGuidaEN(v) {
  const rel = "Guida_utente_EN.html";
  if (!exists(rel)) return note(rel, false, "file non trovato");
  const raw = read(rel);
  let hits = 0;
  // logo-badge: "User Guide · V MM.YYYY"
  const out = raw.replace(/(User Guide · V )\d{1,2}\.\d{4}/, (m, a) => {
    hits++; return `${a}${v.mmYYYY}`;
  });
  if (out !== raw) { write(rel, out); note(rel, true, `${hits} occorrenze sostituite`); }
  else             { note(rel, false, "header non trovato nel formato atteso"); }
}

function checkChangelog(v) {
  const rel = "build/CHANGELOG.txt";
  if (!exists(rel)) return note(rel, false, "file non trovato");
  const raw = read(rel);

  const escapedMmYYYYHotfix = v.mmYYYYHotfix.replace(/\./g, "\\.");
  const escapedSemver       = v.semver.replace(/\./g, "\\.");

  const headerRe   = new RegExp(`Versione\\s+${escapedMmYYYYHotfix}\\b`, "i");
  const internalRe = new RegExp(`Versione\\s+interna:\\s*${escapedSemver}`, "i");

  const hasHeader   = headerRe.test(raw);
  const hasInternal = internalRe.test(raw);

  if (hasHeader && hasInternal) {
    note(rel, true, `sezione "Versione ${v.mmYYYYHotfix}" già presente`);
  } else if (hasHeader) {
    note(rel, false, `sezione presente ma manca "Versione interna: ${v.semver}" → aggiungilo a mano`);
  } else {
    note(rel, false,
      `MANCA la sezione per "Versione ${v.mmYYYYHotfix}" (con "Versione interna: ${v.semver}") → aggiungila a mano`
    );
  }
}

// ──────────────────────── Main ────────────────────────
function main() {
  const arg = process.argv[2];
  if (!arg || arg === "-h" || arg === "--help") {
    console.log(
`Bump versione Mosaica Workspace Pro

Uso:
  npm run bump <M.YYYY[.X]>

Esempi:
  npm run bump 7.2026       → release nuova del mese di luglio 2026
  npm run bump 7.2026.1     → hotfix #1 della release di luglio 2026

La versione verrà propagata in:
  - package.json (version, artifactName, uninstallDisplayName)
  - build/installer.nsh (DISPLAY_VERSION)
  - Guida_utente.html (header + footer)
  - Guida_utente_EN.html (header)

Il file build/CHANGELOG.txt NON viene modificato (contiene narrativa
specifica della release): lo script controlla solo che esista una
sezione per la nuova versione e ti avvisa se manca.
`);
    process.exit(arg ? 0 : 1);
  }

  let v;
  try { v = parseVersion(arg); }
  catch (e) { console.error("❌ " + e.message); process.exit(2); }

  console.log(`\n🔧 Bump Mosaica Workspace Pro\n`);
  console.log(`   semver (package.json):     ${v.semver}`);
  console.log(`   display MM.YYYY (UI):      ${v.mmYYYY}${v.hotfix > 0 ? ` (+ hotfix ${v.hotfix})` : ""}`);
  console.log(`   git tag:                   ${v.gitTag}\n`);

  patchPackageJson(v);
  patchInstallerNsh(v);
  patchGuidaIT(v);
  patchGuidaEN(v);
  checkChangelog(v);

  console.log("📋 Risultato:");
  for (const r of report) {
    const icon = r.ok ? "✅" : "⚠️ ";
    console.log(`   ${icon} ${r.file}${r.detail ? "  — " + r.detail : ""}`);
  }

  const warnings = report.filter(r => !r.ok);
  console.log("");
  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} avviso/i — controlla sopra ed eventualmente correggi a mano.`);
  } else {
    console.log(`🎉 Tutti i file aggiornati senza warning.`);
  }

  console.log(`\nProssimi passi consigliati:`);
  console.log(`   1)  git diff                      (verifica le modifiche)`);
  console.log(`   2)  aggiorna build/CHANGELOG.txt  (aggiungi la sezione "Versione ${v.mmYYYYHotfix}")`);
  console.log(`   3)  npm run dist                  (build dell'installer)`);
  console.log(`   4)  git commit -am "release ${v.gitTag}"`);
  console.log(`   5)  git tag ${v.gitTag} && git push --tags\n`);
}

main();