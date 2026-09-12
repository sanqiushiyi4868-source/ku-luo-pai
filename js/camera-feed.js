/* Camera permission, decoded frames and hand recognition are separate states. */
(() => {
    "use strict";
    class CameraFeed {
        constructor(video, canvas, onStatus, onFailure) {
            this.video = video;
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
            const healthCanvas = document.createElement("canvas");
            healthCanvas.width = 32;
            healthCanvas.height = 24;
            this.healthCtx = healthCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
            this.onStatus = onStatus;
            this.onFailure = onFailure;
            this.session = 0;
            this.status = "off";
        }

        setStatus(status, message) {
            if (status === this.status && message === this.statusMessage) return;
            this.status = status;
            this.statusMessage = message;
            this.onStatus(status, message);
        }

        stop() {
            ++this.session;
            clearTimeout(this.monitor);
            clearTimeout(this.poll);
            if (this.frameCallback != null && this.video.cancelVideoFrameCallback) {
                this.video.cancelVideoFrameCallback(this.frameCallback);
            }
            this.frameCallback = null;
            this.cancelStart?.();
            this.cancelStart = null;
            this.stream?.getTracks().forEach(track => track.stop());
            this.stream = null;
            this.video.pause();
            this.video.srcObject = null;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.status = "off";
            this.fps = 0;
        }

        async start(deviceId) {
            this.stop();
            const session = this.session;
            this.setStatus("starting", "正在请求摄像头权限");
            let timeout;
            const cancelled = new Promise((_, reject) => {
                this.cancelStart = () => reject(new DOMException("摄像头启动已取消", "AbortError"));
                timeout = setTimeout(() => reject(new Error("摄像头启动超时，请允许权限或更换摄像头")), 30000);
            });
            const current = () => session === this.session;
            try {
                const stream = await Promise.race([
                    navigator.mediaDevices.getUserMedia({
                        audio: false,
                        video: {
                            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "user" }),
                            width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }
                        }
                    }).then(stream => {
                        if (!current()) {
                            stream.getTracks().forEach(track => track.stop());
                            throw new DOMException("摄像头启动已取消", "AbortError");
                        }
                        return stream;
                    }),
                    cancelled
                ]);
                this.stream = stream;
                const track = stream.getVideoTracks()[0];
                if (!track) throw new Error("摄像头没有提供视频轨道");
                track.addEventListener("ended", () => {
                    if (current()) this.onFailure("摄像头已断开，请重新开启或更换摄像头");
                });
                this.video.muted = true;
                this.video.playsInline = true;
                this.video.srcObject = stream;
                this.setStatus("starting", "正在等待摄像头画面");
                await Promise.race([this.video.play(), cancelled]);
                if (!current()) throw new DOMException("摄像头启动已取消", "AbortError");
                this.lastFrameAt = performance.now();
                this.lastVideoTime = -1;
                this.darkSince = null;
                this.lastCheckAt = 0;
                this.frameCount = 0;
                this.fps = 0;
                this.fpsStartedAt = performance.now();
                this.fpsFrameCount = 0;
                await Promise.race([new Promise((resolve, reject) => {
                    this.firstFrame = resolve;
                    this.frameError = reject;
                    this.readFrame(session);
                }), cancelled]);
                if (!current()) throw new DOMException("摄像头启动已取消", "AbortError");
                this.watch(session);
                return stream;
            } catch (error) {
                if (current()) this.stop();
                throw error;
            } finally {
                clearTimeout(timeout);
                if (current()) this.cancelStart = null;
            }
        }

        readFrame(session) {
            if (session !== this.session) return;
            try {
                const video = this.video;
                if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== this.lastVideoTime) {
                    this.lastVideoTime = video.currentTime;
                    const now = performance.now();
                    this.lastFrameAt = now;
                    // The visible video plays natively at camera speed, independent of inference.
                    ++this.frameCount;
                    ++this.fpsFrameCount;
                    if (now - this.fpsStartedAt >= 1000) {
                        this.fps = this.fpsFrameCount * 1000 / (now - this.fpsStartedAt);
                        this.fpsFrameCount = 0;
                        this.fpsStartedAt = now;
                    }
                    if (now - this.lastCheckAt > 500 || this.frameCount === 1) {
                        this.lastCheckAt = now;
                        this.healthCtx.drawImage(video, 0, 0, 32, 24);
                        const pixels = this.healthCtx.getImageData(0, 0, 32, 24).data;
                        let light = 0;
                        let count = 0;
                        for (let i = 0; i < pixels.length; i += 4) {
                            light += Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
                            ++count;
                        }
                        if (light / count < 5) {
                            this.darkSince ??= now;
                            this.setStatus("dark", "画面过暗或全黑，请检查遮挡、光线，或切换摄像头");
                        } else {
                            this.darkSince = null;
                            this.setStatus("live", "摄像头画面正常");
                        }
                    }
                    this.firstFrame?.();
                    this.firstFrame = null;
                    this.onFrame?.(now);
                }
            } catch (error) {
                this.frameError?.(error);
                this.onFailure("无法读取摄像头画面，请重新开启");
                return;
            }
            if (this.video.requestVideoFrameCallback) {
                this.frameCallback = this.video.requestVideoFrameCallback(() => {
                    this.frameCallback = null;
                    this.readFrame(session);
                });
            } else {
                this.poll = setTimeout(() => this.readFrame(session), 40);
            }
        }

        capture(width) {
            const height = Math.max(1, Math.round(width * this.video.videoHeight / this.video.videoWidth));
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
            // One resize/copy per inference, no full-frame CPU readback or second resize.
            this.ctx.drawImage(this.video, 0, 0, width, height);
            return this.canvas;
        }

        watch(session) {
            this.monitor = setTimeout(() => {
                if (session !== this.session) return;
                if (performance.now() - this.lastFrameAt > 4000) {
                    this.onFailure("摄像头画面已停止，请重新开启或切换摄像头");
                    return;
                }
                this.watch(session);
            }, 1000);
        }
    }
    window.CameraFeed = CameraFeed;
})();
