import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const purchaseRecordsTable = pgTable(
  "purchase_records",
  {
    id: serial("id").primaryKey(),
    sourceSheetRow: integer("source_sheet_row"),
    projectNumber: text("project_number").notNull().default(""),
    poNumber: text("po_number").notNull().default(""),
    committeeNumber: text("committee_number").notNull().default(""),
    requestDate: text("request_date").notNull().default(""),
    supplierCode: text("supplier_code").notNull().default(""),
    supplierName: text("supplier_name").notNull().default(""),
    taxId: text("tax_id").notNull().default(""),
    recordStatus: text("record_status").notNull().default(""),
    productName: text("product_name").notNull(),
    companyDrugKey: text("company_drug_key").notNull().default(""),
    quantity: numeric("quantity", { precision: 14, scale: 3, mode: "number" }),
    unit: text("unit").notNull().default(""),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2, mode: "number" }),
    lineTotal: numeric("line_total", { precision: 14, scale: 2, mode: "number" }),
    gpu: text("gpu").notNull().default(""),
    tpu: text("tpu").notNull().default(""),
    representative: text("representative").notNull().default(""),
    contractNumber: text("contract_number").notNull().default(""),
    deliveryStatus: text("delivery_status").notNull().default(""),
    note: text("note").notNull().default(""),
    invoiceDate: text("invoice_date").notNull().default(""),
    acceptanceDate: text("acceptance_date").notNull().default(""),
    invoiceNumber: text("invoice_number").notNull().default(""),
    acceptanceStatus: text("acceptance_status").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("purchase_records_source_sheet_row_uq").on(table.sourceSheetRow),
    index("purchase_records_supplier_code_idx").on(table.supplierCode),
    index("purchase_records_po_number_idx").on(table.poNumber),
  ],
);

export const insertPurchaseRecordSchema = createInsertSchema(
  purchaseRecordsTable,
)
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({ productName: z.string().trim().min(1) });

export type InsertPurchaseRecord = z.infer<typeof insertPurchaseRecordSchema>;
export type PurchaseRecord = typeof purchaseRecordsTable.$inferSelect;