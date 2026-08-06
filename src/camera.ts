import { mat4 } from "gl-matrix";

/**
 * @category Core
 */
export class CameraProperties {

    /**
     * 
     */
    constructor(changeHandler: () => void) {
        this.onChange = changeHandler || (() => { return; });
    }

    private _fov = 45;
    private _near: number;
    private _far: number;
    private _height: number;
    private _type: CameraType = CameraType.PERSPECTIVE;

    public get fov(): number { return this._fov; }
    public set fov( value: number) { 
        if (value == null || value <= 0 || value > 180)
            throw new Error('Perspective field of view has to be a positive number between 0 and 180 degrees');
        this._fov = value; 
        if (this.onChange && this.type === CameraType.PERSPECTIVE) { this.onChange(); }
    }

    public get near(): number { return this._near; }
    public set near( value: number) { this._near = value; if (this.onChange) { this.onChange(); }}

    public get far(): number { return this._far; }
    public set far( value: number) { this._far = value; if (this.onChange) { this.onChange(); }}

    public get height(): number { return this._height; }
    public set height( value: number) { 
        if (value == null || value <= 0)
            throw new Error('Orthographic view height has to be a positive number');
        this._height = value; 
        if (this.onChange  && this.type === CameraType.ORTHOGONAL) { this.onChange(); }
    }

    public get type(): CameraType {return this._type; }
    public set type(value: CameraType) { this._type = value; if (this.onChange) { this.onChange(); }}

    public onChange = () => { return; };

    /**
     * Builds the projection matrix for the current camera type.
     *
     * @param width viewport width in pixels
     * @param height viewport height in pixels
     * @param reverseZ when true, returns a reversed-Z projection whose clip-space depth runs
     * from 1 at the near plane to 0 at the far plane over the **[0, 1]** range (near -> 1,
     * far -> 0). This is meant to be used together with `EXT_clip_control(ZERO_TO_ONE)` and a
     * floating point depth buffer: because the depth values are stored directly in [0, 1]
     * (no `0.5 * ndc + 0.5` remap, which would otherwise wipe out the precision through
     * catastrophic cancellation), float density near 0 lines up with the far plane and yields a
     * near-uniform depth precision. Requires `gl.clearDepth(0)` and `gl.depthFunc(gl.GREATER)`.
     */
    public getProjectionMatrix(width: number, height: number, reverseZ = false): mat4 {
        const aspect = width / height;

        if (!reverseZ) {
            //standard projection (clip depth [-1, 1], near -> -1, far -> +1)
            switch (this.type) {
                case CameraType.PERSPECTIVE:
                    return mat4.perspective(mat4.create(),
                        this.fov * Math.PI / 180.0,
                        aspect,
                        this.near,
                        this.far);
                case CameraType.ORTHOGONAL:
                    const h = this.height;
                    const w = h * aspect;
                    return mat4.ortho(mat4.create(), w / -2, w / 2, h / -2, h / 2,
                        this.near,
                        this.far);
                default:
                    throw new Error('Undefined camera type');
            }
        }

        //reversed-Z projection with clip depth in [0, 1] (near -> 1, far -> 0), for ZERO_TO_ONE clip control
        const n = this.near;
        const f = this.far;
        switch (this.type) {
            case CameraType.PERSPECTIVE: {
                const fy = 1.0 / Math.tan((this.fov * Math.PI / 180.0) / 2.0);
                // column-major: clip.z = n/(f-n) * z_eye + n*f/(f-n), clip.w = -z_eye
                return mat4.fromValues(
                    fy / aspect, 0, 0, 0,
                    0, fy, 0, 0,
                    0, 0, n / (f - n), -1,
                    0, 0, n * f / (f - n), 0
                );
            }
            case CameraType.ORTHOGONAL: {
                const oh = this.height;
                const ow = oh * aspect;
                const l = ow / -2, r = ow / 2, b = oh / -2, t = oh / 2;
                // column-major: clip.z = 1/(f-n) * z_eye + f/(f-n), clip.w = 1
                return mat4.fromValues(
                    2 / (r - l), 0, 0, 0,
                    0, 2 / (t - b), 0, 0,
                    0, 0, 1 / (f - n), 0,
                    -(r + l) / (r - l), -(t + b) / (t - b), f / (f - n), 1
                );
            }
            default:
                throw new Error('Undefined camera type');
        }
    }
}

/**
 * @category Core
 */
export enum CameraType {
    PERSPECTIVE = 0,
    ORTHOGONAL = 1
}
