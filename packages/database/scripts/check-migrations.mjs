import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDirectory = resolve(import.meta.dirname, "../migrations");
const metadataDirectory = resolve(migrationsDirectory, "meta");
const journalPath = resolve(metadataDirectory, "_journal.json");

async function requireFile(filePath, description) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${description} ausente: ${filePath}`);
  }
}

await requireFile(journalPath, "Journal de migrations");

const journal = JSON.parse(await readFile(journalPath, "utf8"));
if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
  throw new Error("O journal precisa registrar ao menos uma migration.");
}

const destructivePattern = /\b(?:drop\s+(?:column|schema|table)|truncate\s+table)\b/iu;
const transitionMarkerPattern = /^-- destructive-transition:\s*\S.+$/imu;

for (const entry of journal.entries) {
  if (!Number.isInteger(entry.idx) || typeof entry.tag !== "string") {
    throw new Error("Entrada inválida no journal de migrations.");
  }

  const sqlPath = resolve(migrationsDirectory, `${entry.tag}.sql`);
  const snapshotPath = resolve(
    metadataDirectory,
    `${String(entry.idx).padStart(4, "0")}_snapshot.json`,
  );

  await requireFile(sqlPath, `SQL da migration ${entry.tag}`);
  await requireFile(snapshotPath, `Snapshot da migration ${entry.tag}`);

  const sql = await readFile(sqlPath, "utf8");
  if (destructivePattern.test(sql) && !transitionMarkerPattern.test(sql)) {
    throw new Error(
      `Migration destrutiva sem estratégia explícita: ${entry.tag}. Use o marcador documentado.`,
    );
  }
}

console.log(`Migrations válidas (${journal.entries.length} registrada(s)).`);
