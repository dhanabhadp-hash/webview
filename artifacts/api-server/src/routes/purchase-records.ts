import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreatePurchaseRecordBody,
  CreatePurchaseRecordResponse,
  DeletePurchaseRecordParams,
  GetPurchaseRecordParams,
  GetPurchaseRecordResponse,
  GetPurchaseRecordFiltersResponse,
  GetPurchaseSummaryResponse,
  ListPurchaseRecordsQueryParams,
  ListPurchaseRecordsResponse,
  UpdatePurchaseRecordBody,
  UpdatePurchaseRecordParams,
  UpdatePurchaseRecordResponse,
} from "@workspace/api-zod";
import { db, purchaseRecordsTable } from "@workspace/db";

const router: IRouter = Router();

function toApiRecord(
  record: typeof purchaseRecordsTable.$inferSelect,
): typeof GetPurchaseRecordResponse._output {
  return record;
}

function parseRecordId(params: unknown) {
  return GetPurchaseRecordParams.safeParse(params);
}

router.get("/purchase-records", async (req, res): Promise<void> => {
  const parsed = ListPurchaseRecordsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    q,
    supplierCode,
    recordStatus,
    deliveryState,
    productName,
    poNumber,
    requestDate,
    quantity,
    lineTotal,
    sortBy,
    sortOrder,
  } = parsed.data;
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 25;
  const conditions = [];

  if (q?.trim()) {
    const escaped = q.trim().replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    const search = or(
      ilike(purchaseRecordsTable.productName, pattern),
      ilike(purchaseRecordsTable.supplierName, pattern),
      ilike(purchaseRecordsTable.supplierCode, pattern),
      ilike(purchaseRecordsTable.projectNumber, pattern),
      ilike(purchaseRecordsTable.poNumber, pattern),
      ilike(purchaseRecordsTable.committeeNumber, pattern),
      ilike(purchaseRecordsTable.contractNumber, pattern),
      ilike(purchaseRecordsTable.invoiceNumber, pattern),
      ilike(purchaseRecordsTable.taxId, pattern),
      ilike(purchaseRecordsTable.gpu, pattern),
      ilike(purchaseRecordsTable.tpu, pattern),
      ilike(purchaseRecordsTable.representative, pattern),
      ilike(purchaseRecordsTable.note, pattern),
    );
    if (search) conditions.push(search);
  }

  const addTextFilter = (
    value: string | undefined,
    column:
      | typeof purchaseRecordsTable.productName
      | typeof purchaseRecordsTable.poNumber
      | typeof purchaseRecordsTable.requestDate,
  ) => {
    if (!value?.trim()) return;
    const escaped = value.trim().replace(/[\\%_]/g, "\\$&");
    conditions.push(ilike(column, `%${escaped}%`));
  };
  const addNumericFilter = (
    value: string | undefined,
    column:
      | typeof purchaseRecordsTable.quantity
      | typeof purchaseRecordsTable.lineTotal,
  ) => {
    if (!value?.trim()) return;
    const escaped = value.trim().replace(/[\\%_]/g, "\\$&");
    conditions.push(sql`${column}::text ILIKE ${`%${escaped}%`}`);
  };

  addTextFilter(productName, purchaseRecordsTable.productName);
  addTextFilter(poNumber, purchaseRecordsTable.poNumber);
  addTextFilter(requestDate, purchaseRecordsTable.requestDate);
  addNumericFilter(quantity, purchaseRecordsTable.quantity);
  addNumericFilter(lineTotal, purchaseRecordsTable.lineTotal);

  if (supplierCode) {
    conditions.push(eq(purchaseRecordsTable.supplierCode, supplierCode));
  }
  if (recordStatus === "verified") {
    conditions.push(
      or(
        ilike(purchaseRecordsTable.recordStatus, "✔%"),
        eq(purchaseRecordsTable.recordStatus, "verified"),
      )!,
    );
  } else if (recordStatus === "flagged") {
    conditions.push(
      or(
        ilike(purchaseRecordsTable.recordStatus, "❌%"),
        eq(purchaseRecordsTable.recordStatus, "flagged"),
      )!,
    );
  } else if (recordStatus === "unmarked") {
    conditions.push(
      or(
        sql`btrim(${purchaseRecordsTable.recordStatus}) = ''`,
        eq(purchaseRecordsTable.recordStatus, "unmarked"),
      )!,
    );
  }
  if (deliveryState === "delivered") {
    conditions.push(sql`upper(btrim(${purchaseRecordsTable.deliveryStatus})) = 'TRUE'`);
  } else if (deliveryState === "pending") {
    conditions.push(sql`upper(btrim(${purchaseRecordsTable.deliveryStatus})) <> 'TRUE'`);
  }

  const where = and(...conditions);
  const sortColumns = {
    productName: purchaseRecordsTable.productName,
    poNumber: purchaseRecordsTable.poNumber,
    supplierName: purchaseRecordsTable.supplierName,
    requestDate: sql`CASE
      WHEN ${purchaseRecordsTable.requestDate} ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$' THEN
        lpad((
          split_part(${purchaseRecordsTable.requestDate}, '/', 3)::int -
          CASE WHEN split_part(${purchaseRecordsTable.requestDate}, '/', 3)::int >= 2400 THEN 543 ELSE 0 END
        )::text, 4, '0') || '-' ||
        lpad(split_part(${purchaseRecordsTable.requestDate}, '/', 2), 2, '0') || '-' ||
        lpad(split_part(${purchaseRecordsTable.requestDate}, '/', 1), 2, '0')
      WHEN ${purchaseRecordsTable.requestDate} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN ${purchaseRecordsTable.requestDate}
      ELSE NULL
    END`,
    quantity: purchaseRecordsTable.quantity,
    lineTotal: purchaseRecordsTable.lineTotal,
    recordStatus: purchaseRecordsTable.recordStatus,
    deliveryStatus: purchaseRecordsTable.deliveryStatus,
  };
  const sortColumn = sortBy ? sortColumns[sortBy] : undefined;
  const primaryOrder =
    sortColumn && sortOrder === "asc" ? asc(sortColumn) : sortColumn ? desc(sortColumn) : desc(purchaseRecordsTable.id);

  const [countResult, records] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(purchaseRecordsTable)
      .where(where),
    db
      .select()
      .from(purchaseRecordsTable)
      .where(where)
      .orderBy(primaryOrder, desc(purchaseRecordsTable.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ]);

  res.json(
    ListPurchaseRecordsResponse.parse({
      items: records.map(toApiRecord),
      total: countResult[0]?.total ?? 0,
      page,
      pageSize,
    }),
  );
});

router.get("/purchase-records/:id", async (req, res): Promise<void> => {
  const params = parseRecordId(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .select()
    .from(purchaseRecordsTable)
    .where(eq(purchaseRecordsTable.id, params.data.id))
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Purchase record not found" });
    return;
  }

  res.json(GetPurchaseRecordResponse.parse(toApiRecord(record)));
});

router.post("/purchase-records", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .insert(purchaseRecordsTable)
    .values(parsed.data)
    .returning();
  res
    .status(201)
    .json(CreatePurchaseRecordResponse.parse(toApiRecord(record)));
});

router.patch("/purchase-records/:id", async (req, res): Promise<void> => {
  const params = UpdatePurchaseRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePurchaseRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [record] = await db
    .update(purchaseRecordsTable)
    .set(parsed.data)
    .where(eq(purchaseRecordsTable.id, params.data.id))
    .returning();
  if (!record) {
    res.status(404).json({ error: "Purchase record not found" });
    return;
  }

  res.json(UpdatePurchaseRecordResponse.parse(toApiRecord(record)));
});

router.delete("/purchase-records/:id", async (req, res): Promise<void> => {
  const params = DeletePurchaseRecordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .delete(purchaseRecordsTable)
    .where(eq(purchaseRecordsTable.id, params.data.id))
    .returning({ id: purchaseRecordsTable.id });
  if (!record) {
    res.status(404).json({ error: "Purchase record not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/purchase-summary", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      supplierName: purchaseRecordsTable.supplierName,
      lineTotal: purchaseRecordsTable.lineTotal,
      deliveryStatus: purchaseRecordsTable.deliveryStatus,
      acceptanceStatus: purchaseRecordsTable.acceptanceStatus,
    })
    .from(purchaseRecordsTable);

  const deliveredRecords = rows.filter(
    (row) => row.deliveryStatus.trim().toUpperCase() === "TRUE",
  ).length;
  const completedAcceptanceRecords = rows.filter((row) =>
    row.acceptanceStatus.includes("ดำเนินการเสร็จสิ้น"),
  ).length;
  const totalValue = rows.reduce(
    (sumInCents, row) =>
      sumInCents + Math.round((row.lineTotal ?? 0) * 100),
    0,
  ) / 100;
  const supplierCount = new Set(
    rows
      .map((row) => row.supplierName.trim())
      .filter((name) => name.length > 0),
  ).size;

  res.json(
    GetPurchaseSummaryResponse.parse({
      totalRecords: rows.length,
      totalValue,
      deliveredRecords,
      pendingDeliveryRecords: rows.length - deliveredRecords,
      completedAcceptanceRecords,
      pendingAcceptanceRecords: rows.length - completedAcceptanceRecords,
      supplierCount,
    }),
  );
});

router.get("/purchase-record-filters", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      supplierCode: purchaseRecordsTable.supplierCode,
      supplierName: purchaseRecordsTable.supplierName,
    })
    .from(purchaseRecordsTable)
    .groupBy(purchaseRecordsTable.supplierCode, purchaseRecordsTable.supplierName)
    .orderBy(asc(purchaseRecordsTable.supplierName));

  res.json(
    GetPurchaseRecordFiltersResponse.parse({
      suppliers: rows.filter((row) => row.supplierName.trim().length > 0),
    }),
  );
});

export default router;