import { eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetPurchaseSyncStatusResponse,
  SyncPurchaseRecordsResponse,
} from "@workspace/api-zod";
import {
  db,
  datasetImportsTable,
  purchaseRecordsTable,
} from "@workspace/db";
import {
  fetchPublishedCsv,
  parsePublishedPurchaseCsv,
  PublishedCsvFormatError,
  resolvePublishedCsvUrl,
} from "../lib/published-csv";

const router: IRouter = Router();
const SOURCE_KEY = "e-gp-published-csv";

router.get("/purchase-sync-status", async (_req, res): Promise<void> => {
  const [importStatus] = await db
    .select()
    .from(datasetImportsTable)
    .where(eq(datasetImportsTable.sourceKey, SOURCE_KEY))
    .limit(1);

  res.json(
    GetPurchaseSyncStatusResponse.parse({
      configured: resolvePublishedCsvUrl() !== null,
      rowCount: importStatus?.rowCount ?? null,
      lastSyncedAt: importStatus?.importedAt ?? null,
    }),
  );
});

router.post("/purchase-sync", async (req, res): Promise<void> => {
  const csvUrl = resolvePublishedCsvUrl();
  if (!csvUrl) {
    res.status(503).json({ error: "Published Google Sheets CSV is not configured" });
    return;
  }

  let records: ReturnType<typeof parsePublishedPurchaseCsv>;
  try {
    const csv = await fetchPublishedCsv(csvUrl);
    records = parsePublishedPurchaseCsv(csv);
  } catch (error) {
    if (error instanceof PublishedCsvFormatError) {
      req.log.warn({ reason: error.message }, "Published CSV format rejected");
      res.status(422).json({ error: error.message });
      return;
    }
    req.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Could not fetch the published Google Sheets CSV",
    );
    res.status(503).json({ error: "Could not fetch the published Google Sheets CSV" });
    return;
  }

  const importedAt = new Date();
  const { insertedCount, updatedCount } = await db.transaction(async (tx) => {
    const sourceRows = records
      .map((record) => record.sourceSheetRow)
      .filter((row): row is number => typeof row === "number");
    const existingRows = sourceRows.length
      ? await tx
          .select({ sourceSheetRow: purchaseRecordsTable.sourceSheetRow })
          .from(purchaseRecordsTable)
          .where(inArray(purchaseRecordsTable.sourceSheetRow, sourceRows))
      : [];
    const existingRowNumbers = new Set(
      existingRows
        .map((record) => record.sourceSheetRow)
        .filter((row): row is number => row !== null),
    );

    await tx
      .insert(purchaseRecordsTable)
      .values(records)
      .onConflictDoUpdate({
        target: purchaseRecordsTable.sourceSheetRow,
        set: {
          projectNumber: sql`excluded.project_number`,
          poNumber: sql`excluded.po_number`,
          committeeNumber: sql`excluded.committee_number`,
          requestDate: sql`excluded.request_date`,
          supplierCode: sql`excluded.supplier_code`,
          supplierName: sql`excluded.supplier_name`,
          taxId: sql`excluded.tax_id`,
          recordStatus: sql`excluded.record_status`,
          productName: sql`excluded.product_name`,
          companyDrugKey: sql`excluded.company_drug_key`,
          quantity: sql`excluded.quantity`,
          unit: sql`excluded.unit`,
          unitPrice: sql`excluded.unit_price`,
          lineTotal: sql`excluded.line_total`,
          gpu: sql`excluded.gpu`,
          tpu: sql`excluded.tpu`,
          representative: sql`excluded.representative`,
          contractNumber: sql`excluded.contract_number`,
          updatedAt: importedAt,
        },
      });

    await tx
      .insert(datasetImportsTable)
      .values({
        sourceKey: SOURCE_KEY,
        rowCount: records.length,
        importedAt,
      })
      .onConflictDoUpdate({
        target: datasetImportsTable.sourceKey,
        set: { rowCount: records.length, importedAt },
      });

    return {
      insertedCount: records.length - existingRowNumbers.size,
      updatedCount: existingRowNumbers.size,
    };
  });

  req.log.info(
    { rowCount: records.length, insertedCount, updatedCount },
    "Published Google Sheets CSV synchronized",
  );
  res.json(
    SyncPurchaseRecordsResponse.parse({
      rowCount: records.length,
      insertedCount,
      updatedCount,
      lastSyncedAt: importedAt,
    }),
  );
});

export default router;