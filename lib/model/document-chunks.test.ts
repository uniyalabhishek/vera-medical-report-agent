import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { DocumentCategory } from "@/lib/contracts";
import type { ProviderDocument } from "@/lib/model/provider";
import { ProviderProcessingError } from "@/lib/model/provider";

vi.mock("server-only", () => ({}));

import {
  chunkProviderDocuments,
  materializeProviderDocumentChunk,
  MAX_DOCUMENT_CHUNK_PAGES,
  MAX_DOCUMENT_PAGES,
  planProviderDocumentChunks,
} from "@/lib/model/document-chunks";

async function makePdf(pageCount: number) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([200 + index, 300]);
  }
  return pdf.save();
}

function makeZeroPagePdf() {
  const header = "%PDF-1.4\n";
  const catalog = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  const pages = "2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n";
  const catalogOffset = header.length;
  const pagesOffset = catalogOffset + catalog.length;
  const xrefOffset = pagesOffset + pages.length;
  const offset = (value: number) => value.toString().padStart(10, "0");
  const xref = [
    "xref",
    "0 3",
    "0000000000 65535 f ",
    `${offset(catalogOffset)} 00000 n `,
    `${offset(pagesOffset)} 00000 n `,
    "trailer",
    "<< /Size 3 /Root 1 0 R >>",
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");
  return new TextEncoder().encode(`${header}${catalog}${pages}${xref}`);
}

function document(input: {
  id: string;
  name: string;
  mimeType: string;
  data: Uint8Array;
  category?: DocumentCategory;
}): ProviderDocument {
  return {
    ...input,
    sizeBytes: input.data.byteLength,
    category: input.category ?? "report",
  };
}

describe("chunkProviderDocuments", () => {
  it("creates a serializable byte-free plan for all documents", async () => {
    const documents = [
      document({
        id: "planned-pdf",
        name: "planned.pdf",
        mimeType: "application/pdf",
        data: await makePdf(12),
      }),
      document({
        id: "planned-image",
        name: "planned.png",
        mimeType: "image/png",
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    ];

    const plans = await planProviderDocumentChunks(documents);

    expect(plans).toEqual([
      { documentId: "planned-pdf", documentOrder: 0, chunkIndex: 0, originalFirstPage: 1, pageCount: 10 },
      { documentId: "planned-pdf", documentOrder: 0, chunkIndex: 1, originalFirstPage: 11, pageCount: 2 },
      { documentId: "planned-image", documentOrder: 1, chunkIndex: 0, originalFirstPage: 1, pageCount: 1 },
    ]);
    expect(JSON.parse(JSON.stringify(plans))).toEqual(plans);
    expect(plans.every((plan) => !("data" in plan) && !("sizeBytes" in plan))).toBe(true);
  });

  it("materializes one planned PDF chunk on demand", async () => {
    const source = document({
      id: "on-demand",
      name: "on-demand.pdf",
      mimeType: "application/pdf",
      data: await makePdf(23),
      category: "current-prescription",
    });
    const plans = await planProviderDocumentChunks([source]);

    const chunk = await materializeProviderDocumentChunk(source, plans[1]);
    const loaded = await PDFDocument.load(chunk.data);

    expect(chunk).toMatchObject({
      id: "on-demand",
      name: "on-demand.pdf",
      category: "current-prescription",
      documentOrder: 0,
      chunkIndex: 1,
      originalFirstPage: 11,
      pageCount: 10,
    });
    expect(loaded.getPageCount()).toBe(10);
    expect(loaded.getPage(0).getWidth()).toBe(210);

    await expect(materializeProviderDocumentChunk(source, {
      ...plans[1],
      originalFirstPage: 12,
    })).rejects.toMatchObject({
      name: "ProviderProcessingError",
      message: "The saved document page plan does not match its source.",
    });
  });

  it("splits a 33-page PDF into ordered chunks with original page offsets", async () => {
    const chunks = await chunkProviderDocuments([
      document({
        id: "report-1",
        name: "report.pdf",
        mimeType: "application/pdf",
        data: await makePdf(33),
        category: "past-prescription",
      }),
    ]);

    expect(MAX_DOCUMENT_CHUNK_PAGES).toBe(10);
    expect(chunks.map((chunk) => ({
      id: chunk.id,
      name: chunk.name,
      category: chunk.category,
      firstPage: chunk.originalFirstPage,
      pageCount: chunk.pageCount,
      chunkIndex: chunk.chunkIndex,
    }))).toEqual([
      { id: "report-1", name: "report.pdf", category: "past-prescription", firstPage: 1, pageCount: 10, chunkIndex: 0 },
      { id: "report-1", name: "report.pdf", category: "past-prescription", firstPage: 11, pageCount: 10, chunkIndex: 1 },
      { id: "report-1", name: "report.pdf", category: "past-prescription", firstPage: 21, pageCount: 10, chunkIndex: 2 },
      { id: "report-1", name: "report.pdf", category: "past-prescription", firstPage: 31, pageCount: 3, chunkIndex: 3 },
    ]);

    const loadedChunks = await Promise.all(chunks.map((chunk) => PDFDocument.load(chunk.data)));
    expect(loadedChunks.map((pdf) => pdf.getPageCount())).toEqual([10, 10, 10, 3]);
    expect(loadedChunks.map((pdf) => pdf.getPage(0).getWidth())).toEqual([200, 210, 220, 230]);
  });

  it("keeps images as one-page chunks and preserves input document order", async () => {
    const png = document({
      id: "image-before",
      name: "before.png",
      mimeType: "image/png",
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      category: "current-prescription",
    });
    const pdf = document({
      id: "pdf-middle",
      name: "middle.pdf",
      mimeType: "application/pdf",
      data: await makePdf(11),
      category: "report",
    });
    const jpeg = document({
      id: "image-after",
      name: "after.jpg",
      mimeType: "image/jpeg",
      data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      category: "past-prescription",
    });

    const chunks = await chunkProviderDocuments([png, pdf, jpeg]);

    expect(chunks.map((chunk) => [
      chunk.id,
      chunk.originalFirstPage,
      chunk.pageCount,
      chunk.chunkIndex,
    ])).toEqual([
      ["image-before", 1, 1, 0],
      ["pdf-middle", 1, 10, 0],
      ["pdf-middle", 11, 1, 1],
      ["image-after", 1, 1, 0],
    ]);
    expect(chunks[0].data).toBe(png.data);
    expect(chunks[3].data).toBe(jpeg.data);
  });

  it("allows exactly 50 aggregate pages and rejects page 51", async () => {
    expect(MAX_DOCUMENT_PAGES).toBe(50);
    await expect(chunkProviderDocuments([
      document({
        id: "fifty-pages",
        name: "fifty.pdf",
        mimeType: "application/pdf",
        data: await makePdf(50),
      }),
    ])).resolves.toHaveLength(5);

    await expect(chunkProviderDocuments([
      document({
        id: "fifty-one-pages",
        name: "fifty-one.pdf",
        mimeType: "application/pdf",
        data: await makePdf(51),
      }),
    ])).rejects.toMatchObject({
      name: "ProviderProcessingError",
      message: "Use documents with no more than 50 pages in total.",
    });
  });

  it("rejects corrupt, encrypted, and zero-page PDFs", async () => {
    const encrypted = await PDFDocument.create();
    encrypted.addPage();
    encrypted.context.trailerInfo.Encrypt = encrypted.context.register(
      encrypted.context.obj({ Filter: "Standard" }),
    );

    const invalidDocuments = [
      document({
        id: "corrupt",
        name: "corrupt.pdf",
        mimeType: "application/pdf",
        data: new TextEncoder().encode("%PDF-not-a-valid-document"),
      }),
      document({
        id: "encrypted",
        name: "encrypted.pdf",
        mimeType: "application/pdf",
        data: await encrypted.save({ useObjectStreams: false }),
      }),
      document({
        id: "empty-pages",
        name: "empty-pages.pdf",
        mimeType: "application/pdf",
        data: makeZeroPagePdf(),
      }),
    ];

    for (const invalid of invalidDocuments) {
      await expect(chunkProviderDocuments([invalid])).rejects.toBeInstanceOf(
        ProviderProcessingError,
      );
    }
  });

  it("rejects empty images and unsupported input types", async () => {
    await expect(chunkProviderDocuments([
      document({
        id: "empty-image",
        name: "empty.png",
        mimeType: "image/png",
        data: new Uint8Array(),
      }),
    ])).rejects.toBeInstanceOf(ProviderProcessingError);

    await expect(chunkProviderDocuments([
      document({
        id: "unsupported",
        name: "notes.txt",
        mimeType: "text/plain",
        data: new TextEncoder().encode("notes"),
      }),
    ])).rejects.toMatchObject({
      name: "ProviderProcessingError",
      message: "Only PDF, JPEG, and PNG documents can be prepared for reading.",
    });
  });
});
