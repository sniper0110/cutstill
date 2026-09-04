#!/usr/bin/env python3
"""Pose Landmarker Lite → JSON landmarks. Args: <model.task> <image.png>"""

from __future__ import annotations

import json
import sys


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: pose_landmarker.py <model.task> <image>", file=sys.stderr)
        return 2
    model_path, image_path = sys.argv[1], sys.argv[2]
    try:
        import mediapipe as mp
        from mediapipe.tasks import python
        from mediapipe.tasks.python import vision
    except ImportError:
        print(json.dumps({"error": "MEDIAPIPE_MISSING", "landmarks": []}))
        return 3

    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.4,
        min_pose_presence_confidence=0.4,
    )
    detector = vision.PoseLandmarker.create_from_options(options)
    try:
        image = mp.Image.create_from_file(image_path)
        result = detector.detect(image)
        if not result.pose_landmarks:
            print(json.dumps({"landmarks": []}))
            return 0
        pose = result.pose_landmarks[0]
        landmarks = []
        for lm in pose:
            landmarks.append(
                {
                    "x": float(lm.x),
                    "y": float(lm.y),
                    "visibility": float(getattr(lm, "visibility", 1.0) or 0.0),
                }
            )
        print(json.dumps({"landmarks": landmarks}))
        return 0
    finally:
        try:
            detector.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
