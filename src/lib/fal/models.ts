export const FAL_MODEL_IDS = [
  "bytedance/seedance-2.5/text-to-video",
  "bytedance/seedance-2.5/image-to-video",
  "bytedance/seedance-2.5/reference-to-video",
] as const;

export type FalModelId = (typeof FAL_MODEL_IDS)[number];

export const FAL_RESOLUTIONS = ["480p", "720p"] as const;
export const FAL_ASPECT_RATIOS = ["auto", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;

export function isFalModelId(value: string): value is FalModelId {
  return (FAL_MODEL_IDS as readonly string[]).includes(value);
}

export function falModelNeedsImage(modelId: string): boolean {
  return modelId === "bytedance/seedance-2.5/image-to-video";
}

export function listFalModels(): Array<{ id: FalModelId; kind: string }> {
  return [
    { id: "bytedance/seedance-2.5/text-to-video", kind: "text-to-video" },
    { id: "bytedance/seedance-2.5/image-to-video", kind: "image-to-video" },
    { id: "bytedance/seedance-2.5/reference-to-video", kind: "reference-to-video" },
  ];
}
