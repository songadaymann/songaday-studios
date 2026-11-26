"""Make data-lab/faces/: one picture of Jonathan's face per month, for the beard slider on the
data page, plus faces/index.json saying which song each came from.

For each month it looks at YouTube thumbnails of that month's songs, finds faces (OpenCV's
YuNet), keeps the ones that match a known picture of him from about the same year (OpenCV's
SFace), and saves the best as a small square with the eyes at fixed points, so the pictures
line up when you slide through them.

    PYTHON make-faces.py MODELS_DIR THUMBS_DIR REFERENCES.json [DATASET.csv]

PYTHON needs opencv-python-headless and numpy. MODELS_DIR holds yunet.onnx and sface.onnx.
THUMBS_DIR is a cache for the thumbnails (about 300 MB). REFERENCES.json lists one song per
year whose thumbnail is known to show him: [{"year": 2009, "yt": "..."}, ...]. The result
still needs a look by eye; REJECT below lists the songs to pass over.
"""
import csv, json, os, sys, urllib.request
from pathlib import Path
import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "faces"
SIZE, EYE_Y, EYE_GAP = 320, 0.38, 0.20   # the square, and where the eyes sit in it
FIRST_TRY = 12       # thumbnails looked at per month before trying the rest
MATCH = 0.40         # cosine similarity with the reference needed to count as him
MIN_EYE_GAP = 26     # pixels in the thumbnail; smaller faces are too soft
# Song numbers passed over after looking at the sheet: someone else, a child in the picture,
# a face filter, or too washed out.
REJECT = {1341, 1381, 2679, 3794, 4116, 5750, 6317}


def thumbnail(yt, folder):
    path = folder / f"{yt}.jpg"
    if not path.exists():
        try:
            data = urllib.request.urlopen(f"https://i.ytimg.com/vi/{yt}/maxresdefault.jpg", timeout=20).read()
        except Exception:
            data = b""
        path.write_bytes(data if len(data) > 5000 else b"")     # an empty file marks "no large thumbnail"
    return cv2.imread(str(path)) if path.stat().st_size else None


def faces_in(image, detector, recognizer):
    detector.setInputSize((image.shape[1], image.shape[0]))
    _, found = detector.detect(image)
    out = []
    for f in (found if found is not None else []):
        marks = f[4:14].reshape(5, 2)
        gap = float(np.hypot(*(marks[1] - marks[0])))
        if gap < MIN_EYE_GAP:
            continue
        turn = abs(float(marks[2][0] - (marks[0][0] + marks[1][0]) / 2)) / gap
        feature = recognizer.feature(recognizer.alignCrop(image, f.reshape(1, -1))).reshape(-1)
        out.append({"marks": marks, "gap": gap, "turn": turn, "feature": feature / np.linalg.norm(feature),
                    "quality": float(f[14]) * min(gap, 140) / 140 * max(0.0, 1 - 2.2 * turn)})
    return out


def aligned(image, marks):
    (x1, y1), (x2, y2) = marks[0], marks[1]
    gap = float(np.hypot(x2 - x1, y2 - y1)); scale = EYE_GAP * SIZE / gap
    centre = (float(x1 + x2) / 2, float(y1 + y2) / 2)
    matrix = cv2.getRotationMatrix2D(centre, float(np.degrees(np.arctan2(y2 - y1, x2 - x1))), scale)
    matrix[0, 2] += SIZE / 2 - centre[0]; matrix[1, 2] += SIZE * EYE_Y - centre[1]
    return cv2.warpAffine(image, matrix, (SIZE, SIZE), flags=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(17, 17, 17))   # past the thumbnail's edge: the page's dark grey


def main():
    models, folder, refs = Path(sys.argv[1]), Path(sys.argv[2]), json.loads(Path(sys.argv[3]).read_text())
    dataset = sys.argv[4] if len(sys.argv) > 4 else os.path.expanduser("~/Projects/songaday-data/dataset/songaday.csv")
    folder.mkdir(parents=True, exist_ok=True); OUT.mkdir(exist_ok=True)
    detector = cv2.FaceDetectorYN.create(str(models / "yunet.onnx"), "", (320, 320), 0.8, 0.3, 50)
    recognizer = cv2.FaceRecognizerSF.create(str(models / "sface.onnx"), "")
    known = {}
    for ref in refs:
        found = faces_in(thumbnail(ref["yt"], folder), detector, recognizer)
        known[ref["year"]] = max(found, key=lambda f: f["quality"])["feature"]
    rows = [r for r in csv.DictReader(open(dataset, newline="")) if len(r["youtube_id"]) == 11]
    months = {}
    for r in rows:
        months.setdefault(r["date"][:7], []).append(r)
    index, strips = [], []
    for month in sorted(months):
        songs, year = [r for r in months[month] if int(r["number"]) not in REJECT], int(month[:4])
        near = [known[y] for y in (year - 1, year, year + 1) if y in known]
        step = max(1, len(songs) // FIRST_TRY)
        first = songs[step // 2::step]
        best = None
        for batch in (first, [s for s in songs if s not in first]):
            for r in batch:
                image = thumbnail(r["youtube_id"], folder)
                if image is None:
                    continue
                found = faces_in(image, detector, recognizer)
                if len(found) != 1:          # nobody else in the picture
                    continue
                for f in found:
                    match = max(float(f["feature"] @ k) for k in near)
                    if match >= MATCH and (best is None or f["quality"] > best[0]["quality"]):
                        best = (f, r, image, match)
            if best:
                break
        if not best:
            print(month, "no match", flush=True); continue
        f, r, image, match = best
        picture = aligned(image, f["marks"])
        cv2.imwrite(str(OUT / f"{month}.jpg"), picture, [cv2.IMWRITE_JPEG_QUALITY, 80])
        index.append({"month": month, "n": int(r["number"]), "beard": r["beard"]})
        small = cv2.resize(picture, (120, 120)); cv2.putText(small, month[2:], (3, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)
        strips.append(small)
        print(month, r["number"], f"match {match:.2f}", flush=True)
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    while len(strips) % 12:
        strips.append(np.zeros((120, 120, 3), np.uint8))
    sheet = np.vstack([np.hstack(strips[i:i + 12]) for i in range(0, len(strips), 12)])
    cv2.imwrite(str(folder / "faces-sheet.jpg"), sheet, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print("wrote", len(index), "pictures")


if __name__ == "__main__":
    main()
