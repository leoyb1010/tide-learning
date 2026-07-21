import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { parsePptx, scormSafePath } from "@/lib/import-faithful";

describe("faithful imports", () => {
  it("maps PPTX text and images into the original slide coordinate system", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="p"><p:sldSz cx="1000" cy="500"/></p:presentation>');
    zip.file("ppt/slides/slide1.xml", `
      <p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>
        <p:sp><p:spPr><a:xfrm><a:off x="100" y="50"/><a:ext cx="500" cy="100"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2400" b="1"/><a:t>忠实标题</a:t></a:r></a:p></p:txBody></p:sp>
        <p:pic><p:spPr><a:xfrm><a:off x="600" y="100"/><a:ext cx="300" cy="300"/></a:xfrm></p:spPr><p:blipFill><a:blip r:embed="rId1"/></p:blipFill></p:pic>
      </p:spTree></p:cSld></p:sld>`);
    zip.file("ppt/slides/_rels/slide1.xml.rels", '<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>');
    zip.file("ppt/media/image1.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    const slides = await parsePptx(await zip.generateAsync({ type: "nodebuffer" }));
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe("忠实标题");
    expect(slides[0].html).toContain("left:10.000%");
    expect(slides[0].html).toContain("data:image/png;base64");
    expect(slides[0].html).toContain("connect-src 'none'");
  });

  it("rejects path traversal in SCORM package paths", () => {
    expect(scormSafePath("course/index.html")).toBe("course/index.html");
    expect(scormSafePath("../secret.txt")).toBeNull();
    expect(scormSafePath("https://example.com/a")).toBeNull();
  });
});
