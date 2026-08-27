import yauzl, { type Entry, type ZipFile } from "yauzl";

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_XML_BYTES = 16 * 1024 * 1024;
const selectedEntry = /^word\/(?:document|footnotes|endnotes|header\d+|footer\d+)\.xml$/i;

const decodeXml = (value: string) => value
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([\da-f]+);/gi, (_m, n) => String.fromCodePoint(Number.parseInt(n, 16)));

export function docxXmlToText(xml: string): string {
  return decodeXml(xml
    .replace(/<w:tab\b[^>]*\/>/gi, "\t")
    .replace(/<w:br\b[^>]*\/>/gi, "\n")
    .replace(/<\/w:tc>/gi, "\t")
    .replace(/<\/w:p>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const openZip = (buffer: Buffer) => new Promise<ZipFile>((resolve, reject) => {
  yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("DOCX_INVALID")) : resolve(zip));
});

const readEntry = (zip: ZipFile, entry: Entry) => new Promise<Buffer>((resolve, reject) => {
  zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error("DOCX_READ_FAILED"));
    const chunks: Buffer[] = []; let size = 0;
    stream.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_XML_BYTES) stream.destroy(new Error("DOCX_TOO_LARGE")); else chunks.push(chunk); });
    stream.once("error", reject); stream.once("end", () => resolve(Buffer.concat(chunks)));
  });
});

export async function extractDocxText(buffer: Buffer): Promise<string> {
  if (!buffer.length || buffer.length > MAX_ARCHIVE_BYTES) throw new Error("DOCX_TOO_LARGE");
  const zip = await openZip(buffer);
  const parts: string[] = []; let selectedBytes = 0; let foundDocument = false;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.once("error", reject); zip.once("end", resolve);
      zip.on("entry", async entry => {
        try {
          if (/\\|(^|\/)\.\.(\/|$)/.test(entry.fileName)) throw new Error("DOCX_UNSAFE_PATH");
          if (!selectedEntry.test(entry.fileName)) return zip.readEntry();
          selectedBytes += entry.uncompressedSize;
          if (entry.uncompressedSize > MAX_XML_BYTES || selectedBytes > MAX_XML_BYTES) throw new Error("DOCX_TOO_LARGE");
          if (/word\/document\.xml$/i.test(entry.fileName)) foundDocument = true;
          parts.push(docxXmlToText((await readEntry(zip, entry)).toString("utf8")));
          zip.readEntry();
        } catch (error) { zip.close(); reject(error); }
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
  if (!foundDocument) throw new Error("DOCX_INVALID");
  const text = parts.filter(Boolean).join("\n\n").slice(0, 120_000).trim();
  if (!text) throw new Error("DOCX_EMPTY");
  return text;
}
