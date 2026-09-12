const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const server = require('./server.cjs');
let browser, base;
before(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}/ku-luo-pai/`;
    browser = await chromium.launch({
        ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    });
});
after(async () => { await browser?.close(); server.close(); });

async function open(options = {}, media, worker = false) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.errors = errors;
    // Expose internals only in the test response, never in the deployed app.
    await page.route('**/js/app.js*', route => route.fulfill({
        contentType: 'text/javascript',
        body: fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8').replace('    boot().catch',
            '    window.testApp = {state, cards: () => cards, camera: () => camera, quality, applyPerformanceLevel};\n    boot().catch')
    }));
    if (media) await page.addInitScript(installMedia, media);
    if (worker) await page.addInitScript(installWorker);
    await page.goto(base);
    await page.waitForFunction(() => window.__clowAppState?.loadState === 'READY');
    await page.getByRole('button', { name: '触摸/鼠标模式', exact: true }).click();
    await page.waitForTimeout(1000);
    return page;
}

function installMedia(mode) {
    window.mediaMode = mode;
    window.testStreams = [];
    window.mediaRequests = [];
    window.makeStream = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        let frame = 0;
        const paint = () => {
            ctx.fillStyle = window.mediaMode === 'black' ? '#000' : '#417ea3';
            ctx.fillRect(0, 0, 640, 480);
            if (window.mediaMode !== 'black') {
                ctx.fillStyle = '#efe2a9'; ctx.fillRect(frame++ % 500, 40, 70, 70);
            }
        };
        paint();
        const stream = canvas.captureStream(24);
        const timer = setInterval(paint, 40);
        stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
        window.testStreams.push(stream);
        return stream;
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
        window.mediaRequests.push(constraints);
        if (window.mediaMode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        if (window.mediaMode === 'missing') throw new DOMException('Missing', 'NotFoundError');
        if (window.mediaMode === 'busy') throw new DOMException('Busy', 'NotReadableError');
        if (window.mediaMode === 'pending') return new Promise(resolve => { window.resolveCamera = () => resolve(window.makeStream()); });
        return window.makeStream();
    };
    navigator.mediaDevices.enumerateDevices = async () => [
        { kind: 'videoinput', deviceId: 'front', label: 'Front test camera' },
        { kind: 'videoinput', deviceId: 'rear', label: 'Rear test camera' }
    ];
}

function installWorker() {
    window.testPose = 'none';
    window.testWorkerMode = 'normal';
    window.Worker = class {
        postMessage(data) {
            if (data.type === 'init') {
                setTimeout(() => this.onmessage?.({ data: { type: 'ready' } }), 30);
                return;
            }
            data.bitmap?.close();
            if (this.closed || window.testWorkerMode === 'stalled') return;
            if (window.testWorkerMode === 'error') {
                this.onmessage?.({ data: { type: 'error', stage: 'gesture:frame', message: 'Test inference failure' } });
                return;
            }
            const landmarks = Array.from({ length: 21 }, () => ({ x: .5, y: .6, z: 0 }));
            landmarks[0] = { x: .5, y: .85, z: 0 };
            landmarks[5] = { x: .35, y: .6, z: 0 };
            landmarks[17] = { x: .65, y: .6, z: 0 };
            landmarks[8] = { x: .5, y: .5, z: 0 };
            landmarks[4] = { x: window.testPose === 'pinch' ? landmarks[8].x + .02 : .8, y: .5, z: 0 };
            for (const point of landmarks) {
                point.x += (window.handX ?? .5) - .5;
                point.y += (window.handY ?? .5) - .5;
            }
            setTimeout(() => { if (!this.closed) this.onmessage?.({ data: {
                type: 'result', hands: window.testPose === 'none' ? 0 : 1,
                landmarks, gesture: window.testPose === 'pinch' ? 'Closed_Fist' : 'Open_Palm', inferenceMs: 12
            } }); }, 5);
        }
        terminate() { this.closed = true; }
    };
}

const layout = page => page.evaluate(() => ({
    count: __clowPerf.activeCards, radius: __clowPerf.cardRadius,
    horizontal: __clowPerf.cardHorizontalRadius, depth: __clowPerf.cardDepthOffset,
    scale: __clowPerf.cardScale,
    tilt: testApp.cards().filter(c => c.state === 'IDLE').map(c => c.targetRotX)
}));
async function startCamera(page) {
    await page.locator('#gesture-toggle').click();
    await page.waitForFunction(() => __clowPerf.gestureReady && testApp.state.handModeStarted && !testApp.state.cameraStarting);
}
async function save(page, name) {
    if (process.env.SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, name + '.png') });
    }
}

test('local assets, actual MediaPipe worker, live preview, stable layout and restart', async () => {
    const page = await open();
    try {
        assert.equal(await page.evaluate(() => __clowAppState.assetCount), 53);
        assert.equal(await page.evaluate(() => __clowPerf.gestureLoading || __clowPerf.gestureReady), false);
        const before = await layout(page);
        await save(page, 'mouse-desktop');
        await startCamera(page);
        await page.waitForFunction(() => __clowPerf.gestureFrameId > 3 && __clowPerf.cameraFrames > 4);
        assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'live');
        assert.deepEqual(await layout(page), before);
        await save(page, 'gesture-desktop');
        await page.evaluate(() => { window.oldTrack = document.querySelector('#webcam').srcObject.getVideoTracks()[0]; });
        await page.locator('#gesture-toggle').click();
        assert.equal(await page.evaluate(() => oldTrack.readyState), 'ended');
        assert.equal(await page.evaluate(() => __clowPerf.gestureReady), false);
        assert.deepEqual(await layout(page), before);
        await startCamera(page);
        await page.waitForFunction(() => __clowPerf.cameraStatus === 'live');
        await page.evaluate(() => { testApp.state.degradationLevel = 3; testApp.applyPerformanceLevel(); });
        assert.deepEqual(await layout(page), before);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('mouse pick stays in foreground; release shows card before returning it to deck', async () => {
    const page = await open();
    try {
        await page.mouse.move(720, 450);
        await page.mouse.down();
        await page.waitForFunction(() => testApp.state.activeCard?.state === 'GRABBED');
        await page.waitForTimeout(1100);
        const detail = await page.evaluate(() => {
            const card = testApp.state.activeCard;
            window.picked = card;
            return { parentCards: card.mesh.parent.children.filter(c => c.isGroup).length, tiltX: card.targetRotX, tiltY: card.targetRotY, x: card.targetX };
        });
        assert.deepEqual(detail, { parentCards: 1, tiltX: 0, tiltY: 0, x: 0 });
        await save(page, 'drawn-desktop');
        await page.mouse.up();
        assert.equal(await page.evaluate(() => picked.state), 'REVEALED');
        assert.equal(await page.evaluate(() => picked.mesh.visible), true);
        await page.waitForFunction(() => document.querySelectorAll('.history-card').length === 1);
        await page.waitForFunction(() => picked.state === 'IDLE');
        assert.ok(await page.evaluate(() => picked.mesh.parent.children.filter(c => c.isGroup).length > 1));
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('hand pinch, mouse isolation, open-hand release and lost-hand release', async () => {
    const page = await open({}, 'live', true);
    try {
        await startCamera(page);
        await page.evaluate(() => { window.testPose = 'open'; });
        await page.waitForFunction(() => testApp.state.currentInputSource === 'hand');
        await page.evaluate(() => { window.testPose = 'pinch'; });
        await page.waitForFunction(() => testApp.state.activeCard?.state === 'GRABBED');
        await page.mouse.move(100, 100);
        assert.equal(await page.evaluate(() => testApp.state.currentInputSource), 'hand');
        await page.evaluate(() => { window.testPose = 'open'; });
        await page.waitForFunction(() => !testApp.state.activeCard);
        await page.waitForTimeout(1800);
        await page.evaluate(() => { window.testPose = 'pinch'; });
        await page.waitForFunction(() => testApp.state.activeCard?.state === 'GRABBED');
        await page.evaluate(() => { window.testPose = 'none'; });
        await page.waitForFunction(() => !testApp.state.activeCard);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('held card follows mouse on both axes with directional gold rim, deck stays upright', async () => {
    const page = await open();
    try {
        await page.mouse.move(720, 450); await page.mouse.down();
        await page.waitForFunction(() => testApp.state.activeCard?.state === 'GRABBED');
        await page.waitForFunction(() => Math.abs(testApp.state.activeCard.mesh.rotation.y) < .03);
        await page.mouse.move(1200, 190);
        await page.waitForFunction(() => testApp.state.activeCard.mesh.rotation.y > .13 && testApp.state.activeCard.mesh.rotation.x > .07);
        const rim = await page.evaluate(() => {
            const c = testApp.state.activeCard;
            return { visible: c.mesh.userData.rim.visible, aim: c.mesh.userData.rim.material.uniforms.uAim.value.toArray(), strength: c.mesh.userData.rim.material.uniforms.uStrength.value };
        });
        assert.equal(rim.visible, true);
        assert.ok(rim.aim[0] > .5 && rim.aim[1] > .4 && rim.strength > 1);
        assert.ok((await layout(page)).tilt.every(angle => angle === 0));
        await save(page, 'tilt-gold-right');
        await page.mouse.move(200, 720);
        await page.waitForFunction(() => testApp.state.activeCard.mesh.rotation.y < -.12 && testApp.state.activeCard.mesh.rotation.x < -.06);
        assert.ok(await page.evaluate(() => testApp.state.activeCard.mesh.userData.rim.material.uniforms.uAim.value.x < -.5));
        await save(page, 'tilt-gold-left');
        await page.mouse.up();
        await page.waitForFunction(() => testApp.cards().some(c => c.state === 'REVEALED' && c.targetRotX === 0 && c.targetRotY === 0));
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('held card follows mirrored hand movement and preserves the gold rim', async () => {
    const page = await open({}, 'live', true);
    try {
        await startCamera(page);
        await page.evaluate(() => { window.testPose = 'pinch'; });
        await page.waitForFunction(() => testApp.state.activeCard?.state === 'GRABBED');
        await page.waitForFunction(() => Math.abs(testApp.state.activeCard.mesh.rotation.y) < .03);
        await page.evaluate(() => { window.handX = .2; window.handY = .2; });
        await page.waitForFunction(() => testApp.state.activeCard.mesh.rotation.y > .04 && testApp.state.activeCard.mesh.rotation.x > .02);
        assert.ok(await page.evaluate(() => testApp.state.activeCard.mesh.userData.rim.visible));
        await save(page, 'tilt-hand');
        await page.evaluate(() => { window.handX = .8; window.handY = .8; });
        await page.waitForFunction(() => testApp.state.activeCard.mesh.rotation.y < -.04 && testApp.state.activeCard.mesh.rotation.x < -.04);
        assert.ok((await layout(page)).tilt.every(angle => angle === 0));
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('native realtime preview keeps advancing while inference is busy and only latest frames are sent', async () => {
    const page = await open({}, 'live', true);
    try {
        await startCamera(page);
        assert.equal(await page.locator('#webcam').isVisible(), true);
        assert.equal(await page.locator('#webcam-preview').isVisible(), false);
        assert.equal(await page.locator('#webcam').evaluate(el => getComputedStyle(el).objectFit), 'contain');
        await page.evaluate(() => { window.testWorkerMode = 'stalled'; });
        await page.waitForFunction(() => __clowPerf.gestureFramePending);
        const sent = await page.evaluate(() => __clowPerf.gestureFrameId);
        const before = await page.locator('#webcam').screenshot();
        await page.waitForTimeout(350);
        const after = await page.locator('#webcam').screenshot();
        assert.notDeepEqual(before, after, 'Visible camera pixels must change during stalled inference');
        assert.equal(await page.evaluate(() => __clowPerf.gestureFrameId), sent, 'Do not queue frames while a worker result is pending');
        assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'live');
    } finally { await page.close(); }
});

for (const [mode, message] of [['denied', '权限被拒绝'], ['missing', '没有找到'], ['busy', '其他程序占用']]) {
    test(`camera ${mode}: truthful error and retry`, async () => {
        const page = await open({}, mode, true);
        try {
            await page.locator('#gesture-toggle').click();
            await page.waitForFunction(text => document.querySelector('#status-text').textContent.includes(text), message);
            assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'off');
            assert.equal(await page.locator('#webcam-container').isVisible(), false);
            await page.evaluate(() => { window.mediaMode = 'live'; });
            await startCamera(page);
            assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'live');
            assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
    });
}

test('cancel pending permission request closes a late stream and allows retry', async () => {
    const page = await open({}, 'pending', true);
    try {
        await page.locator('#gesture-toggle').click();
        await page.waitForFunction(() => typeof window.resolveCamera === 'function');
        await page.locator('#gesture-toggle').click();
        await page.evaluate(() => window.resolveCamera());
        await page.waitForFunction(() => testStreams[0].getVideoTracks()[0].readyState === 'ended');
        assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'off');
        await page.evaluate(() => { window.mediaMode = 'live'; });
        await startCamera(page);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('black frames warn, lighting recovers, camera switching closes old stream, disconnect stops', async () => {
    const page = await open({}, 'black', true);
    try {
        await startCamera(page);
        assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'dark');
        assert.match(await page.locator('#status-text').textContent(), /过暗|全黑/);
        assert.equal(await page.evaluate(() => __clowPerf.gestureFrameId), 0);
        await page.evaluate(() => { window.mediaMode = 'live'; });
        await page.waitForFunction(() => __clowPerf.cameraStatus === 'live' && __clowPerf.gestureFrameId > 0);
        assert.doesNotMatch(await page.locator('#status-text').textContent(), /过暗|全黑/);
        await page.locator('#camera-select').selectOption('rear');
        await page.waitForFunction(() => testStreams.length === 2 && __clowPerf.cameraStatus === 'live');
        assert.equal(await page.evaluate(() => testStreams[0].getVideoTracks()[0].readyState), 'ended');
        assert.equal(await page.evaluate(() => mediaRequests[1].video.deviceId.exact), 'rear');
        await page.evaluate(() => testStreams[1].getVideoTracks()[0].dispatchEvent(new Event('ended')));
        assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'off');
        assert.match(await page.locator('#status-text').textContent(), /断开/);
        assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
});

test('frozen decoded video is detected and closes camera', async () => {
    const page = await open({}, 'live', true);
    try {
        await startCamera(page);
        await page.evaluate(() => document.querySelector('#webcam').pause());
        await page.waitForFunction(() => __clowPerf.cameraStatus === 'off', {}, { timeout: 8000 });
        assert.match(await page.locator('#status-text').textContent(), /画面已停止/);
        assert.equal(await page.evaluate(() => testStreams[0].getVideoTracks()[0].readyState), 'ended');
    } finally { await page.close(); }
});

for (const mode of ['stalled', 'error']) {
    test(`worker ${mode}: stop instead of showing ready indefinitely`, async () => {
        const page = await open({}, 'live', true);
        try {
            await page.evaluate(mode => { window.testWorkerMode = mode; }, mode);
            await startCamera(page);
            await page.waitForFunction(() => __clowPerf.cameraStatus === 'off', {}, { timeout: 12000 });
            assert.match(await page.locator('#status-text').textContent(), /超时|连续失败/);
            assert.equal(await page.evaluate(() => testStreams[0].getVideoTracks()[0].readyState), 'ended');
        } finally { await page.close(); }
    });
}

test('background tab stops camera and resets held input', async () => {
    const page = await open({}, 'live', true);
    try {
        await startCamera(page);
        await page.evaluate(() => {
            Object.defineProperty(document, 'hidden', { configurable: true, value: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        assert.equal(await page.evaluate(() => __clowPerf.cameraStatus), 'off');
        assert.equal(await page.evaluate(() => testStreams[0].getVideoTracks()[0].readyState), 'ended');
        assert.equal(await page.evaluate(() => testApp.state.wasActionDown), false);
    } finally { await page.close(); }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
    test(`responsive ${viewport.width}x${viewport.height}: stable camera layout and fully visible drawn card`, async () => {
        const page = await open({ viewport, isMobile: true, hasTouch: true }, 'live', true);
        try {
            const before = await layout(page);
            await startCamera(page);
            assert.deepEqual(await layout(page), before);
            await save(page, `gesture-${viewport.width}x${viewport.height}`);
            await page.mouse.move(viewport.width / 2, viewport.height / 2);
            await page.mouse.down();
            await page.waitForFunction(() => testApp.state.activeCard?.state === 'GRABBED');
            await page.waitForTimeout(1100);
            await page.mouse.move(viewport.width * .93, viewport.height * .7);
            await page.waitForTimeout(400);
            const bounds = await page.evaluate(() => {
                const card = testApp.state.activeCard;
                const corners = [[-.8, -1.8], [.8, 1.8], [-.8, 1.8], [.8, -1.8]].map(([x, y]) =>
                    new THREE.Vector3(x, y, 0).applyMatrix4(card.mesh.matrixWorld).project(testApp.camera()));
                return corners.map(v => ({ x: v.x, y: v.y }));
            });
            for (const point of bounds) assert.ok(Math.abs(point.x) < .98 && Math.abs(point.y) < .98, JSON.stringify(bounds));
            await save(page, `drawn-${viewport.width}x${viewport.height}`);
            assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
    });
}
