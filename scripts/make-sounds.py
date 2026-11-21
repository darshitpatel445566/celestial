"""Synthesizes Celestial's original alarm sounds (loopable) into the native module's res/raw folder.

Run: python3 scripts/make-sounds.py   (needs numpy and ffmpeg with libvorbis)
"""
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "modules", "celestial-alarm", "android", "src", "main", "res", "raw")


def tone(freq, dur, partials=((1, 1.0),), attack=0.008, release=0.04):
    t = np.arange(int(dur * SR)) / SR
    wave_ = sum(a * np.sin(2 * np.pi * freq * m * t) for m, a in partials)
    env = np.ones_like(t)
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    return wave_ * env


def pluck(freq, dur, partials, attack=0.004):
    """Struck sound: each partial (ratio, amplitude, decay seconds) fades exponentially."""
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for ratio, amp, decay in partials:
        out += amp * np.sin(2 * np.pi * freq * ratio * t) * np.exp(-t / decay)
    a = max(1, int(attack * SR))
    out[:a] *= np.linspace(0, 1, a)
    fade = int(0.02 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def place(buf, sound, at):
    i = int(at * SR)
    end = min(len(buf), i + len(sound))
    buf[i:end] += sound[: end - i]


def normalize(buf, peak=0.89):
    m = np.max(np.abs(buf)) or 1.0
    return buf * (peak / m)


def beacon():
    # Three bright beeps, then a breath. Clear but not harsh.
    buf = np.zeros(int(1.8 * SR))
    beep = tone(1046.5, 0.14, partials=((1, 1.0), (2, 0.32), (3, 0.12)), attack=0.006, release=0.05)
    for k in range(3):
        place(buf, beep, 0.02 + k * 0.22)
    return normalize(buf)


def rise():
    # Rising marimba-like arpeggio C5 E5 G5 C6.
    buf = np.zeros(int(2.4 * SR))
    for k, f in enumerate([523.25, 659.25, 783.99, 1046.5]):
        note = pluck(f, 1.2, ((1, 1.0, 0.38), (4.0, 0.22, 0.09), (10.0, 0.05, 0.03)))
        place(buf, note, 0.02 + k * 0.17)
    return normalize(buf)


def chime():
    # Soft bell, two strikes. Used for gentle pre-alarms.
    buf = np.zeros(int(3.2 * SR))
    bell = ((1, 1.0, 1.6), (2.0, 0.38, 0.9), (2.76, 0.22, 0.6), (5.4, 0.08, 0.25))
    place(buf, pluck(880.0, 2.6, bell), 0.02)
    place(buf, 0.62 * pluck(1318.5, 1.8, bell), 1.35)
    return normalize(buf, 0.8)


def drift():
    # Slow swelling pad (A4 + E5) with a light shimmer.
    dur = 4.0
    t = np.arange(int(dur * SR)) / SR
    vib = 1 + 0.0017 * np.sin(2 * np.pi * 5.0 * t)
    pad = (
        np.sin(2 * np.pi * 440.0 * vib * t)
        + 0.7 * np.sin(2 * np.pi * 659.25 * vib * t)
        + 0.18 * np.sin(2 * np.pi * 880.0 * t)
    )
    env = np.clip(t / 1.2, 0, 1) * np.clip((dur - t) / 1.4, 0, 1)
    return normalize(pad * env, 0.82)


def write(name, samples):
    os.makedirs(OUT, exist_ok=True)
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, name + ".wav")
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        ogg = os.path.join(OUT, "celestial_" + name + ".ogg")
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", wav_path, "-c:a", "libvorbis", "-q:a", "5", ogg],
            check=True,
        )
        print(ogg, os.path.getsize(ogg), "bytes")


if __name__ == "__main__":
    write("beacon", beacon())
    write("rise", rise())
    write("chime", chime())
    write("drift", drift())
