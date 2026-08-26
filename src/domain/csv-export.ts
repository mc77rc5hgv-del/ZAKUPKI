export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

function csvCell(raw: unknown): string {
  let value = raw === undefined || raw === null ? "" : String(raw);
  // Neutralize spreadsheet formula injection: Excel/Sheets treat a cell whose
  // first character is one of these as the start of a formula, which could
  // execute attacker-influenced text scraped from the portal. Prefixing with
  // a quote forces it to be read as plain text.
  if (/^[=+\-@\t\r]/.test(value)) value = `'${value}`;
  if (/[",\n\r]/.test(value)) value = `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Renders rows as CSV text (CRLF line endings, UTF-8 BOM so Excel opens
 * Cyrillic correctly). Column values are read via accessor functions so the
 * caller controls exactly which fields are exposed — never serialize an
 * object's own keys directly, since that could leak unintended fields. */
export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const header = columns.map(c => csvCell(c.header)).join(",");
  const body = rows.map(row => columns.map(c => csvCell(c.value(row))).join(","));
  const BOM = "﻿";
  return `${BOM}${[header, ...body].join("\r\n")}\r\n`;
}
