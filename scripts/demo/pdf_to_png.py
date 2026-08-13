import sys
import pypdfium2 as pdfium

pdf_path = sys.argv[1]
out_prefix = sys.argv[2]
pages_arg = sys.argv[3] if len(sys.argv) > 3 else None

pdf = pdfium.PdfDocument(pdf_path)
n = len(pdf)
print(f"{pdf_path}: {n} pages")

if pages_arg:
    indices = [int(x) - 1 for x in pages_arg.split(",")]
else:
    indices = range(n)

for i in indices:
    page = pdf[i]
    bitmap = page.render(scale=1.8)
    pil_image = bitmap.to_pil()
    pil_image.save(f"{out_prefix}-p{i+1}.png")
print("done")
