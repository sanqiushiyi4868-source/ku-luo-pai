"use strict";

let recognizer = null;
let GestureRecognizer = null;
let FilesetResolver = null;
let tasksLoaded = false;

const rawConsoleError = console.error.bind(console);
const rawConsoleWarn = console.warn.bind(console);
console.error = (...args) => {
    const text = args.map(String).join(" ");
    if (text.includes("Created TensorFlow Lite XNNPACK delegate")) {
        console.log(`[gesture:mediapipe] ${text}`);
        return;
    }
    rawConsoleError(...args);
};
console.warn = (...args) => {
    const text = args.map(String).join(" ");
    if (
        text.includes("Feedback manager requires a model with a single signature inference") ||
        text.includes("Using NORM_RECT without IMAGE_DIMENSIONS") ||
        text.includes("OpenGL error checking is disabled")
    ) {
        console.log(`[gesture:mediapipe] ${text}`);
        return;
    }
    rawConsoleWarn(...args);
};

function postError(stage, error) {
    self.postMessage({
        type: "error",
        stage,
        name: error && error.name ? error.name : "Error",
        message: error && error.message ? error.message : String(error || "Unknown error")
    });
}

function slimLandmarks(landmarks) {
    return landmarks.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z || 0
    }));
}

self.onmessage = async (event) => {
    const data = event.data || {};

    if (data.type === "init") {
        try {
            if (!tasksLoaded) {
                self.exports = {};
                importScripts(data.visionBundleUrl);
                GestureRecognizer = self.exports.GestureRecognizer;
                FilesetResolver = self.exports.FilesetResolver;
                tasksLoaded = true;
            }
            if (!GestureRecognizer || !FilesetResolver) {
                throw new Error("MediaPipe Tasks bundle did not expose GestureRecognizer");
            }
            const vision = await FilesetResolver.forVisionTasks(data.wasmBaseUrl);

            recognizer = await GestureRecognizer.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: data.modelUrl
                },
                runningMode: "VIDEO",
                numHands: 1,
                minHandDetectionConfidence: 0.45,
                minHandPresenceConfidence: 0.45,
                minTrackingConfidence: 0.45
            });

            self.postMessage({ type: "ready" });
        } catch (error) {
            postError("gesture:init", error);
        }
        return;
    }

    if (data.type === "frame") {
        const frame = data.bitmap;
        if (!recognizer || !frame) {
            if (frame && frame.close) {
                frame.close();
            }
            self.postMessage({
                type: "result",
                frameId: data.frameId,
                hands: 0,
                landmarks: [],
                gesture: "",
                inferenceMs: 0
            });
            return;
        }

        const startedAt = performance.now();
        try {
            const result = recognizer.recognizeForVideo(frame, data.timestamp || performance.now());
            const inferenceMs = performance.now() - startedAt;
            const landmarks = result.landmarks && result.landmarks.length
                ? slimLandmarks(result.landmarks[0])
                : [];
            const gesture = result.gestures && result.gestures[0] && result.gestures[0][0]
                ? result.gestures[0][0].categoryName
                : "";
            const handedness = result.handedness && result.handedness[0] && result.handedness[0][0]
                ? result.handedness[0][0].categoryName
                : "";

            self.postMessage({
                type: "result",
                frameId: data.frameId,
                hands: landmarks.length ? 1 : 0,
                landmarks,
                gesture,
                handedness,
                inferenceMs
            });
        } catch (error) {
            postError("gesture:frame", error);
            self.postMessage({
                type: "result",
                frameId: data.frameId,
                hands: 0,
                landmarks: [],
                gesture: "",
                inferenceMs: performance.now() - startedAt
            });
        } finally {
            if (frame.close) {
                frame.close();
            }
        }
    }
};
