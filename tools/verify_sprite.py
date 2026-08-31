"""sprite.json бойынша voice.mp3-тен әр фразаны кесіп, ұзақтығы мен деңгейін тексеру"""
import subprocess, os, json, re, sys

FF = os.environ.get("FFBIN", r"C:\Users\470s\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin")
FFMPEG = os.path.join(FF, "ffmpeg.exe")

MIN_D, MAX_D = 0.2, 4.0

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    voice = os.path.join(root, "audio", "voice.mp3")
    with open(os.path.join(root, "audio", "sprite.json"), encoding="utf-8") as f:
        sprite = json.load(f)

    bad = []
    for name, (off, dur) in sprite.items():
        log = subprocess.run([FFMPEG, "-v", "info", "-ss", f"{off:.3f}", "-t", f"{dur:.3f}",
                              "-i", voice, "-af", "volumedetect", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
        mean = re.search(r"mean_volume:\s*(-?[\d.]+)", log)
        peak = re.search(r"max_volume:\s*(-?[\d.]+)", log)
        mean = float(mean.group(1)) if mean else -99.0
        peak = float(peak.group(1)) if peak else -99.0
        flag = ""
        if dur < MIN_D: flag = "ТЫМ ҚЫСҚА"
        elif dur > MAX_D: flag = "ТЫМ ҰЗЫН"
        elif peak < -25:  flag = "ДЫБЫС ЖОҚ"
        if flag: bad.append((name, dur, flag))
        print(f"{name:16s} off={off:7.3f}  dur={dur:5.3f}s  peak={peak:6.1f}dB "
              f"mean={mean:6.1f}dB  {flag}")

    print(f"\nБарлығы {len(sprite)} фраза, ұзақтық {min(d for _, d in sprite.values()):.3f}"
          f"–{max(d for _, d in sprite.values()):.3f}s")
    if bad:
        print("ҚАТЕ БӨЛІКТЕР:")
        for n, d, f in bad: print(f"  {n}: {d:.3f}s — {f}")
        sys.exit(1)
    print("Бәрі дұрыс: 0.2s < ұзақтық < 4.0s, әрқайсысында дыбыс бар.")

if __name__ == "__main__":
    main()
