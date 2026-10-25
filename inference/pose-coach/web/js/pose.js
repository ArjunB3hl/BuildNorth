// MediaPipe Pose Landmarker (tasks-vision 1.1.0, served locally from web/vendor and web/models).
import { DrawingUtils, FilesetResolver, PoseLandmarker } from '../vendor/tasks-vision-1.1.0/vision_bundle.mjs';

export const MODELS = ['lite', 'full', 'heavy'];

// a step that never finishes (a browser tab whose GPU context hung kept "loading the pose model" forever) fails instead
const within = (p, ms, what) => Promise.race([p, new Promise((_, reject) =>
  setTimeout(() => reject(new Error(`${what} took over ${ms / 1000} s; reload the page`)), ms))]);

/** A PoseLandmarker in VIDEO mode (tracks between frames). Falls back to the CPU when the GPU delegate fails or hangs
 * (it loads in ~0.3 s normally). */
export async function createPose({ model = 'full', delegate = 'GPU' } = {}) {
  const fileset = await within(FilesetResolver.forVisionTasks('/web/vendor/tasks-vision-1.1.0/wasm'), 15000, 'loading MediaPipe');
  const make = d => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: `/web/models/pose_landmarker_${model}.task`, delegate: d },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try {
    return { landmarker: await within(make(delegate), 8000, `the ${delegate} pose model`), delegate, model };
  } catch (e) {
    console.warn(`pose: ${delegate} delegate failed (${e}); using CPU`);
    return { landmarker: await within(make('CPU'), 15000, 'the CPU pose model'), delegate: 'CPU', model };
  }
}

/** One frame: {image, world} landmark arrays (33 points each), or nulls when no person was found. */
export function detect(landmarker, source, tMs) {
  const r = landmarker.detectForVideo(source, tMs);
  return { image: r.landmarks?.[0] ?? null, world: r.worldLandmarks?.[0] ?? null };
}

/** Skeleton overlay on a 2D canvas context the size of the frame. */
export function drawPose(ctx, image) {
  if (!image) return;
  const du = new DrawingUtils(ctx);
  du.drawConnectors(image, PoseLandmarker.POSE_CONNECTIONS, { color: '#00e5ff', lineWidth: 3 });
  du.drawLandmarks(image, { color: '#ff3d71', radius: 3 });
}
