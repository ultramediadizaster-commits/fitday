"""audio/parts/*.mp3 -> audio/voice.mp3 + audio/sprite.json"""
import subprocess, os, json, sys

FF = os.environ.get("FFBIN", r"C:\Users\470s\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin")
FFMPEG = os.path.join(FF, "ffmpeg.exe")
FFPROBE = os.path.join(FF, "ffprobe.exe")

SR, GAP = 44100, 0.3          # 44.1 кГц моно, аралары 0.3 сек

def probe(p):
    return float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration",
                                 "-of", "csv=p=0", p], capture_output=True, text=True).stdout.strip())

def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    parts = os.path.join(root, "audio", "parts")
    with open(os.path.join(parts, "_order.json"), encoding="utf-8") as f:
        order = json.load(f)

    pcm_path = os.path.join(root, "audio", "_voice.pcm")
    silence = b"\x00\x00" * int(round(GAP * SR))
    sprite, pos = {}, 0                      # pos — үлгі (sample) саны

    with open(pcm_path, "wb") as out:
        for i, name in enumerate(order):
            src = os.path.join(parts, name + ".mp3")
            pcm = subprocess.run([FFMPEG, "-v", "error", "-i", src, "-f", "s16le",
                                  "-ar", str(SR), "-ac", "1", "-"],
                                 capture_output=True, check=True).stdout
            n = len(pcm) // 2
            sprite[name] = [round(pos / SR, 3), round(n / SR, 3)]
            out.write(pcm); pos += n
            if i + 1 < len(order):
                out.write(silence); pos += len(silence) // 2

    voice = os.path.join(root, "audio", "voice.mp3")
    subprocess.run([FFMPEG, "-y", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1",
                    "-i", pcm_path, "-c:a", "libmp3lame", "-b:a", "96k", voice], check=True)
    os.remove(pcm_path)

    with open(os.path.join(root, "audio", "sprite.json"), "w", encoding="utf-8") as f:
        rows = ['  "%s": [%s, %s]' % (k, v[0], v[1]) for k, v in sprite.items()]
        f.write("{\n" + ",\n".join(rows) + "\n}\n")

    exp, got = pos / SR, probe(voice)
    print(f"voice.mp3: {got:.3f}s (күтілген {exp:.3f}s, айырма {got-exp:+.3f}s), "
          f"{os.path.getsize(voice)//1024} KB, {len(sprite)} фраза")
    if abs(got - exp) > 0.05:
        print("ЕСКЕРТУ: ұзақтық сәйкес емес"); sys.exit(1)

if __name__ == "__main__":
    main()
