/**
 * Off-screen render target used for the visible canvas pass when reversed-Z depth is enabled.
 *
 * The default WebGL framebuffer only offers a fixed-point depth buffer whose format cannot be
 * chosen. To get the floating point depth buffer that makes reversed-Z effective, the scene is
 * rendered into this off-screen framebuffer (multisampled colour + `DEPTH_COMPONENT32F` depth)
 * and the resolved colour is then blitted to the canvas. Multisampling is kept so that the move
 * away from the antialiased default framebuffer does not regress edge quality.
 *
 * WebGL2 only.
 *
 * @category Core
 */
export class SceneTarget {

    public framebuffer: WebGLFramebuffer = null;

    /** Whether the framebuffer is allocated and framebuffer-complete. */
    public isComplete = false;

    public width = 0;
    public height = 0;

    private readonly gl: WebGL2RenderingContext;
    private readonly samples: number;

    private colorBuffer: WebGLRenderbuffer = null;
    private depthBuffer: WebGLRenderbuffer = null;
    private _disposed = false;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
        // 4x MSAA is a good quality/performance balance and universally supported on WebGL2
        this.samples = Math.max(1, Math.min(4, maxSamples || 1));
    }

    /**
     * Makes sure the framebuffer is allocated at the requested size, (re)allocating it on a size
     * change. Returns true when the target is ready to be used.
     */
    public ensureSize(width: number, height: number): boolean {
        width = Math.floor(width);
        height = Math.floor(height);

        if (width <= 0 || height <= 0) {
            return false;
        }

        if (this.framebuffer != null && this.width === width && this.height === height) {
            return this.isComplete;
        }

        this.releaseBuffers();
        this.allocate(width, height);
        return this.isComplete;
    }

    /** Binds this framebuffer as the current draw target. */
    public bind(): void {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    }

    /**
     * Resolves and copies the colour attachment to the default framebuffer (canvas). The blit
     * also resolves the multisampled colour buffer. Depth is intentionally not copied - it is not
     * needed on the canvas.
     */
    public blitToCanvas(): void {
        const gl = this.gl;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.framebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.blitFramebuffer(
            0, 0, this.width, this.height,
            0, 0, this.width, this.height,
            gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    private allocate(width: number, height: number): void {
        const gl = this.gl;

        this.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);

        // multisampled colour
        this.colorBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorBuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorBuffer);

        // multisampled floating point depth (the whole point of this target)
        this.depthBuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT32F, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);

        this.isComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        this.width = width;
        this.height = height;

        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    private releaseBuffers(): void {
        const gl = this.gl;
        if (this.framebuffer != null) {
            gl.deleteFramebuffer(this.framebuffer);
            this.framebuffer = null;
        }
        if (this.colorBuffer != null) {
            gl.deleteRenderbuffer(this.colorBuffer);
            this.colorBuffer = null;
        }
        if (this.depthBuffer != null) {
            gl.deleteRenderbuffer(this.depthBuffer);
            this.depthBuffer = null;
        }
        this.isComplete = false;
        this.width = 0;
        this.height = 0;
    }

    /** Deletes all WebGL resources held by this target. */
    public delete(): void {
        if (this._disposed) {
            return;
        }
        this.releaseBuffers();
        this._disposed = true;
    }
}
