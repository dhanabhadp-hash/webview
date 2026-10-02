import { eq } from "drizzle-orm";
import {
  datasetImportsTable,
  db,
  purchaseRecordsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { eGpSeedRecords } from "./egp-seed-data";

const EGP_IMPORT_KEY = "e-gp-control-log:data:v1";

export async function ensureEgpDataImported(): Promise<void> {
  const imported = await db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ sourceKey: datasetImportsTable.sourceKey })
      .from(datasetImportsTable)
      .where(eq(datasetImportsTable.sourceKey, EGP_IMPORT_KEY))
      .limit(1);

    if (existing) return false;

    await transaction
      .insert(purchaseRecordsTable)
      .values(eGpSeedRecords)
      .onConflictDoNothing({
        target: purchaseRecordsTable.sourceSheetRow,
      });
    await transaction
      .insert(datasetImportsTable)
      .values({
        sourceKey: EGP_IMPORT_KEY,
        rowCount: eGpSeedRecords.length,
      })
      .onConflictDoNothing();
    return true;
  });

  if (imported) {
    logger.info(
      { rowCount: eGpSeedRecords.length },
      "Imported the e-GP spreadsheet snapshot",
    );
  }
}