import type { purchaseRecordsTable } from "@workspace/db";

type PurchaseRecordInsert = typeof purchaseRecordsTable.$inferInsert;

export class PublishedCsvFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishedCsvFormatError";
  }
}

export function resolvePublishedCsvUrl(rawUrl = process.env.EGP_PUBLISHED_CSV_URL) {
  if (!rawUrl?.trim()) return null;

  try {
    const url = new URL(rawUrl.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname !== "docs.google.com" ||
      url.username ||
      url.password ||
      !/^\/spreadsheets\/d\/e\/[^/]+\/pub(html)?$/.test(url.pathname) ||
      !url.searchParams.has("gid")
    ) {
      return null;
    }

    url.pathname = url.pathname.replace(/\/pubhtml$/, "/pub");
    url.searchParams.set("output", "csv");
    return url;
  } catch {
    return null;
  }
}

export async function fetchPublishedCsv(url: URL) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      headers: { Accept: "text/csv" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Published CSV returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      !contentType.includes("text/csv") &&
      !contentType.includes("application/csv") &&
      !contentType.includes("text/plain")
    ) {
      throw new Error("Published link did not return CSV data");
    }

    const csv = await response.text();
    if (/^\s*<!doctype html|^\s*<html/i.test(csv)) {
      throw new Error("Published link returned an HTML page instead of CSV");
    }
    return csv;
  } finally {
    clearTimeout(timeout);
  }
}

function parseCsvRows(text: string) {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let endedWithLineBreak = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else if (character === "\r" && input[index + 1] === "\n") {
        field += "\n";
        index += 1;
      } else {
        field += character;
      }
      endedWithLineBreak = false;
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
      endedWithLineBreak = false;
    } else if (character === ",") {
      row.push(field);
      field = "";
      endedWithLineBreak = false;
    } else if (character === "\r" || character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      endedWithLineBreak = true;
    } else {
      field += character;
      endedWithLineBreak = false;
    }
  }

  if (quoted) {
    throw new PublishedCsvFormatError("CSV contains an unterminated quoted field");
  }
  if (!endedWithLineBreak || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseNumber(value: string) {
  const normalized = value.trim().replace(/[,\s฿]/g, "");
  if (!normalized || /^[-–—]$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function parsePublishedPurchaseCsv(csv: string): PurchaseRecordInsert[] {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) {
    throw new PublishedCsvFormatError("CSV has no purchase rows");
  }

  const headers = rows[0].map((header) => header.trim().toLocaleLowerCase());
  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const requiredHeaders = [
    "เลขที่โครงการ",
    "po",
    "วันที่ขอ",
    "รหัสบริษัท",
    "บริษัท",
    "status",
    "ชื่อเวชภัณฑ์",
    "จัดซื้อ",
    "unit",
    "ราคาซื้อ",
    "ราคารวม/หน่วย",
    "สถานะรับยา",
    "บิลลงวันที่",
    "วันที่ตรวจรับ",
    "เลขที่บิล",
    "สถานะตรวจรับ",
  ];
  const missingHeaders = requiredHeaders.filter(
    (header) => !headerIndexes.has(header),
  );
  if (missingHeaders.length) {
    throw new PublishedCsvFormatError(
      `CSV is missing expected columns: ${missingHeaders.join(", ")}`,
    );
  }

  const getValue = (cells: string[], header: string) => {
    const index = headerIndexes.get(header.toLocaleLowerCase());
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };
  const records: PurchaseRecordInsert[] = [];

  rows.slice(1).forEach((cells, index) => {
    if (!cells.some((cell) => cell.trim())) return;
    const productName = getValue(cells, "ชื่อเวชภัณฑ์");
    if (!productName) return;

    records.push({
      sourceSheetRow: index + 2,
      projectNumber: getValue(cells, "เลขที่โครงการ"),
      poNumber: getValue(cells, "PO"),
      committeeNumber: getValue(cells, "คกก."),
      requestDate: getValue(cells, "วันที่ขอ"),
      supplierCode: getValue(cells, "รหัสบริษัท"),
      supplierName: getValue(cells, "บริษัท"),
      taxId: getValue(cells, "TAX ID"),
      recordStatus: getValue(cells, "status"),
      productName,
      companyDrugKey: getValue(cells, "CompaDrugs"),
      quantity: parseNumber(getValue(cells, "จัดซื้อ")),
      unit: getValue(cells, "Unit"),
      unitPrice: parseNumber(getValue(cells, "ราคาซื้อ")),
      lineTotal: parseNumber(getValue(cells, "ราคารวม/หน่วย")),
      gpu: getValue(cells, "GPU"),
      tpu: getValue(cells, "TPU"),
      representative: getValue(cells, "ผู้แทน"),
      contractNumber: getValue(cells, "เลขคุมสัญญา"),
      deliveryStatus: getValue(cells, "สถานะรับยา") || "FALSE",
      note: getValue(cells, "Note"),
      invoiceDate: getValue(cells, "บิลลงวันที่"),
      acceptanceDate: getValue(cells, "วันที่ตรวจรับ"),
      invoiceNumber: getValue(cells, "เลขที่บิล"),
      acceptanceStatus: getValue(cells, "สถานะตรวจรับ") || "pending",
    });
  });

  if (!records.length) {
    throw new PublishedCsvFormatError(
      "CSV contains no rows with a medicine name",
    );
  }
  return records;
}