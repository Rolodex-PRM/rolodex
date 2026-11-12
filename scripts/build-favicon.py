from pathlib import Path
from subprocess import run
from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = root / "apps/mobile/assets"
public = root / "apps/mobile/public"
chrome = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

mark = (assets / "rolodex-mark.svg").read_text(encoding="utf-8")
if '<rect width="128" height="128" fill="#ffffff"/>' not in mark:
    mark = mark.replace(
        'width="512" height="512">',
        'width="512" height="512"><rect width="128" height="128" fill="#ffffff"/>',
        1,
    )
source = assets / "_favicon-source.svg"
png = assets / "_favicon-512.png"
source.write_text(mark, encoding="utf-8")

run(
    [
        str(chrome),
        "--headless=new",
        "--disable-gpu",
        "--window-size=512,512",
        f"--screenshot={png}",
        "file:///" + str(source.resolve()).replace("\\", "/"),
    ],
    check=False,
)

src = Image.open(png).convert("RGBA")
sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
ico_path = public / "favicon.ico"
src.save(ico_path, format="ICO", sizes=sizes)

# Matching Expo / PWA assets
src.resize((48, 48), Image.Resampling.LANCZOS).save(assets / "favicon.png", optimize=True)
src.resize((180, 180), Image.Resampling.LANCZOS).save(public / "apple-touch-icon.png", optimize=True)
src.resize((192, 192), Image.Resampling.LANCZOS).save(public / "icon-192.png", optimize=True)
src.resize((512, 512), Image.Resampling.LANCZOS).save(public / "icon-512.png", optimize=True)
src.resize((1024, 1024), Image.Resampling.LANCZOS).save(assets / "icon.png", optimize=True)

im = Image.open(ico_path)
print("favicon.ico bytes", ico_path.stat().st_size)
print("info", im.info)
if hasattr(im, "ico"):
    print("embedded sizes", sorted(im.ico.sizes()))

source.unlink(missing_ok=True)
png.unlink(missing_ok=True)
print("done")
