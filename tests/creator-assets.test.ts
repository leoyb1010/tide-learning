import { describe, expect, it } from "vitest";
import { validateBlocks } from "@/lib/blocks";
import { creatorAssetDiskPath, validateCreatorAsset } from "@/lib/creator-assets";

describe("creator asset safety", () => {
  it("accepts a real PNG header and rejects a spoofed PDF", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateCreatorAsset("image/png", png)).toMatchObject({ kind: "image", ext: "png" });
    expect(validateCreatorAsset("application/pdf", Buffer.from("not a pdf"))).toBeNull();
  });

  it("recognizes PPTX package markers", () => {
    const pptx = Buffer.concat([
      Buffer.from("PK\x03\x04", "latin1"),
      Buffer.from("[Content_Types].xml arbitrary ppt/slides/slide1.xml", "latin1"),
    ]);
    expect(validateCreatorAsset("application/vnd.openxmlformats-officedocument.presentationml.presentation", pptx))
      .toMatchObject({ kind: "presentation", ext: "pptx" });
  });

  it("keeps asset paths inside the private asset directory", () => {
    expect(creatorAssetDiskPath("abc.png")).toMatch(/creator-assets\/abc\.png$/);
    expect(creatorAssetDiskPath("../abc.png")).toBeNull();
  });

  it("allows only the dedicated asset API in image blocks", () => {
    expect(validateBlocks([{ type: "image", src: "/api/assets/cmrtestasset123", caption: "图" }])).toHaveLength(1);
    expect(validateBlocks([{ type: "image", src: "/api/notes/private", caption: "图" }])).toHaveLength(0);
  });
});
