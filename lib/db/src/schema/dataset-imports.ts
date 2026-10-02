import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const datasetImportsTable = pgTable("dataset_imports", {
  sourceKey: text("source_key").primaryKey(),
  rowCount: integer("row_count").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertDatasetImportSchema = createInsertSchema(
  datasetImportsTable,
).omit({ importedAt: true });

export type InsertDatasetImport = typeof datasetImportsTable.$inferInsert;
export type DatasetImport = typeof datasetImportsTable.$inferSelect;