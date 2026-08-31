"""audio/raw/*.mp3 -> audio/parts/*.mp3  (silencedetect арқылы кесу)"""
import subprocess, re, os, sys, json

FF = os.environ.get("FFBIN", r"C:\Users\470s\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin")
FFMPEG = os.path.join(FF, "ffmpeg.exe")
FFPROBE = os.path.join(FF, "ffprobe.exe")
PAD = 0.080  # әр фразаның басы/соңында қалдырылатын тыныштық

# (файл, noise dB, min silence sec, [атаулар])
JOBS = [
 ("raw-count-a.mp3", -30, 0.15, [f"count-{i}" for i in range(1, 16)]),
 ("raw-count-b.mp3", -25, 0.20, [f"count-{i}" for i in range(16, 31)]),
 ("raw-cmd.mp3", -25, 0.20, ["cmd-ready","cmd-start","cmd-rest","cmd-prepare","cmd-next",
   "cmd-half","cmd-last","cmd-almost","cmd-good","cmd-pause","cmd-resume","cmd-breathe",
   "cmd-form","cmd-slow","cmd-day-done","cmd-week-done"]),
 ("raw-ex.mp3", -25, 0.20, ["ex-squat","ex-pushup","ex-plank","ex-burpee","ex-jacks",
   "ex-bicycle","ex-crunch","ex-situp","ex-lunge","ex-bridge","ex-sideplank","ex-wallsit",
   "ex-mountain","ex-legraise","ex-superman","ex-calf"]),
 ("raw-st.mp3", -30, 0.20, ["st-neck","st-arm","st-cat","st-fold","st-side"]),
 ("raw-fc.mp3", -25, 0.20, ["fc-jawline","fc-chin","fc-oval","fc-eyes","fc-forehead",
   "fc-lips","fc-cheeks","fc-neck","fc-smile","fc-temple"]),
 ("raw-fc2.mp3", -30, 0.25, ["fc-wash","fc-mirror","fc-gentle","fc-hold","fc-release","fc-repeat"]),
 ("raw-mot.mp3", -30, 0.30, [f"mot-{i}" for i in range(1, 9)]),
]

def duration(p):
    out = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip()
    return float(out)

def segments(path, noise, mind):
    total = duration(path)
    log = subprocess.run([FFMPEG, "-i", path, "-af",
                          f"silencedetect=noise={noise}dB:d={mind}", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    ev = []
    for line in log.splitlines():
        m = re.search(r"silence_start:\s*(-?[\d.]+)", line)
        if m: ev.append(("s", float(m.group(1))))
        m = re.search(r"silence_end:\s*([\d.]+)", line)
        if m: ev.append(("e", float(m.group(1))))
    segs, cur = [], 0.0
    for kind, t in ev:
        if kind == "s":
            t = max(t, 0.0)
            if cur is not None and t - cur > 0.01: segs.append((cur, t))
            cur = None
        else:
            cur = t
    if cur is not None and total - cur > 0.01: segs.append((cur, total))
    return total, segs

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    raw = os.path.join(root, "audio", "raw")
    out = os.path.join(root, "audio", "parts")
    os.makedirs(out, exist_ok=True)

    plan, bad = [], []
    for fn, noise, mind, names in JOBS:
        total, segs = segments(os.path.join(raw, fn), noise, mind)
        if len(segs) != len(names):
            bad.append((fn, len(segs), len(names)))
            continue
        for i, (a, b) in enumerate(segs):
            prev = segs[i-1][1] if i else 0.0
            nxt = segs[i+1][0] if i + 1 < len(segs) else total
            s = a - min(PAD, max(a - prev, 0) / 2)
            e = b + min(PAD, max(nxt - b, 0) / 2)
            plan.append((fn, names[i], round(s, 4), round(e, 4)))

    if bad:
        print("СӘЙКЕС ЕМЕС:")
        for fn, got, want in bad:
            print(f"  {fn}: {got} бөлік шықты, {want} керек")
        sys.exit(1)

    order = []
    for fn, name, s, e in plan:
        dst = os.path.join(out, name + ".mp3")
        subprocess.run([FFMPEG, "-y", "-v", "error", "-i", os.path.join(raw, fn),
                        "-ss", f"{s:.4f}", "-to", f"{e:.4f}",
                        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", "-ac", "1",
                        dst], check=True)
        order.append(name)
        print(f"{name:16s} {s:7.3f}->{e:7.3f}  {duration(dst):.3f}s")

    with open(os.path.join(out, "_order.json"), "w", encoding="utf-8") as f:
        json.dump(order, f, ensure_ascii=False, indent=1)
    print(f"\nБарлығы: {len(order)} бөлік")

if __name__ == "__main__":
    main()
