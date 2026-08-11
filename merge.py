"""
Mixamo FBX -> бір GLB біріктіргіш.

3d-source/ ішіндегі FBX файлдарды оқып, mesh бар біреуін базалық модель
етіп алады да, қалғандарының анимациясын сол армaturе-ге NLA track болып
көшіріледі. Нәтижесі: models/athlete.glb — бір mesh + бір armature +
әр анимация жеке клип.

Іске қосу:
  blender.exe --background --python merge.py
"""

import bpy
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "3d-source")
OUT = os.path.join(ROOT, "models", "athlete.glb")

# Файл аты -> клип аты. Реттік емес, мағыналық сәйкестік.
NAME_MAP = {
    "air squat": "squat",
    "push up": "pushup",
    "plank": "plank",
    "burpee": "burpee",
    "jumping jacks": "jumpingjacks",
    "bicycle crunch": "bicyclecrunch",
    "circle crunch": "circlecrunch",
    "idle": "idle",
    "neck stretching": "stretchneck",
    "arm stretching": "stretcharm",
}
WANTED = ["squat", "pushup", "plank", "burpee", "jumpingjacks",
          "bicyclecrunch", "circlecrunch", "idle", "stretchneck", "stretcharm"]


def log(msg):
    print("[merge] %s" % msg)


def fail(msg):
    print("[merge][QATE] %s" % msg)
    sys.exit(1)


def clip_name(filename):
    """Файл атынан клип атын шығару: алдымен картадан, болмаса slug."""
    base = os.path.splitext(os.path.basename(filename))[0]
    key = re.sub(r"\s+", " ", base.strip().lower())
    key = re.sub(r"\s*\(\d+\)$", "", key)          # «Idle (1)» -> «idle»
    if key in NAME_MAP:
        return NAME_MAP[key]
    slug = re.sub(r"[^a-z0-9]", "", key)
    log("ESKERTU: '%s' картада жоқ, аты '%s' болып қойылды" % (base, slug))
    return slug


def fbx_files():
    if not os.path.isdir(SRC):
        fail("3d-source қалтасы табылмады: %s" % SRC)
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(".fbx"))
    if not files:
        fail("3d-source ішінде бірде-бір FBX файл жоқ")
    return files


def run_import(path):
    """FBX импорттау. Blender нұсқасына қарай екі оператордың бірі."""
    if hasattr(bpy.ops.import_scene, "fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    elif hasattr(bpy.ops.wm, "fbx_import"):
        bpy.ops.wm.fbx_import(filepath=path)
    else:
        fail("Бұл Blender нұсқасында FBX импорттаушысы жоқ")


def import_fbx(path):
    """Импорттап, ЖАҢА пайда болған объект пен action тізімін қайтарады."""
    before_obj = set(bpy.data.objects)
    before_act = set(bpy.data.actions)
    try:
        run_import(path)
    except RuntimeError as e:
        fail("Импорт сәтсіз (%s): %s" % (os.path.basename(path), e))
    objs = [o for o in bpy.data.objects if o not in before_obj]
    acts = [a for a in bpy.data.actions if a not in before_act]
    return objs, acts


def drop_objects(objs):
    for o in objs:
        try:
            bpy.data.objects.remove(o, do_unlink=True)
        except Exception:
            pass


def drop_actions(acts):
    for a in acts:
        try:
            bpy.data.actions.remove(a)
        except Exception:
            pass


def find_base(files):
    """Mesh объектісі БАР бірінші файлды базалық модель етіп алу."""
    for name in files:
        objs, acts = import_fbx(os.path.join(SRC, name))
        if any(o.type == "MESH" for o in objs):
            log("базалық модель: %s" % name)
            return name, objs, acts
        log("mesh жоқ, өткізілді: %s" % name)
        drop_objects(objs)
        drop_actions(acts)
    return None, [], []


def bind_slot(strip, action):
    """Blender 4.4+ слоттары: strip-ке action слотын байлау."""
    slots = getattr(action, "slots", None)
    if not slots or not hasattr(strip, "action_slot"):
        return
    if getattr(strip, "action_slot", None) is None:
        try:
            strip.action_slot = slots[0]
        except Exception as e:
            log("слот байланбады (%s): %s" % (action.name, e))


def push_nla(arm, action, clip):
    """Action-ды жеке NLA track-қа салу — glTF әр тректі бөлек клип етеді."""
    action.name = clip
    ad = arm.animation_data or arm.animation_data_create()
    track = ad.nla_tracks.new()
    track.name = clip
    start = int(action.frame_range[0])
    strip = track.strips.new(clip, start, action)
    strip.name = clip
    bind_slot(strip, action)
    ad.action = None
    return action


def frames_of(action):
    lo, hi = action.frame_range
    return int(round(hi - lo)) + 1


def collect(base_name, base_objs, base_acts, files):
    """Базалық armature-ді тауып, барлық анимацияны соған жинау."""
    arms = [o for o in base_objs if o.type == "ARMATURE"]
    if not arms:
        fail("Базалық файлда armature жоқ: %s" % base_name)
    arm = arms[0]
    clips = []
    if base_acts:
        clips.append(push_nla(arm, base_acts[0], clip_name(base_name)))
        drop_actions(base_acts[1:])
    for name in files:
        if name == base_name:
            continue
        clips.append(take_action(arm, name))
    return arm, [c for c in clips if c]


def take_action(arm, name):
    """Бір FBX-ті импорттап, action-ын алып, артық объектілерін өшіру."""
    objs, acts = import_fbx(os.path.join(SRC, name))
    if not acts:
        log("ESKERTU: анимация табылмады: %s" % name)
        drop_objects(objs)
        return None
    action = push_nla(arm, acts[0], clip_name(name))
    drop_actions(acts[1:])
    drop_objects(objs)
    return action


def join_meshes():
    """Mixamo кейіпкері 2 mesh-тен тұрады (Beta_Joints + Beta_Surface).
    Екеуін бір объектіге біріктіреміз — сүйек салмақтары мен материал
    ұялары сақталады."""
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) < 2:
        log("біріктіру керек емес: mesh саны %d" % len(meshes))
        return
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    try:
        bpy.ops.object.join()
    except RuntimeError as e:
        log("ESKERTU: біріктіру сәтсіз, екі mesh қалды: %s" % e)
        return
    joined = bpy.context.view_layer.objects.active
    joined.name = "athlete"
    joined.data.name = "athlete"
    log("біріктірілді: %d mesh -> '%s'" % (len(meshes), joined.name))


def export_glb():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wanted = {
        "filepath": OUT,
        "export_format": "GLB",
        "export_animations": True,
        "export_apply": True,
    }
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    # Нұсқаға қарай: жаңасында режим, ескісінде тек жалауша
    if "export_animation_mode" in props:
        wanted["export_animation_mode"] = "NLA_TRACKS"
    if "export_nla_strips" in props:
        wanted["export_nla_strips"] = True
    kwargs = dict((k, v) for k, v in wanted.items() if k in props or k == "filepath")
    bpy.ops.export_scene.gltf(**kwargs)


def report(arm, clips):
    print("")
    print("=== КЛИПТЕР ===")
    for a in clips:
        print("  %-14s %4d кадр" % (a.name, frames_of(a)))
    names = [a.name for a in clips]
    missing = [w for w in WANTED if w not in names]
    extra = [n for n in names if n not in WANTED]
    print("")
    print("Клип саны: %d / %d" % (len(names), len(WANTED)))
    print("Жоқтары: %s" % (", ".join(missing) if missing else "жоқ — бәрі бар"))
    if extra:
        print("Тізімде жоқ артық клип: %s" % ", ".join(extra))
    print("NLA тректері: %d" % len(arm.animation_data.nla_tracks))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    print("Mesh саны: %d, armature саны: %d"
          % (len(meshes), len([o for o in bpy.data.objects if o.type == "ARMATURE"])))
    if meshes:
        d = meshes[0].dimensions
        print("Модель өлшемі (X/Y/Z): %.2f / %.2f / %.2f" % (d.x, d.y, d.z))
    size = os.path.getsize(OUT)
    print("Файл: %s" % OUT)
    print("Өлшемі: %.2f МБ (%d байт)" % (size / 1048576.0, size))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    files = fbx_files()
    log("FBX саны: %d" % len(files))
    base_name, base_objs, base_acts = find_base(files)
    if not base_name:
        fail("Бірде-бір FBX ішінде mesh жоқ — Mixamo-дан «With Skin» "
             "нұсқасын жүктеу керек (кемінде бір файл модельмен болсын)")
    arm, clips = collect(base_name, base_objs, base_acts, files)
    join_meshes()
    export_glb()
    report(arm, clips)


main()
