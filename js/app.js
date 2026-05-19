(() => {
    "use strict";
    const CARD_FILES = [];
    CARD_FILES.push("Arrow", "Big", "Bubble", "Change", "Cloud", "Create");
    CARD_FILES.push("Dark", "Dash", "Dream", "Earthy", "Erase", "Fight");
    CARD_FILES.push("Firey", "Float", "Flower", "Fly", "Freeze", "Glow");
    CARD_FILES.push("Illusion", "Jump", "Libra", "Light", "Little", "Lock");
    CARD_FILES.push("Loop", "Maze", "Mirror", "Mist", "Move", "Nothing");
    CARD_FILES.push("Power", "Return", "Sand", "Shadow", "Shield", "Shot");
    CARD_FILES.push("Silent", "Sleep", "Snow", "Song", "Storm", "Sweet");
    CARD_FILES.push("Sword", "Through", "Thunder", "Time", "Twin", "Voice");
    CARD_FILES.push("Watery", "Wave", "Windy", "Wood", "Rain");

    const ASSET_BASE = "assets";
    const RAW_BASE = ".";
    const MEDIAPIPE_BASE = "assets/vendor/mediapipe";
    const TASKS_BASE = `${MEDIAPIPE_BASE}/tasks`;
    const GESTURE_WORKER_URL = "js/gesture-worker.js";
    const TOTAL_TEXTURES = CARD_FILES.length + 1;
    const CARD_WORLD_WIDTH = 1.6;
    const CARD_WORLD_HEIGHT = 3.6;
    const CARD_WORLD_DEPTH = 0.04;
    const CARD_CORNER_RADIUS = 0.16;
    const CARD_EDGE_SEGMENTS = 10;
    const RELEASE_BURST_LIGHT_MS = 820;
    const HAS_COARSE_POINTER = window.matchMedia("(pointer: coarse)").matches;
    const HAND_FRAME_INTERVAL = HAS_COARSE_POINTER ? 118 : 92;
    const HAND_SAMPLE_WIDTH = HAS_COARSE_POINTER ? 224 : 256;
    const HAND_SAMPLE_HEIGHT = HAS_COARSE_POINTER ? 168 : 192;
    const HAND_MIN_SAMPLE_WIDTH = 224;
    const HAND_MIN_SAMPLE_HEIGHT = 168;
    const HAND_ACTION_DEBOUNCE_MS = 120;
    const HAND_CONNECTIONS = [
        [0, 1], [1, 2], [2, 3], [3, 4],
        [0, 5], [5, 6], [6, 7], [7, 8],
        [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16],
        [13, 17], [17, 18], [18, 19], [19, 20],
        [0, 17]
    ];

    const dom = {
        loadingScreen: document.getElementById("loading-screen"),
        loadingText: document.getElementById("loading-text"),
        loadingSubtext: document.getElementById("loading-subtext"),
        startButton: document.getElementById("magic-circle-btn"),
        touchStartButton: document.getElementById("touch-start-btn"),
        gestureStartButton: document.getElementById("gesture-start-btn"),
        launchOptions: document.getElementById("launch-options"),
        localFileNote: document.getElementById("local-file-note"),
        statusText: document.getElementById("status-text"),
        modePanel: document.getElementById("mode-panel"),
        cursorRing: document.getElementById("cursor-ring"),
        historyTray: document.getElementById("history-tray"),
        webcamWrap: document.getElementById("webcam-container"),
        webcam: document.getElementById("webcam"),
        webcamOverlay: document.getElementById("webcam-overlay"),
        gestureToggle: document.getElementById("gesture-toggle"),
        gestureStatus: document.getElementById("gesture-status"),
        qualityBadge: document.getElementById("quality-badge")
    };

    const state = {
        loadState: "LOADING",
        loadedCount: 0,
        currentInputSource: "mouse",
        activeCard: null,
        wasActionDown: false,
        cursorX: window.innerWidth / 2,
        cursorY: window.innerHeight / 2,
        globalAngle: 0,
        angularVelocity: 0,
        lastPointerX: null,
        pointerDown: false,
        pointerId: null,
        handLostFrames: 0,
        isHandPinching: false,
        handModeStarted: false,
        handStream: null,
        gestureWorker: null,
        gestureWorkerReady: false,
        gestureWorkerLoading: false,
        gestureWarmupStarted: false,
        gestureReadyPromise: null,
        gestureReadyResolve: null,
        gestureReadyReject: null,
        gestureFramePending: false,
        gestureFrameCreating: false,
        gestureFrameId: 0,
        gestureTimerId: null,
        gestureVideoCallbackId: null,
        handCanvas: null,
        handCtx: null,
        webcamOverlayCtx: null,
        handFrameInterval: HAND_FRAME_INTERVAL,
        gestureTargetInterval: HAND_FRAME_INTERVAL,
        gestureSampleWidth: HAND_SAMPLE_WIDTH,
        gestureSampleHeight: HAND_SAMPLE_HEIGHT,
        lastGestureFrameAt: 0,
        lastGestureResultAt: 0,
        lastHandProcessTime: 0,
        lastHandSeenAt: 0,
        lastGestureStatusAt: 0,
        lastGestureStatusText: "",
        handActionScore: 0,
        lastHandActionAt: 0,
        handSlowFrames: 0,
        handFrameTimeouts: 0,
        handModelLoading: false,
        frameCount: 0,
        fpsWindowStart: performance.now(),
        slowFrames: 0,
        degradationLevel: 0,
        longTaskCount: 0,
        lastLongTaskReportAt: 0,
        revealLightUntil: 0,
        lastReleaseAt: 0,
        lastExplosionDelayMs: 0
    };

    function setStatus(text, tone = "normal") {
        dom.statusText.textContent = text;
        dom.statusText.dataset.tone = tone;
    }

    function setGestureStatus(text, tone = "idle", force = false) {
        const now = performance.now();
        if (!force && text === state.lastGestureStatusText && now - state.lastGestureStatusAt < 420) {
            return;
        }
        state.lastGestureStatusText = text;
        state.lastGestureStatusAt = now;
        dom.gestureStatus.textContent = text;
        dom.gestureStatus.dataset.tone = tone;
    }

    function reportStage(stage, detail, tone = "warn") {
        const message = detail instanceof Error
            ? `${detail.name || "Error"}: ${detail.message || "未知错误"}`
            : String(detail);
        const prefix = `[${stage}]`;
        if (tone === "warn") {
            console.warn(prefix, detail);
        } else {
            console.log(prefix, detail);
        }
        return `${stage}：${message}`;
    }

    function scheduleIdle(callback, timeout = 900) {
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(callback, { timeout });
            return;
        }
        window.setTimeout(callback, Math.min(timeout, 250));
    }

    function viewportMetrics() {
        const visual = window.visualViewport;
        const rawWidth = visual && visual.width ? visual.width : window.innerWidth;
        const rawHeight = visual && visual.height ? visual.height : window.innerHeight;
        const width = Math.max(320, Math.round(rawWidth || document.documentElement.clientWidth || 320));
        const height = Math.max(320, Math.round(rawHeight || document.documentElement.clientHeight || 320));
        const min = Math.min(width, height);
        const max = Math.max(width, height);
        return {
            width,
            height,
            min,
            max,
            aspect: width / height,
            coarse: window.matchMedia("(pointer: coarse)").matches
        };
    }

    function responsiveCardLayout() {
        if (!quality || !quality.baseLayout) {
            return null;
        }

        const viewport = viewportMetrics();
        const cameraMode = state.handModeStarted || state.currentInputSource === "hand";
        const tabletLike = viewport.coarse && viewport.min >= 620 && viewport.max >= 960;
        const compact = viewport.min < 620;

        if (cameraMode) {
            if (tabletLike) {
                return {
                    radius: 5.1,
                    horizontalRadius: 2.35,
                    depthOffset: -1.8,
                    cardScale: 0.42,
                    grabScale: 0.76,
                    revealScale: 0.88
                };
            }

            if (compact) {
                return {
                    radius: 4.65,
                    horizontalRadius: 1.35,
                    depthOffset: -2.2,
                    cardScale: 0.35,
                    grabScale: 0.68,
                    revealScale: 0.8
                };
            }

            return {
                radius: 5.1,
                horizontalRadius: 2.85,
                depthOffset: -2.35,
                cardScale: 0.44,
                grabScale: 0.88,
                revealScale: 0.98
            };
        }

        if (tabletLike) {
            return {
                radius: 5.1,
                horizontalRadius: 2.35,
                depthOffset: -1.8,
                cardScale: 0.42,
                grabScale: 0.78,
                revealScale: 0.9
            };
        }

        if (compact) {
            return {
                radius: 4.65,
                horizontalRadius: 1.35,
                depthOffset: -2.2,
                cardScale: 0.35,
                grabScale: 0.72,
                revealScale: 0.82
            };
        }

        return quality.baseLayout;
    }

    function applyResponsiveCardLayout() {
        const layout = responsiveCardLayout();
        if (!layout) {
            return;
        }
        quality.radius = layout.radius;
        quality.horizontalRadius = layout.horizontalRadius || layout.radius;
        quality.depthOffset = layout.depthOffset;
        quality.cardScale = layout.cardScale;
        quality.grabScale = layout.grabScale;
        quality.revealScale = layout.revealScale;
    }

    function setupLongTaskObserver() {
        if (!("PerformanceObserver" in window)) {
            return;
        }
        try {
            const observer = new PerformanceObserver((list) => {
                const now = performance.now();
                for (const entry of list.getEntries()) {
                    if (entry.duration < 80 || now - state.lastLongTaskReportAt < 1500) {
                        continue;
                    }
                    state.longTaskCount += 1;
                    state.lastLongTaskReportAt = now;
                    reportStage("webgl:longtask", `${Math.round(entry.duration)}ms`, "log");
                }
            });
            observer.observe({ entryTypes: ["longtask"] });
        } catch (error) {
            reportStage("webgl:longtask", error, "log");
        }
    }

    function chooseQuality() {
        const cores = navigator.hardwareConcurrency || 4;
        const memory = navigator.deviceMemory || 4;
        const viewport = viewportMetrics();
        const coarse = viewport.coarse;
        const smallScreen = viewport.min < 760;

        if (cores <= 4 || memory <= 3) {
            return {
                label: "轻量",
                cards: smallScreen ? 12 : 14,
                activeCards: smallScreen ? 12 : 14,
                particles: 300,
                activeParticles: 300,
                cherryParticles: 420,
                activeCherryParticles: 420,
                pixelRatio: 1.1,
                radius: smallScreen ? 4.65 : 7.2,
                horizontalRadius: smallScreen ? 1.35 : 7.2,
                depthOffset: smallScreen ? -2.2 : 0,
                cardScale: smallScreen ? 0.35 : 0.58,
                grabScale: smallScreen ? 0.72 : 1.04,
                revealScale: smallScreen ? 0.82 : 1.12
            };
        }

        if (coarse || smallScreen) {
            return {
                label: "移动",
                cards: 14,
                activeCards: 14,
                particles: 520,
                activeParticles: 520,
                cherryParticles: 680,
                activeCherryParticles: 680,
                pixelRatio: 1.25,
                radius: 4.65,
                horizontalRadius: 1.35,
                depthOffset: -2.2,
                cardScale: 0.35,
                grabScale: 0.72,
                revealScale: 0.82
            };
        }

        return {
            label: "高画质",
            cards: 18,
            activeCards: 18,
            particles: 920,
            activeParticles: 920,
            cherryParticles: 1100,
            activeCherryParticles: 1100,
            pixelRatio: 1.65,
            radius: 8,
            horizontalRadius: 8,
            depthOffset: 0,
            cardScale: 0.65,
            grabScale: 1.17,
            revealScale: 1.24
        };
    }

    const quality = chooseQuality();
    quality.baseLayout = {
        radius: quality.radius,
        horizontalRadius: quality.horizontalRadius || quality.radius,
        depthOffset: quality.depthOffset,
        cardScale: quality.cardScale,
        grabScale: quality.grabScale,
        revealScale: quality.revealScale
    };
    applyResponsiveCardLayout();
    dom.qualityBadge.textContent = quality.label;

    function markLoaded(label) {
        state.loadedCount += 1;
        if (state.loadState === "LOADING") {
            dom.loadingText.textContent = `魔力注入中 (${state.loadedCount}/${TOTAL_TEXTURES})...`;
            dom.loadingSubtext.textContent = label ? `正在载入 ${label}` : "正在载入牌面";
        }
    }

    function createPlaceholderTexture(label) {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#f7edcf";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#a32946";
        ctx.lineWidth = 18;
        ctx.strokeRect(28, 28, canvas.width - 56, canvas.height - 56);
        ctx.fillStyle = "#a32946";
        ctx.font = "700 40px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label || "CLOW", canvas.width / 2, canvas.height / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    function loadTexture(loader, sources, label) {
        const queue = Array.isArray(sources) ? sources : [sources];

        return new Promise((resolve) => {
            const trySource = (index) => {
                const url = queue[index];
                loader.load(
                    url,
                    (texture) => {
                        texture.encoding = THREE.sRGBEncoding;
                        texture.minFilter = THREE.LinearFilter;
                        texture.magFilter = THREE.LinearFilter;
                        texture.userData = { sourceUrl: url };
                        markLoaded(label);
                        resolve(texture);
                    },
                    undefined,
                    () => {
                        if (index + 1 < queue.length) {
                            trySource(index + 1);
                            return;
                        }
                        markLoaded(label);
                        console.warn(`Texture failed: ${queue.join(", ")}`);
                        const fallback = createPlaceholderTexture(label);
                        fallback.userData = { sourceUrl: "" };
                        resolve(fallback);
                    }
                );
            };

            if (!queue.length) {
                markLoaded(label);
                resolve(createPlaceholderTexture(label));
                return;
            }

            trySource(0);
        });
    }

    function cardSources(file) {
        return [
            `${ASSET_BASE}/cards/${file}.webp`,
            `${RAW_BASE}/cards/${file}.jpg`
        ];
    }

    function backSources() {
        return [
            `${ASSET_BASE}/back.webp`,
            `${RAW_BASE}/back.jpg`
        ];
    }

    function createRoundedAlphaMap() {
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        const radius = 40;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(radius, 0);
        ctx.lineTo(canvas.width - radius, 0);
        ctx.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
        ctx.lineTo(canvas.width, canvas.height - radius);
        ctx.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
        ctx.lineTo(radius, canvas.height);
        ctx.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
        ctx.lineTo(0, radius);
        ctx.quadraticCurveTo(0, 0, radius, 0);
        ctx.closePath();
        ctx.fill();
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    function roundedRectOutline(width, height, radius, segments) {
        const halfWidth = width / 2;
        const halfHeight = height / 2;
        const r = Math.min(radius, halfWidth, halfHeight);
        const outline = [];
        const corners = [
            { x: halfWidth - r, y: halfHeight - r, from: Math.PI / 2, to: 0 },
            { x: halfWidth - r, y: -halfHeight + r, from: 0, to: -Math.PI / 2 },
            { x: -halfWidth + r, y: -halfHeight + r, from: -Math.PI / 2, to: -Math.PI },
            { x: -halfWidth + r, y: halfHeight - r, from: Math.PI, to: Math.PI / 2 }
        ];

        for (const corner of corners) {
            for (let i = 0; i <= segments; i++) {
                const t = i / segments;
                const angle = corner.from + (corner.to - corner.from) * t;
                outline.push({
                    x: corner.x + Math.cos(angle) * r,
                    y: corner.y + Math.sin(angle) * r
                });
            }
        }

        return outline;
    }

    function createRoundedEdgeGeometry(width, height, depth, radius, segments) {
        const outline = roundedRectOutline(width, height, radius, segments);
        const positions = [];
        const normals = [];
        const colors = [];
        const indices = [];
        const frontZ = depth / 2;
        const backZ = -depth / 2;
        const shadow = new THREE.Color(0x7e4655);
        const midtone = new THREE.Color(0xc47e91);
        const highlight = new THREE.Color(0xf3b9c4);

        function pushVertex(point, z) {
            positions.push(point.x, point.y, z);
            const normalLength = Math.max(0.001, Math.hypot(point.x, point.y));
            normals.push(point.x / normalLength, point.y / normalLength, 0);

            const yMix = (point.y / (height / 2) + 1) * 0.5;
            const zMix = z > 0 ? 0.18 : -0.08;
            const color = shadow.clone().lerp(midtone, 0.58 + yMix * 0.18 + zMix).lerp(highlight, yMix * 0.16);
            colors.push(color.r, color.g, color.b);
        }

        for (let i = 0; i < outline.length; i++) {
            const nextIndex = (i + 1) % outline.length;
            const current = outline[i];
            const next = outline[nextIndex];
            const base = positions.length / 3;
            pushVertex(current, frontZ);
            pushVertex(next, frontZ);
            pushVertex(next, backZ);
            pushVertex(current, backZ);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geometry.setIndex(indices);
        geometry.computeBoundingSphere();
        return geometry;
    }

    const textureLoader = new THREE.TextureLoader();
    const roundedAlphaMap = createRoundedAlphaMap();

    let scene;
    let camera;
    let renderer;
    let clock;
    let raycaster;
    let pointerNDC;
    let goldLight;
    let cursorGlow;
    let cursorGlowMaterial;
    let magicCircle;
    let explosionSystem;
    let cherrySystem;
    let explosionMaterial;
    let cherryMaterial;
    let explosionLife = 0;
    let explosionStartedAt = -100;
    let sharedFaceGeometry;
    let sharedEdgeGeometry;
    let sharedEdgeMat;
    let sharedBackMat;
    let cards = [];
    let clowData = [];

    function createCardMesh(frontMaterial) {
        const group = new THREE.Group();

        const edge = new THREE.Mesh(sharedEdgeGeometry, sharedEdgeMat);
        edge.castShadow = false;
        edge.receiveShadow = false;

        const frontFace = new THREE.Mesh(sharedFaceGeometry, frontMaterial);
        frontFace.position.z = CARD_WORLD_DEPTH / 2 + 0.001;

        const backFace = new THREE.Mesh(sharedFaceGeometry, sharedBackMat);
        backFace.position.z = -CARD_WORLD_DEPTH / 2 - 0.001;
        backFace.rotation.y = Math.PI;

        group.add(edge, frontFace, backFace);
        group.userData.frontFace = frontFace;
        group.userData.backFace = backFace;
        group.userData.edge = edge;
        return group;
    }

    async function prepareAssets() {
        const backPromise = loadTexture(textureLoader, backSources(), "牌背");
        const cardPromises = CARD_FILES.map(async (file) => {
            const texture = await loadTexture(textureLoader, cardSources(file), file);
            return {
                name: `THE ${file.toUpperCase()}`,
                file,
                url: texture.userData.sourceUrl || `${ASSET_BASE}/cards/${file}.webp`,
                texture,
                material: new THREE.MeshStandardMaterial({
                    color: 0xffffff,
                    map: texture,
                    alphaMap: roundedAlphaMap,
                    alphaTest: 0.5,
                    roughness: 0.56,
                    metalness: 0.04,
                    emissive: 0x16060c,
                    emissiveIntensity: 0.08
                })
            };
        });

        const [backTexture, cardsLoaded] = await Promise.all([backPromise, Promise.all(cardPromises)]);
        return { backTexture, cardsLoaded };
    }

    function setupRenderer() {
        const viewport = viewportMetrics();
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x050308);

        const fov = quality.cards >= 18 ? 36 : 46;
        camera = new THREE.PerspectiveCamera(fov, viewport.aspect, 0.1, 1000);
        camera.position.set(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        renderer.setSize(viewport.width, viewport.height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
        renderer.outputEncoding = THREE.sRGBEncoding;
        document.body.appendChild(renderer.domElement);

        clock = new THREE.Clock();
        raycaster = new THREE.Raycaster();
        pointerNDC = new THREE.Vector2(-999, -999);
    }

    function setupLights() {
        scene.add(new THREE.AmbientLight(0xffffff, 0.68));

        const fill = new THREE.PointLight(0xa32946, 0.8, 25);
        fill.position.set(0, -2, -8);
        scene.add(fill);

        goldLight = new THREE.PointLight(0xffd27a, 1.25, 30, 1.7);
        goldLight.position.set(0, 1, 4);
        scene.add(goldLight);

        cursorGlowMaterial = new THREE.SpriteMaterial({
            map: createCursorGlowTexture(),
            color: 0xffd27a,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending
        });
        cursorGlow = new THREE.Sprite(cursorGlowMaterial);
        cursorGlow.position.set(0, 1, 2.2);
        cursorGlow.scale.set(2.2, 2.2, 1);
        cursorGlow.renderOrder = 6;
        cursorGlow.visible = false;
        scene.add(cursorGlow);
    }

    function setupStars() {
        const count = quality.label === "轻量" ? 220 : 420;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < positions.length; i += 3) {
            positions[i] = (Math.random() - 0.5) * 42;
            positions[i + 1] = (Math.random() - 0.5) * 26;
            positions[i + 2] = -10 - Math.random() * 45;
        }
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
            size: 0.045,
            color: 0xffcc66,
            transparent: true,
            opacity: 0.42,
            depthWrite: false
        });
        scene.add(new THREE.Points(geometry, material));
    }

    function createSoftParticleTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 58);
        gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
        gradient.addColorStop(0.28, "rgba(255, 220, 240, 0.86)");
        gradient.addColorStop(0.68, "rgba(255, 170, 210, 0.22)");
        gradient.addColorStop(1, "rgba(255, 170, 210, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 128, 128);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    function createCursorGlowTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 124);
        gradient.addColorStop(0, "rgba(255, 249, 224, 0.95)");
        gradient.addColorStop(0.18, "rgba(255, 214, 105, 0.72)");
        gradient.addColorStop(0.48, "rgba(255, 178, 38, 0.22)");
        gradient.addColorStop(1, "rgba(255, 178, 38, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = "rgba(255, 229, 146, 0.38)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(128, 128, 46, 0, Math.PI * 2);
        ctx.stroke();
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    function createPetalTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        ctx.translate(64, 64);
        ctx.rotate(-0.42);
        const gradient = ctx.createLinearGradient(-42, -20, 42, 20);
        gradient.addColorStop(0, "rgba(255, 245, 250, 0)");
        gradient.addColorStop(0.18, "rgba(255, 205, 226, 0.72)");
        gradient.addColorStop(0.62, "rgba(255, 151, 199, 0.9)");
        gradient.addColorStop(1, "rgba(255, 205, 226, 0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(-44, 0);
        ctx.bezierCurveTo(-24, -30, 24, -30, 45, -3);
        ctx.bezierCurveTo(22, 25, -22, 27, -44, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-30, 0);
        ctx.bezierCurveTo(-4, -5, 17, -3, 32, -1);
        ctx.stroke();
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        return texture;
    }

    function createNebulaTexture() {
        const canvas = document.createElement("canvas");
        canvas.width = 1024;
        canvas.height = 1024;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const washes = [
            { x: 0.36, y: 0.42, r: 0.42, c0: "rgba(168, 46, 82, 0.55)", c1: "rgba(168, 46, 82, 0)" },
            { x: 0.68, y: 0.34, r: 0.34, c0: "rgba(58, 74, 153, 0.40)", c1: "rgba(58, 74, 153, 0)" },
            { x: 0.54, y: 0.66, r: 0.30, c0: "rgba(255, 204, 102, 0.20)", c1: "rgba(255, 204, 102, 0)" }
        ];

        for (const wash of washes) {
            const gradient = ctx.createRadialGradient(
                canvas.width * wash.x,
                canvas.height * wash.y,
                0,
                canvas.width * wash.x,
                canvas.height * wash.y,
                canvas.width * wash.r
            );
            gradient.addColorStop(0, wash.c0);
            gradient.addColorStop(1, wash.c1);
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 90; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;
            const length = 40 + Math.random() * 120;
            const alpha = 0.035 + Math.random() * 0.055;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.random() * Math.PI);
            const gradient = ctx.createLinearGradient(-length / 2, 0, length / 2, 0);
            gradient.addColorStop(0, "rgba(255, 204, 102, 0)");
            gradient.addColorStop(0.5, `rgba(255, 204, 102, ${alpha})`);
            gradient.addColorStop(1, "rgba(255, 204, 102, 0)");
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1 + Math.random() * 1.5;
            ctx.beginPath();
            ctx.moveTo(-length / 2, 0);
            ctx.lineTo(length / 2, 0);
            ctx.stroke();
            ctx.restore();
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        return texture;
    }

    function setupNebula() {
        const texture = createNebulaTexture();
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: quality.label === "轻量" ? 0.55 : 0.72,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(74, 74), material);
        plane.position.set(0, 0, -46);
        scene.add(plane);

        const veilMat = new THREE.LineBasicMaterial({
            color: 0x8d6a99,
            transparent: true,
            opacity: 0.16,
            depthWrite: false
        });
        const points = [];
        for (let i = 0; i < 24; i++) {
            const a = Math.random() * Math.PI * 2;
            const b = a + 0.5 + Math.random() * 0.8;
            const r1 = 9 + Math.random() * 13;
            const r2 = r1 + 3 + Math.random() * 9;
            points.push(Math.cos(a) * r1, Math.sin(a) * r1, -18 - Math.random() * 18);
            points.push(Math.cos(b) * r2, Math.sin(b) * r2, -18 - Math.random() * 18);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        scene.add(new THREE.LineSegments(geo, veilMat));
    }

    function setupSakuraFall() {
        const count = quality.cherryParticles;
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        const phases = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const index = i * 3;
            positions[index] = (Math.random() - 0.5) * 34;
            positions[index + 1] = -11 + Math.random() * 24;
            positions[index + 2] = -8 - Math.random() * 30;
            speeds[i] = 0.22 + Math.random() * 0.46;
            phases[i] = Math.random() * Math.PI * 2;
            sizes[i] = quality.label === "高画质" ? 22 + Math.random() * 12 : 17 + Math.random() * 9;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aSpeed", new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        geometry.setDrawRange(0, quality.activeCherryParticles);

        cherryMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, quality.pixelRatio) }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        ,
            vertexShader: `
                attribute float aSpeed;
                attribute float aPhase;
                attribute float aSize;
                uniform float uTime;
                uniform float uPixelRatio;
                varying float vAlpha;
                varying float vTwist;
                void main() {
                    vec3 p = position;
                    p.y = mod(p.y - uTime * aSpeed + 12.0, 24.0) - 12.0;
                    p.x += sin(uTime * 0.72 + aPhase) * 0.34;
                    p.z += cos(uTime * 0.36 + aPhase) * 0.45;
                    vAlpha = 0.42 + 0.28 * sin(uTime * 1.2 + aPhase);
                    vTwist = aPhase + uTime * 0.7;
                    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = aSize * uPixelRatio * (12.0 / max(3.0, -mvPosition.z));
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vAlpha;
                varying float vTwist;
                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float c = cos(vTwist);
                    float s = sin(vTwist);
                    vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
                    float petal = smoothstep(0.44, 0.05, length(vec2(r.x * 1.55, r.y * 3.0)));
                    float notch = smoothstep(0.18, 0.42, r.x + 0.28);
                    float alpha = petal * notch * vAlpha;
                    vec3 color = mix(vec3(1.0, 0.66, 0.84), vec3(1.0, 0.88, 0.95), petal);
                    gl_FragColor = vec4(color, alpha);
                }
            `
        });

        cherrySystem = new THREE.Points(geometry, cherryMaterial);
        cherrySystem.frustumCulled = false;
        scene.add(cherrySystem);
    }

    function setupMagicCircle() {
        magicCircle = new THREE.Group();
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xffcc66,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const lineMat = new THREE.LineBasicMaterial({
            color: 0xffcc66,
            transparent: true,
            opacity: 0.28,
            depthWrite: false
        });

        [5.5, 6.25, 6.85].forEach((radius) => {
            const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.018, radius + 0.018, 128), ringMat);
            magicCircle.add(ring);
        });

        const points = [];
        const spokes = 18;
        for (let i = 0; i < spokes; i++) {
            const angle = (Math.PI * 2 * i) / spokes;
            points.push(Math.cos(angle) * 1.3, Math.sin(angle) * 1.3, 0);
            points.push(Math.cos(angle) * 6.6, Math.sin(angle) * 6.6, 0);
        }
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
            const b = a + Math.PI * 2 / 3;
            points.push(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0);
            points.push(Math.cos(b) * 4.5, Math.sin(b) * 4.5, 0);
        }

        const lineGeo = new THREE.BufferGeometry();
        lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
        magicCircle.add(new THREE.LineSegments(lineGeo, lineMat));
        magicCircle.position.z = -10.5;
        scene.add(magicCircle);
    }

    function setupCards(backTexture, cardsLoaded) {
        clowData = cardsLoaded;
        sharedFaceGeometry = new THREE.PlaneGeometry(CARD_WORLD_WIDTH, CARD_WORLD_HEIGHT);
        sharedEdgeGeometry = createRoundedEdgeGeometry(
            CARD_WORLD_WIDTH,
            CARD_WORLD_HEIGHT,
            CARD_WORLD_DEPTH,
            CARD_CORNER_RADIUS,
            CARD_EDGE_SEGMENTS
        );
        sharedEdgeMat = new THREE.MeshStandardMaterial({
            color: 0xf2bdc8,
            vertexColors: true,
            roughness: 0.74,
            metalness: 0.04,
            emissive: 0x0c0306,
            emissiveIntensity: 0.04
        });
        sharedBackMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: backTexture,
            alphaMap: roundedAlphaMap,
            alphaTest: 0.5,
            roughness: 0.52,
            metalness: 0.05,
            emissive: 0x17070d,
            emissiveIntensity: 0.07
        });

        cards = [];
        for (let i = 0; i < quality.cards; i++) {
            const mesh = createCardMesh(sharedBackMat);
            scene.add(mesh);
            cards.push({
                mesh,
                frontFace: mesh.userData.frontFace,
                backFace: mesh.userData.backFace,
                edge: mesh.userData.edge,
                data: null,
                index: i,
                targetScaleX: quality.cardScale,
                targetScaleY: quality.cardScale,
                targetScaleZ: quality.cardScale,
                currentScaleX: quality.cardScale,
                currentScaleY: quality.cardScale,
                currentScaleZ: quality.cardScale,
                targetX: 0,
                targetY: 0,
                targetZ: 0,
                targetRotX: 0,
                targetRotY: 0,
                revealUntil: 0,
                state: "IDLE"
            });
        }
    }

    function prewarmRenderResources() {
        if (!renderer) {
            return;
        }
        const textures = [sharedBackMat.map, roundedAlphaMap, ...clowData.map((card) => card.texture)];
        for (const texture of textures) {
            if (texture && renderer.initTexture) {
                renderer.initTexture(texture);
            }
        }

        const prewarmMesh = createCardMesh(sharedBackMat);
        prewarmMesh.frustumCulled = false;
        prewarmMesh.position.set(999, 999, -10);
        scene.add(prewarmMesh);
        for (const card of clowData) {
            prewarmMesh.userData.frontFace.material = card.material;
            renderer.compile(scene, camera);
        }
        scene.remove(prewarmMesh);

        if (explosionSystem && explosionMaterial) {
            const wasVisible = explosionSystem.visible;
            explosionSystem.visible = true;
            explosionSystem.geometry.setDrawRange(0, Math.min(quality.activeParticles, 32));
            explosionMaterial.uniforms.uStartTime.value = -10;
            explosionMaterial.uniforms.uTime.value = 0;
            renderer.compile(scene, camera);
            renderer.render(scene, camera);
            explosionSystem.geometry.setDrawRange(0, quality.activeParticles);
            explosionSystem.visible = wasVisible;
        }
        renderer.compile(scene, camera);
    }

    function setupExplosion() {
        const count = quality.particles;
        const geometry = new THREE.BufferGeometry();
        const offsets = new Float32Array(count * 3);
        const velocities = new Float32Array(count * 3);
        const phases = new Float32Array(count);
        const kinds = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const index = i * 3;
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random());
            const isGold = i % 5 === 0 || Math.random() > 0.68;
            const speed = isGold ? 1.45 + Math.random() * 1.25 : 0.75 + Math.random() * 1.1;
            offsets[index] = (Math.random() - 0.5) * 1.2;
            offsets[index + 1] = (Math.random() - 0.5) * 2.6;
            offsets[index + 2] = (Math.random() - 0.5) * 0.16;
            velocities[index] = Math.cos(angle) * radius * speed;
            velocities[index + 1] = Math.sin(angle) * radius * speed * 0.72 + (isGold ? 0.32 : -0.06);
            velocities[index + 2] = (Math.random() - 0.5) * 1.15;
            phases[i] = Math.random() * Math.PI * 2;
            kinds[i] = isGold ? 1 : 0;
            sizes[i] = isGold ? 30 + Math.random() * 22 : 24 + Math.random() * 18;
        }

        geometry.setAttribute("position", new THREE.BufferAttribute(offsets, 3));
        geometry.setAttribute("aVelocity", new THREE.BufferAttribute(velocities, 3));
        geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
        geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
        geometry.setDrawRange(0, quality.activeParticles);

        explosionMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uStartTime: { value: -100 },
                uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, quality.pixelRatio) }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            vertexShader: `
                attribute vec3 aVelocity;
                attribute float aPhase;
                attribute float aKind;
                attribute float aSize;
                uniform float uTime;
                uniform float uStartTime;
                uniform float uPixelRatio;
                varying float vLife;
                varying float vKind;
                varying float vPhase;
                void main() {
                    float t = max(0.0, uTime - uStartTime);
                    vLife = clamp(1.0 - t / 1.18, 0.0, 1.0);
                    vKind = aKind;
                    vPhase = aPhase + t * 5.0;
                    vec3 p = position + aVelocity * t;
                    p.y -= t * t * 0.38;
                    p.x += sin(aPhase + t * 4.0) * 0.08 * (1.0 - aKind);
                    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
                    gl_PointSize = aSize * uPixelRatio * vLife * (10.0 / max(3.0, -mvPosition.z));
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying float vLife;
                varying float vKind;
                varying float vPhase;
                void main() {
                    vec2 uv = gl_PointCoord - 0.5;
                    float roundGlow = smoothstep(0.5, 0.03, length(uv));
                    float c = cos(vPhase);
                    float s = sin(vPhase);
                    vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
                    float petal = smoothstep(0.42, 0.05, length(vec2(r.x * 1.45, r.y * 3.15)));
                    float star = max(
                        smoothstep(0.11, 0.02, abs(uv.x)) * smoothstep(0.48, 0.02, abs(uv.y)),
                        smoothstep(0.11, 0.02, abs(uv.y)) * smoothstep(0.48, 0.02, abs(uv.x))
                    );
                    float shape = mix(max(roundGlow, petal * 0.88), max(star, roundGlow * 0.55), vKind);
                    vec3 pink = vec3(1.0, 0.50, 0.74);
                    vec3 gold = vec3(1.0, 0.82, 0.34);
                    vec3 color = mix(pink, gold, vKind);
                    float alpha = shape * vLife * vLife;
                    gl_FragColor = vec4(color, alpha);
                }
            `
        });

        explosionSystem = new THREE.Points(geometry, explosionMaterial);
        explosionSystem.frustumCulled = false;
        explosionSystem.visible = false;
        scene.add(explosionSystem);
    }

    function addHistoryCard(cardData) {
        const miniCard = document.createElement("div");
        miniCard.className = "history-card";
        miniCard.title = cardData.name;
        miniCard.style.backgroundImage = `url("${cardData.url}")`;
        dom.historyTray.appendChild(miniCard);
        while (dom.historyTray.children.length > 4) {
            dom.historyTray.removeChild(dom.historyTray.firstChild);
        }
    }

    function explodeCard(cardObj) {
        if (!cardObj.data) {
            return;
        }

        const now = performance.now();
        if (state.lastReleaseAt) {
            state.lastExplosionDelayMs = Math.max(0, Math.round(now - state.lastReleaseAt));
        }
        state.revealLightUntil = Math.max(state.revealLightUntil, now + RELEASE_BURST_LIGHT_MS * 0.65);

        const releasedCard = cardObj.data;
        setStatus(`${cardObj.data.name} 已释放`);
        cardObj.mesh.visible = false;

        const pos = new THREE.Vector3();
        cardObj.mesh.getWorldPosition(pos);

        explosionSystem.position.copy(pos);
        explosionSystem.geometry.setDrawRange(0, quality.activeParticles);
        explosionStartedAt = now * 0.001;
        explosionMaterial.uniforms.uStartTime.value = explosionStartedAt;
        explosionMaterial.uniforms.uTime.value = explosionStartedAt;
        explosionSystem.visible = true;
        explosionLife = 1.18;

        window.setTimeout(() => scheduleIdle(() => addHistoryCard(releasedCard), 700), 250);

        window.setTimeout(() => {
            cardObj.data = null;
            cardObj.frontFace.material = sharedBackMat;
            cardObj.mesh.position.y = -10;
            cardObj.mesh.visible = true;
            cardObj.state = "IDLE";
        }, 980);
    }

    function startReveal(cardObj) {
        if (cardObj.state !== "GRABBED") {
            return;
        }
        const now = performance.now();
        cardObj.state = "REVEALED";
        cardObj.revealUntil = now + 360;
        state.lastReleaseAt = now;
        state.revealLightUntil = now + RELEASE_BURST_LIGHT_MS;
        setStatus(`${cardObj.data.name} 显现中`);
        window.requestAnimationFrame(() => explodeCard(cardObj));
    }

    function grabCard(card) {
        const randomCard = clowData[Math.floor(Math.random() * clowData.length)];
        card.data = randomCard;
        card.frontFace.material = randomCard.material;
        card.state = "GRABBED";
        card.targetScaleX = quality.grabScale;
        card.targetScaleY = quality.grabScale;
        card.targetScaleZ = quality.grabScale;
        state.activeCard = card;
        setStatus(`${randomCard.name} 被抽取，松开释放`);
    }

    function tryGrabCard() {
        if (state.activeCard || !raycaster || !camera) {
            return;
        }

        raycaster.setFromCamera(pointerNDC, camera);
        let nearestHandCard = null;
        let nearestHandDistance = Infinity;
        const projected = new THREE.Vector3();
        for (const card of cards) {
            if (card.state !== "IDLE" || !card.mesh.visible) {
                continue;
            }
            const intersects = raycaster.intersectObject(card.mesh, true);
            if (intersects.length) {
                grabCard(card);
                return;
            }

            if (state.currentInputSource === "hand") {
                projected.copy(card.mesh.position).project(camera);
                const distance = Math.hypot(projected.x - pointerNDC.x, projected.y - pointerNDC.y);
                if (distance < nearestHandDistance) {
                    nearestHandDistance = distance;
                    nearestHandCard = card;
                }
            }
        }

        if (nearestHandCard && nearestHandDistance < 0.56) {
            grabCard(nearestHandCard);
        }
    }

    function processInput(rawX, rawY, isActionDown, source) {
        state.currentInputSource = source;
        dom.cursorRing.classList.toggle("is-touch", source === "touch");
        const viewport = viewportMetrics();

        const easing = source === "hand" ? 0.38 : 0.42;
        state.cursorX += (rawX - state.cursorX) * easing;
        state.cursorY += (rawY - state.cursorY) * easing;

        dom.cursorRing.style.left = `${state.cursorX}px`;
        dom.cursorRing.style.top = `${state.cursorY}px`;

        pointerNDC.x = (state.cursorX / viewport.width) * 2 - 1;
        pointerNDC.y = -(state.cursorY / viewport.height) * 2 + 1;

        if (state.loadState !== "PLAYING") {
            state.wasActionDown = isActionDown;
            return;
        }

        const shouldRotate =
            (source === "hand" && !isActionDown) ||
            (source === "mouse" && !isActionDown) ||
            ((source === "mouse" || source === "touch") && isActionDown && !state.activeCard);

        if (shouldRotate && state.lastPointerX !== null && !state.activeCard) {
            state.angularVelocity += (pointerNDC.x - state.lastPointerX) * (source === "touch" ? 0.42 : 0.28);
        }

        if (isActionDown && !state.wasActionDown) {
            dom.cursorRing.classList.add("pinched");
            tryGrabCard();
        } else if (!isActionDown && state.wasActionDown) {
            dom.cursorRing.classList.remove("pinched");
            if (state.activeCard) {
                startReveal(state.activeCard);
                state.activeCard = null;
            }
        }

        state.wasActionDown = isActionDown;
        state.lastPointerX = pointerNDC.x;
    }

    function setupPointerInput() {
        window.addEventListener("pointerdown", (event) => {
            if (event.target.closest("button")) {
                return;
            }
            if (state.pointerId !== null) {
                return;
            }
            state.pointerId = event.pointerId;
            state.pointerDown = true;
            event.preventDefault();
            processInput(event.clientX, event.clientY, true, event.pointerType === "touch" ? "touch" : "mouse");
        }, { passive: false });

        window.addEventListener("pointermove", (event) => {
            if (state.loadState !== "PLAYING" && event.target.closest("button")) {
                return;
            }
            if (state.pointerId !== null && event.pointerId !== state.pointerId) {
                return;
            }
            processInput(event.clientX, event.clientY, state.pointerDown, event.pointerType === "touch" ? "touch" : "mouse");
        }, { passive: false });

        const endPointer = (event) => {
            if (state.pointerId !== null && event.pointerId !== state.pointerId) {
                return;
            }
            state.pointerDown = false;
            state.pointerId = null;
            processInput(event.clientX, event.clientY, false, event.pointerType === "touch" ? "touch" : "mouse");
            state.lastPointerX = null;
        };

        window.addEventListener("pointerup", endPointer, { passive: false });
        window.addEventListener("pointercancel", endPointer, { passive: false });
    }

    function landmarkDistance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function averageLandmark(landmarks, indexes) {
        const point = { x: 0, y: 0, z: 0 };
        for (const index of indexes) {
            point.x += landmarks[index].x;
            point.y += landmarks[index].y;
            point.z += landmarks[index].z || 0;
        }
        point.x /= indexes.length;
        point.y /= indexes.length;
        point.z /= indexes.length;
        return point;
    }

    function fingerPoseSummary(landmarks) {
        const fingerPairs = [
            [8, 6, 5],
            [12, 10, 9],
            [16, 14, 13],
            [20, 18, 17]
        ];
        const wrist = landmarks[0];
        const palmSpan = Math.max(
            landmarkDistance(landmarks[5], landmarks[17]),
            landmarkDistance(wrist, landmarks[9]),
            0.001
        );
        let folded = 0;
        let extended = 0;
        for (const [tip, pip, mcp] of fingerPairs) {
            const tipPoint = landmarks[tip];
            const pipPoint = landmarks[pip];
            const mcpPoint = landmarks[mcp];
            const tipToWrist = landmarkDistance(tipPoint, wrist);
            const pipToWrist = landmarkDistance(pipPoint, wrist);
            const mcpToWrist = landmarkDistance(mcpPoint, wrist);
            const extensionRatio = tipToWrist / Math.max(pipToWrist, 0.001);
            const foldedByDistance = extensionRatio < 0.98 || tipToWrist < mcpToWrist + palmSpan * 0.28;
            const extendedByDistance = extensionRatio > 1.08 && tipToWrist > mcpToWrist + palmSpan * 0.40;

            if (foldedByDistance || tipPoint.y > pipPoint.y + 0.018) {
                folded += 1;
            } else if (extendedByDistance || tipPoint.y < pipPoint.y - 0.018) {
                extended += 1;
            }
        }
        return { folded, extended };
    }

    function updateHandAction(landmarks, gesture, now) {
        const label = String(gesture || "").toLowerCase();
        const pinchDist = landmarkDistance(landmarks[8], landmarks[4]);
        const palmSpan = Math.max(
            landmarkDistance(landmarks[5], landmarks[17]),
            landmarkDistance(landmarks[0], landmarks[9]),
            0.001
        );
        const pinchRatio = pinchDist / palmSpan;
        const pose = fingerPoseSummary(landmarks);
        let targetScore = state.handActionScore;
        let smoothing = 0.28;

        if (label.includes("closed_fist")) {
            targetScore = 1;
            smoothing = 0.52;
        } else if (label.includes("open_palm")) {
            targetScore = 0;
            smoothing = 0.52;
        } else if (pose.folded >= 3 || pinchRatio < 0.30) {
            targetScore = 1;
            smoothing = 0.38;
        } else if (pose.extended >= 3 && pinchRatio > 0.36) {
            targetScore = 0;
            smoothing = 0.38;
        }

        state.handActionScore += (targetScore - state.handActionScore) * smoothing;
        if (!state.isHandPinching && state.handActionScore > 0.62 && now - state.lastHandActionAt > HAND_ACTION_DEBOUNCE_MS) {
            state.isHandPinching = true;
            state.lastHandActionAt = now;
        } else if (state.isHandPinching && state.handActionScore < 0.38 && now - state.lastHandActionAt > HAND_ACTION_DEBOUNCE_MS) {
            state.isHandPinching = false;
            state.lastHandActionAt = now;
        }

        return {
            isActionDown: state.isHandPinching,
            pinchRatio,
            folded: pose.folded,
            extended: pose.extended
        };
    }

    function handCursorPoint(landmarks, isActionDown) {
        const indexTip = landmarks[8];
        if (!isActionDown) {
            return indexTip;
        }

        const palmCenter = averageLandmark(landmarks, [0, 5, 9, 13, 17]);
        return {
            x: indexTip.x * 0.45 + palmCenter.x * 0.55,
            y: indexTip.y * 0.45 + palmCenter.y * 0.55,
            z: (indexTip.z || 0) * 0.45 + (palmCenter.z || 0) * 0.55
        };
    }

    function ensureWebcamOverlayCanvas() {
        const canvas = dom.webcamOverlay;
        if (!canvas) {
            return null;
        }

        const width = Math.max(1, Math.round(canvas.clientWidth || dom.webcamWrap.clientWidth || 1));
        const height = Math.max(1, Math.round(canvas.clientHeight || dom.webcamWrap.clientHeight || 1));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            state.webcamOverlayCtx = null;
        }
        if (!state.webcamOverlayCtx) {
            state.webcamOverlayCtx = canvas.getContext("2d", { alpha: true, desynchronized: true });
        }
        return state.webcamOverlayCtx;
    }

    function clearWebcamOverlay() {
        const ctx = ensureWebcamOverlayCanvas();
        if (!ctx) {
            return;
        }
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    function drawHandOverlay(landmarks, action) {
        const ctx = ensureWebcamOverlayCanvas();
        if (!ctx) {
            return;
        }
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (!landmarks || landmarks.length < 21) {
            return;
        }

        const width = ctx.canvas.width;
        const height = ctx.canvas.height;
        const active = action && action.isActionDown;
        const lineColor = active ? "rgba(255, 96, 138, 0.95)" : "rgba(96, 255, 210, 0.95)";
        const jointColor = active ? "rgba(255, 226, 147, 0.98)" : "rgba(255, 255, 255, 0.96)";

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3;
        ctx.strokeStyle = lineColor;
        for (const [start, end] of HAND_CONNECTIONS) {
            const a = landmarks[start];
            const b = landmarks[end];
            if (!a || !b) {
                continue;
            }
            ctx.beginPath();
            ctx.moveTo(a.x * width, a.y * height);
            ctx.lineTo(b.x * width, b.y * height);
            ctx.stroke();
        }

        ctx.fillStyle = jointColor;
        ctx.strokeStyle = "rgba(5, 4, 10, 0.72)";
        ctx.lineWidth = 1.5;
        for (const point of landmarks) {
            ctx.beginPath();
            ctx.arc(point.x * width, point.y * height, 3.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    function gestureDebugText(label, payload) {
        const hands = payload && payload.hands ? payload.hands : 0;
        const infer = payload && payload.inferenceMs ? Math.round(payload.inferenceMs) : Math.round(state.lastHandProcessTime || 0);
        const age = state.lastGestureResultAt ? Math.round(performance.now() - state.lastGestureResultAt) : 0;
        const debug = `hand=${hands} infer=${infer}ms age=${age}ms`;
        dom.gestureStatus.title = debug;
        return `${label} ${debug}`;
    }

    function releaseLostHand() {
        pointerNDC.set(-999, -999);
        dom.cursorRing.style.left = "-100px";
        state.lastPointerX = null;
        if (state.wasActionDown) {
            processInput(state.cursorX, state.cursorY, false, "hand");
        }
        state.isHandPinching = false;
        state.handActionScore = 0;
        clearWebcamOverlay();
    }

    function onGestureResult(payload) {
        state.lastGestureResultAt = performance.now();
        state.lastHandProcessTime = payload.inferenceMs || 0;

        if (payload.hands && payload.landmarks && payload.landmarks.length > 17) {
            state.handLostFrames = 0;
            state.lastHandSeenAt = performance.now();
            const landmarks = payload.landmarks;
            const action = updateHandAction(landmarks, payload.gesture, state.lastGestureResultAt);
            drawHandOverlay(landmarks, action);
            const cursorPoint = handCursorPoint(landmarks, action.isActionDown);
            const viewport = viewportMetrics();
            const rawX = (1 - cursorPoint.x) * viewport.width;
            const rawY = cursorPoint.y * viewport.height;

            setGestureStatus(
                gestureDebugText(state.isHandPinching ? "捏合中" : "识别到手", payload),
                state.isHandPinching ? "active" : "ready"
            );
            processInput(rawX, rawY, state.isHandPinching, "hand");
            return;
        }

        state.handLostFrames += 1;
        if (state.handLostFrames > 1) {
            clearWebcamOverlay();
        }
        setGestureStatus(gestureDebugText("未识别", payload), "warn");
        if (state.handLostFrames > 3 && state.currentInputSource === "hand") {
            releaseLostHand();
        }
    }

    function cameraFailureMessage(error) {
        if (window.location.protocol === "file:") {
            return "摄像头需要 HTTPS 或 http://127.0.0.1 本地服务，不能从 file:// 直接调用。";
        }
        if (!window.isSecureContext) {
            return "摄像头需要 HTTPS 或 http://127.0.0.1 本地服务，不能从 file:// 直接调用。";
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return "当前浏览器不支持摄像头 API，请换用新版 Chrome 或 Edge。";
        }
        if (!error) {
            return "摄像头初始化失败，请检查浏览器权限和设备占用。";
        }
        if (error.name === "NotAllowedError" || error.name === "SecurityError") {
            return "摄像头权限被拒绝，请在地址栏权限设置里允许摄像头。";
        }
        if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
            return "没有找到可用摄像头。";
        }
        if (error.name === "NotReadableError" || error.name === "TrackStartError") {
            return "摄像头正被其他程序占用，请关闭占用摄像头的软件后重试。";
        }
        return `摄像头初始化失败：${error.message || error.name || "未知错误"}`;
    }

    function stopHandStream() {
        if (state.gestureTimerId) {
            window.clearTimeout(state.gestureTimerId);
            state.gestureTimerId = null;
        }
        if (state.gestureVideoCallbackId !== null && dom.webcam.cancelVideoFrameCallback) {
            try {
                dom.webcam.cancelVideoFrameCallback(state.gestureVideoCallbackId);
            } catch (error) {
                reportStage("gesture:frame", error, "log");
            }
            state.gestureVideoCallbackId = null;
        }
        if (state.gestureWorker) {
            state.gestureWorker.terminate();
            state.gestureWorker = null;
        }
        if (state.handStream) {
            state.handStream.getTracks().forEach((track) => track.stop());
            state.handStream = null;
        }
        dom.webcam.srcObject = null;
        clearWebcamOverlay();
        dom.webcamWrap.hidden = true;
        state.handModeStarted = false;
        state.gestureWorkerReady = false;
        state.gestureWorkerLoading = false;
        state.gestureWarmupStarted = false;
        state.gestureReadyPromise = null;
        state.gestureReadyResolve = null;
        state.gestureReadyReject = null;
        state.gestureFramePending = false;
        state.gestureFrameCreating = false;
        state.handModelLoading = false;
        state.handFrameInterval = state.gestureTargetInterval;
        state.handLostFrames = 0;
        releaseLostHand();
        setGestureStatus("手势待机", "idle", true);
    }

    async function waitForVideoReady(video) {
        if (video.readyState >= 2) {
            return;
        }
        await new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error("摄像头画面加载超时")), 7000);
            video.onloadedmetadata = () => {
                window.clearTimeout(timer);
                resolve();
            };
        });
    }

    function setupHandInputCanvas() {
        if (!state.handCanvas) {
            state.handCanvas = document.createElement("canvas");
            state.handCtx = state.handCanvas.getContext("2d", { alpha: false, desynchronized: true });
        }
        state.handCanvas.width = state.gestureSampleWidth;
        state.handCanvas.height = state.gestureSampleHeight;
    }

    function applyCameraPerformanceProfile(reason) {
        const coarse = window.matchMedia("(pointer: coarse)").matches;
        quality.activeCherryParticles = Math.max(160, Math.min(quality.activeCherryParticles, Math.floor(quality.cherryParticles * 0.55)));
        quality.activeParticles = Math.max(150, Math.min(quality.activeParticles, Math.floor(quality.particles * 0.62)));
        quality.activeCards = Math.max(8, Math.min(quality.activeCards, coarse ? 12 : 14));
        quality.pixelRatio = Math.min(quality.pixelRatio, coarse ? 1.0 : 1.2);
        applyResponsiveCardLayout();
        resize();
        reportStage("webgl:perf", `camera profile ${reason || "start"}: cards=${quality.activeCards}, cherry=${quality.activeCherryParticles}, burst=${quality.activeParticles}, pr=${quality.pixelRatio}`, "log");
    }

    async function createGestureBitmap() {
        if (window.createImageBitmap) {
            try {
                return await createImageBitmap(dom.webcam, {
                    resizeWidth: state.gestureSampleWidth,
                    resizeHeight: state.gestureSampleHeight,
                    resizeQuality: "low"
                });
            } catch (error) {
                reportStage("gesture:frame", `createImageBitmap(video) fallback: ${error.message || error.name}`, "log");
            }
        }

        setupHandInputCanvas();
        state.handCtx.drawImage(dom.webcam, 0, 0, state.handCanvas.width, state.handCanvas.height);
        if (!window.createImageBitmap) {
            throw new Error("当前浏览器不支持 createImageBitmap，无法高效运行手势识别");
        }
        return createImageBitmap(state.handCanvas);
    }

    function updateGesturePerformance(inferenceMs) {
        if (inferenceMs > 78) {
            state.handSlowFrames += 1;
            state.handFrameInterval = Math.min(180, state.handFrameInterval + 14);
            setGestureStatus(gestureDebugText("识别降频", { hands: 1, inferenceMs }), "warn");
            reportStage("gesture:frame", `slow ${Math.round(inferenceMs)}ms, interval ${state.handFrameInterval}ms`, "log");
            if (state.handSlowFrames >= 2 && state.gestureSampleWidth > HAND_MIN_SAMPLE_WIDTH) {
                state.gestureSampleWidth = HAND_MIN_SAMPLE_WIDTH;
                state.gestureSampleHeight = HAND_MIN_SAMPLE_HEIGHT;
                setupHandInputCanvas();
                applyCameraPerformanceProfile("gesture slow");
            }
        } else if (inferenceMs < 46 && state.handFrameInterval > state.gestureTargetInterval) {
            state.handSlowFrames = Math.max(0, state.handSlowFrames - 1);
            state.handFrameInterval = Math.max(state.gestureTargetInterval, state.handFrameInterval - 6);
        }
    }

    function scheduleGestureLoop() {
        if (!state.handModeStarted || !state.gestureWorkerReady) {
            return;
        }
        if (state.gestureTimerId || state.gestureVideoCallbackId !== null) {
            return;
        }

        if (dom.webcam.requestVideoFrameCallback) {
            state.gestureVideoCallbackId = dom.webcam.requestVideoFrameCallback(() => {
                state.gestureVideoCallbackId = null;
                maybeSendGestureFrame();
                scheduleGestureLoop();
            });
            return;
        }

        state.gestureTimerId = window.setTimeout(() => {
            state.gestureTimerId = null;
            maybeSendGestureFrame();
            scheduleGestureLoop();
        }, 33);
    }

    async function maybeSendGestureFrame() {
        if (!state.handModeStarted || !state.gestureWorkerReady || !state.gestureWorker || dom.webcam.readyState < 2) {
            return;
        }
        if (state.gestureFramePending || state.gestureFrameCreating) {
            return;
        }

        const now = performance.now();
        if (now - state.lastGestureFrameAt < state.handFrameInterval) {
            return;
        }

        state.gestureFrameCreating = true;
        try {
            const bitmap = await createGestureBitmap();
            state.gestureFramePending = true;
            state.lastGestureFrameAt = now;
            state.gestureWorker.postMessage({
                type: "frame",
                frameId: ++state.gestureFrameId,
                timestamp: now,
                bitmap
            }, [bitmap]);
        } catch (error) {
            state.handFrameTimeouts += 1;
            state.handFrameInterval = Math.min(180, state.handFrameInterval + 18);
            setGestureStatus("识别中断", "warn", true);
            reportStage("gesture:frame", error);
        } finally {
            state.gestureFrameCreating = false;
        }
    }

    function failGestureInitialization(error) {
        const reject = state.gestureReadyReject;
        if (state.gestureWorker) {
            state.gestureWorker.terminate();
            state.gestureWorker = null;
        }
        state.gestureWorkerReady = false;
        state.gestureWorkerLoading = false;
        state.gestureWarmupStarted = false;
        state.gestureReadyPromise = null;
        state.gestureReadyResolve = null;
        state.gestureReadyReject = null;
        state.gestureFramePending = false;
        if (reject) {
            reject(error);
        }
    }

    function handleGestureWorkerMessage(event) {
        const data = event.data || {};
        if (data.type === "ready") {
            state.gestureWorkerReady = true;
            state.gestureWorkerLoading = false;
            setGestureStatus("等待手 hand=0 infer=0ms age=0ms", "ready", true);
            reportStage("gesture:init", "MediaPipe GestureRecognizer ready", "log");
            if (state.gestureReadyResolve) {
                state.gestureReadyResolve(true);
            }
            scheduleGestureLoop();
            return;
        }

        if (data.type === "error") {
            const error = new Error(data.message || "手势识别失败");
            error.name = data.name || "GestureError";
            reportStage(data.stage || "gesture:worker", error);
            state.gestureFramePending = false;
            if ((data.stage || "").includes("init")) {
                setGestureStatus("模型失败", "warn", true);
                failGestureInitialization(error);
            }
            return;
        }

        if (data.type === "result") {
            state.gestureFramePending = false;
            updateGesturePerformance(data.inferenceMs || 0);
            onGestureResult(data);
        }
    }

    function initializeGestureWorker() {
        if (state.gestureWorkerReady) {
            return Promise.resolve(true);
        }
        if (state.gestureReadyPromise) {
            return state.gestureReadyPromise;
        }
        if (!window.Worker) {
            return Promise.reject(new Error("当前浏览器不支持 Web Worker，无法稳定运行手势识别"));
        }

        state.gestureWorkerLoading = true;
        state.gestureReadyPromise = new Promise((resolve, reject) => {
            state.gestureReadyResolve = resolve;
            state.gestureReadyReject = reject;
        });
        setGestureStatus("模型加载 hand=0 infer=0ms age=0ms", "ready", true);

        try {
            const worker = new Worker(GESTURE_WORKER_URL, { name: "clow-gesture-worker" });
            worker.onmessage = handleGestureWorkerMessage;
            worker.onerror = (event) => {
                const error = new Error(event.message || "Gesture worker crashed");
                reportStage("gesture:worker", error);
                setGestureStatus("识别崩溃", "warn", true);
                failGestureInitialization(error);
            };
            state.gestureWorker = worker;
            worker.postMessage({
                type: "init",
                visionBundleUrl: new URL(`${TASKS_BASE}/vision_bundle.js`, window.location.href).href,
                wasmBaseUrl: new URL(`${TASKS_BASE}/wasm`, window.location.href).href,
                modelUrl: new URL(`${TASKS_BASE}/gesture_recognizer.task`, window.location.href).href
            });
        } catch (error) {
            state.gestureWorkerLoading = false;
            state.gestureReadyPromise = null;
            reportStage("gesture:init", error);
            return Promise.reject(error);
        }

        return state.gestureReadyPromise;
    }

    function warmGestureWorker() {
        if (state.gestureWarmupStarted || state.gestureWorkerReady || state.gestureWorkerLoading) {
            return;
        }
        if (!window.Worker || window.location.protocol === "file:") {
            return;
        }

        state.gestureWarmupStarted = true;
        scheduleIdle(() => {
            if (state.gestureWorkerReady || state.gestureWorkerLoading || state.handModeStarted || state.loadState !== "READY") {
                return;
            }
            initializeGestureWorker().catch((error) => {
                reportStage("gesture:warmup", error, "log");
            });
        }, 700);
    }

    async function startGestureMode() {
        if (state.handModeStarted) {
            return true;
        }

        dom.gestureToggle.disabled = true;
        dom.gestureStartButton.disabled = true;
        setStatus("正在检查摄像头环境");

        try {
            if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error(cameraFailureMessage());
            }

            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const permission = await navigator.permissions.query({ name: "camera" });
                    if (permission.state === "denied") {
                        throw Object.assign(new Error("camera denied"), { name: "NotAllowedError" });
                    }
                } catch (error) {
                    if (error.name === "NotAllowedError") {
                        throw error;
                    }
                }
            }

            setStatus("正在请求摄像头权限");
            const workerReady = initializeGestureWorker().catch((error) => error);
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    facingMode: "user",
                    width: { ideal: 424 },
                    height: { ideal: 320 },
                    frameRate: { ideal: 24, max: 24 }
                }
            });

            state.handStream = stream;
            dom.webcam.srcObject = stream;
            dom.webcamWrap.hidden = false;
            await waitForVideoReady(dom.webcam);
            await dom.webcam.play();

            state.handModeStarted = true;
            state.lastGestureFrameAt = 0;
            setupHandInputCanvas();
            clearWebcamOverlay();
            applyCameraPerformanceProfile("gesture start");
            dom.gestureToggle.classList.add("is-active");
            dom.gestureToggle.textContent = "手势中";
            setGestureStatus("摄像头已开", "ready", true);
            setStatus("摄像头已开启，正在加载手势识别模型");
            const workerResult = await workerReady;
            if (workerResult instanceof Error) {
                throw workerResult;
            }
            scheduleGestureLoop();
            void maybeSendGestureFrame();
            setStatus("手势识别已就绪：移动食指旋转，捏合抽取，松开释放牌灵");
            return true;
        } catch (error) {
            const stage = state.handModeStarted ? "gesture:init" : "camera:getUserMedia";
            reportStage(stage, error);
            stopHandStream();
            const message = error.message && error.message.includes("摄像头")
                ? error.message
                : state.handModeStarted
                    ? `手势识别初始化失败：${error.message || error.name || "未知错误"}`
                    : cameraFailureMessage(error);
            setStatus(message, "warn");
            dom.gestureToggle.textContent = "手势";
            return false;
        } finally {
            dom.gestureToggle.disabled = false;
            dom.gestureStartButton.disabled = false;
        }
    }

    function requestStart() {
        if (state.loadState !== "READY") {
            return;
        }

        state.loadState = "PLAYING";
        dom.loadingScreen.classList.add("is-hidden");
        dom.statusText.hidden = false;
        dom.modePanel.hidden = false;
        if (state.handModeStarted) {
            setStatus("手势模式：移动食指旋转，捏合抽取，松开释放牌灵");
        } else {
            setStatus("滑动旋转牌阵，点按抽取，松开释放牌灵");
        }

        window.setTimeout(() => {
            dom.loadingScreen.hidden = true;
        }, 720);
    }

    async function requestGestureStart() {
        if (state.loadState !== "READY") {
            return;
        }

        dom.gestureStartButton.disabled = true;
        dom.touchStartButton.disabled = true;
        const ok = await startGestureMode();
        if (ok) {
            requestStart();
        } else {
            dom.touchStartButton.disabled = false;
            dom.gestureStartButton.disabled = false;
        }
    }

    function fitCardScaleToViewport(baseScale, targetZ, fill = 0.78) {
        if (!camera) {
            return baseScale;
        }
        const distance = Math.max(1, Math.abs(targetZ - camera.position.z));
        const verticalWorld = 2 * Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
        const horizontalWorld = verticalWorld * camera.aspect;
        const maxByHeight = (verticalWorld * fill) / CARD_WORLD_HEIGHT;
        const maxByWidth = (horizontalWorld * 0.76) / CARD_WORLD_WIDTH;
        return Math.max(0.62, Math.min(baseScale, maxByHeight, maxByWidth));
    }

    function updateCards(now) {
        if (state.loadState === "PLAYING" && !state.activeCard) {
            state.globalAngle += state.angularVelocity;
            state.angularVelocity *= 0.9;
            state.globalAngle += 0.001;
        }

        const activeCardCount = Math.max(8, Math.min(cards.length, quality.activeCards));
        const angleStep = (Math.PI * 2) / activeCardCount;
        for (const card of cards) {
            if (card.index >= activeCardCount && card.state === "IDLE") {
                card.mesh.visible = false;
                continue;
            }
            if (card.index < activeCardCount && card.state === "IDLE") {
                card.mesh.visible = true;
            }

            if (card.state === "IDLE") {
                const angle = state.globalAngle + card.index * angleStep;
                const horizontalRadius = quality.horizontalRadius || quality.radius;
                card.targetX = Math.sin(angle) * horizontalRadius;
                card.targetY = Math.sin(angle * 2) * 0.12;
                card.targetZ = quality.depthOffset - Math.cos(angle) * quality.radius;
                card.targetRotY = angle + Math.PI;
                card.targetRotX = pointerNDC.y !== -999 ? pointerNDC.y * 0.08 : 0;
                card.targetScaleX = quality.cardScale;
                card.targetScaleY = quality.cardScale;
                card.targetScaleZ = quality.cardScale;
            } else if (card.state === "GRABBED" || card.state === "REVEALED") {
                const isReveal = card.state === "REVEALED";
                const targetZ = isReveal ? -6.2 : -7;
                const targetScale = fitCardScaleToViewport(isReveal ? quality.revealScale : quality.grabScale, targetZ);
                card.targetX = isReveal ? 0 : (pointerNDC.x !== -999 ? pointerNDC.x * 1.4 : 0);
                card.targetY = isReveal ? 0.1 : 0;
                card.targetZ = targetZ;
                card.targetRotX = isReveal ? 0 : (pointerNDC.y !== -999 ? pointerNDC.y * 0.28 : 0);
                card.targetRotY = isReveal ? 0 : (pointerNDC.x !== -999 ? pointerNDC.x * 0.34 : 0);
                card.targetScaleX = targetScale;
                card.targetScaleY = targetScale;
                card.targetScaleZ = targetScale;

                if (isReveal && now > card.revealUntil) {
                    card.state = "DESTROYED";
                }
            }

            if (card.state !== "DESTROYED") {
                card.mesh.position.x += (card.targetX - card.mesh.position.x) * 0.11;
                card.mesh.position.y += (card.targetY - card.mesh.position.y) * 0.11;
                card.mesh.position.z += (card.targetZ - card.mesh.position.z) * 0.11;
                card.mesh.rotation.x += (card.targetRotX - card.mesh.rotation.x) * 0.11;

                let diffY = card.targetRotY - card.mesh.rotation.y;
                diffY = Math.atan2(Math.sin(diffY), Math.cos(diffY));
                card.mesh.rotation.y += diffY * 0.11;

                card.currentScaleX += (card.targetScaleX - card.currentScaleX) * 0.11;
                card.currentScaleY += (card.targetScaleY - card.currentScaleY) * 0.11;
                card.currentScaleZ += (card.targetScaleZ - card.currentScaleZ) * 0.11;
                card.mesh.scale.set(card.currentScaleX, card.currentScaleY, card.currentScaleZ);
            }
        }
    }

    function pointerLightTarget() {
        const x = pointerNDC.x !== -999 ? pointerNDC.x : 0;
        const y = pointerNDC.y !== -999 ? pointerNDC.y : 0;
        const horizontalReach = Math.min(7.2, Math.max(4.4, camera.aspect * 4.6));
        return {
            x: x * horizontalReach,
            y: y * 4.6,
            z: 3.4
        };
    }

    function updateEffects(delta, now) {
        if (magicCircle) {
            magicCircle.rotation.z += delta * 0.045;
        }

        if (cherrySystem && cherryMaterial) {
            cherryMaterial.uniforms.uTime.value = now * 0.001;
            cherrySystem.geometry.setDrawRange(0, quality.activeCherryParticles);
        }

        const lightActive = !!state.activeCard || now < state.revealLightUntil || (explosionSystem && explosionSystem.visible);
        if (lightActive) {
            const target = pointerLightTarget();
            goldLight.position.x += (target.x - goldLight.position.x) * 0.18;
            goldLight.position.y += (target.y - goldLight.position.y) * 0.18;
            goldLight.position.z += (target.z - goldLight.position.z) * 0.14;
            goldLight.intensity += (1.75 - goldLight.intensity) * 0.12;
        } else {
            goldLight.position.x += (0 - goldLight.position.x) * 0.08;
            goldLight.position.y += (1 - goldLight.position.y) * 0.08;
            goldLight.position.z += (4 - goldLight.position.z) * 0.08;
            goldLight.intensity += (0.82 - goldLight.intensity) * 0.08;
        }

        if (cursorGlow && cursorGlowMaterial) {
            const targetOpacity = lightActive ? 0.5 : 0;
            cursorGlowMaterial.opacity += (targetOpacity - cursorGlowMaterial.opacity) * 0.18;
            cursorGlow.visible = cursorGlowMaterial.opacity > 0.02;
            cursorGlow.position.set(goldLight.position.x, goldLight.position.y, 2.05);
            const targetScale = state.activeCard ? 2.05 : 2.55;
            cursorGlow.scale.x += (targetScale - cursorGlow.scale.x) * 0.16;
            cursorGlow.scale.y += (targetScale - cursorGlow.scale.y) * 0.16;
        }

        if (explosionSystem && explosionSystem.visible) {
            const timeSeconds = now * 0.001;
            explosionMaterial.uniforms.uTime.value = timeSeconds;
            explosionLife = Math.max(0, 1.18 - (timeSeconds - explosionStartedAt));
            if (explosionLife <= 0) {
                explosionSystem.visible = false;
            }
        }
    }

    function applyPerformanceLevel() {
        const level = state.degradationLevel;
        if (level === 0) {
            return;
        }

        const particleScale = level === 1 ? 0.76 : level === 2 ? 0.56 : 0.40;
        const cardDrop = level === 1 ? 2 : level === 2 ? 4 : 6;
        quality.activeCherryParticles = Math.max(180, Math.floor(quality.cherryParticles * particleScale));
        quality.activeParticles = Math.max(160, Math.floor(quality.particles * particleScale));
        quality.activeCards = Math.max(10, quality.cards - cardDrop);
        quality.pixelRatio = Math.max(0.85, quality.pixelRatio - 0.18);
        dom.qualityBadge.textContent = `${quality.label}·稳帧${level}`;
        resize();
    }

    function sampleFrameRate(now) {
        state.frameCount += 1;
        const elapsed = now - state.fpsWindowStart;
        if (elapsed < 1200) {
            return;
        }

        const fps = state.frameCount * 1000 / elapsed;
        state.frameCount = 0;
        state.fpsWindowStart = now;

        if (state.loadState !== "PLAYING") {
            return;
        }

        if (fps < 42) {
            state.slowFrames += 1;
        } else if (fps > 52) {
            state.slowFrames = Math.max(0, state.slowFrames - 1);
        }

        if (state.slowFrames >= 2 && state.degradationLevel < 3) {
            state.degradationLevel += 1;
            state.slowFrames = 0;
            applyPerformanceLevel();
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        const delta = Math.min(clock.getDelta(), 0.05);
        const now = performance.now();
        sampleFrameRate(now);
        updateCards(now);
        updateEffects(delta, now);
        renderer.render(scene, camera);
    }

    function resize() {
        if (!camera || !renderer) {
            return;
        }
        applyResponsiveCardLayout();
        const viewport = viewportMetrics();
        camera.aspect = viewport.aspect;
        camera.updateProjectionMatrix();
        renderer.setSize(viewport.width, viewport.height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
        const pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio);
        if (cherryMaterial) {
            cherryMaterial.uniforms.uPixelRatio.value = pixelRatio;
        }
        if (explosionMaterial) {
            explosionMaterial.uniforms.uPixelRatio.value = pixelRatio;
        }
    }

    async function boot() {
        if (!window.THREE) {
            dom.loadingText.textContent = "Three.js 加载失败";
            dom.loadingSubtext.textContent = "请检查本地资源是否完整";
            return;
        }

        setupRenderer();
        setupLongTaskObserver();
        setupLights();
        setupNebula();
        setupSakuraFall();
        setupStars();
        setupMagicCircle();
        setupPointerInput();

        const { backTexture, cardsLoaded } = await prepareAssets();
        setupCards(backTexture, cardsLoaded);
        setupExplosion();
        prewarmRenderResources();

        state.loadState = "READY";
        dom.loadingScreen.classList.add("is-ready");
        dom.loadingText.textContent = "封印解除";
        dom.loadingSubtext.textContent = "选择一种启动方式";
        dom.startButton.disabled = false;
        dom.touchStartButton.disabled = false;
        dom.gestureStartButton.disabled = false;
        dom.launchOptions.hidden = false;
        dom.localFileNote.hidden = window.location.protocol !== "file:";

        animate();
        resize();
        setStatus("选择触摸/鼠标或摄像头手势模式");

        warmGestureWorker();

        window.__clowAppState = {
            get loadState() { return state.loadState; },
            get cardCount() { return cards.length; },
            get assetCount() { return clowData.length; },
            get quality() { return quality.label; }
        };
        window.__clowPerf = {
            get degradationLevel() { return state.degradationLevel; },
            get activeCards() { return quality.activeCards; },
            get activeCherryParticles() { return quality.activeCherryParticles; },
            get activeExplosionParticles() { return quality.activeParticles; },
            get pixelRatio() { return quality.pixelRatio; },
            get gestureReady() { return state.gestureWorkerReady; },
            get gestureLoading() { return state.gestureWorkerLoading; },
            get gestureWarmupStarted() { return state.gestureWarmupStarted; },
            get gestureInterval() { return state.handFrameInterval; },
            get gestureSample() { return `${state.gestureSampleWidth}x${state.gestureSampleHeight}`; },
            get gestureFrameId() { return state.gestureFrameId; },
            get gestureFramePending() { return state.gestureFramePending; },
            get handLostFrames() { return state.handLostFrames; },
            get handActionScore() { return Number(state.handActionScore.toFixed(2)); },
            get lastGestureInferenceMs() { return Math.round(state.lastHandProcessTime || 0); },
            get longTaskCount() { return state.longTaskCount; },
            get cardDepth() { return CARD_WORLD_DEPTH; },
            get cardRadius() { return quality.radius; },
            get cardHorizontalRadius() { return quality.horizontalRadius || quality.radius; },
            get cardDepthOffset() { return quality.depthOffset; },
            get cardScale() { return quality.cardScale; },
            get viewport() {
                const viewport = viewportMetrics();
                return `${viewport.width}x${viewport.height}`;
            },
            get cursorGlowVisible() { return !!(cursorGlow && cursorGlow.visible); },
            get explosionVisible() { return !!(explosionSystem && explosionSystem.visible); },
            get explosionLife() { return Number(explosionLife.toFixed(2)); },
            get lastExplosionDelayMs() { return state.lastExplosionDelayMs; }
        };
    }

    dom.startButton.addEventListener("click", requestStart);
    dom.touchStartButton.addEventListener("click", requestStart);
    dom.gestureStartButton.addEventListener("click", requestGestureStart);
    dom.gestureToggle.addEventListener("click", startGestureMode);
    window.addEventListener("resize", resize);
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", resize);
    }
    window.addEventListener("orientationchange", () => window.setTimeout(resize, 120));

    boot().catch((error) => {
        console.error(error);
        dom.loadingText.textContent = "牌库启动失败";
        dom.loadingSubtext.textContent = error.message || "请检查控制台错误";
    });
})();
