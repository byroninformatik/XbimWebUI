import { Viewer } from "../viewer";
import { ProductIdentity } from "../common/product-identity";
import { vec3, mat4, vec2 } from "gl-matrix";

export class MouseNavigation {
    /**
     * Point on the ray from the camera through the pointer that lies as deep in the view as the reference point.
     * Falls back to the point straight ahead at that depth if the ray runs parallel to the image plane.
     */
    private static getPointerRayPoint(viewer: Viewer, event: MouseEvent, reference: vec3): vec3 {
        const eye = viewer.getCameraPosition();
        const viewDirection = vec3.normalize(vec3.create(), viewer.getCameraDirection());
        const depth = vec3.dot(vec3.subtract(vec3.create(), reference, eye), viewDirection);

        // unproject the pointer onto the near and the far plane; works for perspective and orthogonal cameras alike
        const rect = viewer.canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width * 2 - 1;
        const y = 1 - (event.clientY - rect.top) / rect.height * 2;
        const inverse = mat4.invert(mat4.create(), mat4.multiply(mat4.create(), viewer.pMatrix, viewer.mvMatrix));
        if (inverse != null) {
            const near = vec3.transformMat4(vec3.create(), [x, y, -1], inverse);
            const far = vec3.transformMat4(vec3.create(), [x, y, 1], inverse);
            const ray = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), far, near));
            const along = vec3.dot(ray, viewDirection);
            if (Math.abs(along) > 1e-6) {
                const t = (depth - vec3.dot(vec3.subtract(vec3.create(), near, eye), viewDirection)) / along;
                return vec3.scaleAndAdd(vec3.create(), near, ray, t);
            }
        }
        return vec3.scaleAndAdd(vec3.create(), eye, viewDirection, depth);
    }

    private static isInFront(viewer: Viewer, point: vec3): boolean {
        return vec3.transformMat4(vec3.create(), point, viewer.mvMatrix)[2] < 0;
    }

    /**
     * Pivot for a pointer over empty space without a usable last pivot: on the pointer ray, as deep as what is visible in the
     * centre of the view, or else as the model centre, which may lie far off in large or georeferenced models.
     * Null if there is nothing in the viewer.
     */
    private static getFallbackPivot(viewer: Viewer, event: MouseEvent): vec3 | null {
        let reference = viewer.getEventData(viewer.width / 2, viewer.height / 2)?.xyz;
        if (reference == null) {
            const region = viewer.getMergedRegion();
            if (region == null || region.centre == null) {
                return null;
            }
            reference = vec3.fromValues(region.centre[0], region.centre[1], region.centre[2]);
        }
        return MouseNavigation.getPointerRayPoint(viewer, event, reference);
    }

    public static initMouseEvents(viewer: Viewer) {
        let mouseDown = false;
        let lastMouseX = null;
        let lastMouseY = null;
        let startX = null;
        let startY = null;
        let button = 'L';
        let id = -1;
        let modelId = -1;
        let xyz: vec3 = null;
        let isPointerLocked = false;

        let origin = vec3.create();
        // last point hit under the pointer when orbiting or zooming; used where the pointer is over empty space
        let lastPivot: vec3 = null;
        // a pivot of a model that was unloaded, or from before another one came in, may lie where nothing is any more
        viewer.on('loaded', () => lastPivot = null);
        viewer.on('unloaded', () => lastPivot = null);

        //set initial conditions so that different gestures can be identified
        const handleMouseDown = (event: MouseEvent) => {
            mouseDown = true;
            lastMouseX = event.clientX;
            lastMouseY = event.clientY;
            startX = event.clientX;
            startY = event.clientY;

            //get coordinates within canvas (with the right orientation)
            let r = viewer.canvas.getBoundingClientRect();
            let viewX = startX - r.left;
            let viewY = viewer.height - (startY - r.top);

            //this is for picking
            const data = viewer.getEventData(viewX, viewY);
            if (data == null) {
                mouseDown = false;
                return;
            }

            id = data.id;
            modelId = data.model;
            xyz = data.xyz;

            if (viewer.navigationMode === 'locked-orbit') {
                origin = viewer.lockedOrbitOrigin;
            } else  if (data == null || data.id == null || data.model == null) {
                // nothing under the pointer: keep the last pivot, the model centre may be far away once zoomed in
                if (lastPivot != null && MouseNavigation.isInFront(viewer, lastPivot)) {
                    origin = lastPivot;
                } else {
                    origin = MouseNavigation.getFallbackPivot(viewer, event);
                    if (origin == null) {
                        // there is nothing in the viewer
                        mouseDown = false;
                        return;
                    }
                    // the next time the fallback needs no further pick
                    lastPivot = origin;
                }
            } else if (data.xyz == null) {
                const bb = viewer.getTargetBoundingBox(data.id, data.model);
                origin = vec3.fromValues(bb[0] + bb[3] / 2.0, bb[1] + bb[4] / 2.0, bb[2] + bb[5] / 2.0);
                lastPivot = origin;
            } else {
                origin = data.xyz
                lastPivot = vec3.clone(origin);
            }

            //keep information about the mouse button
            switch (event.button) {
                case 0:
                    button = 'left';
                    break;

                case 1:
                    button = 'middle';
                    break;

                case 2:
                    button = 'right';
                    break;

                default:
                    button = 'left';
                    break;
            }

            viewer.disableTextSelection();
        };

        const handleMouseUp = (event: MouseEvent) => {
            if (!mouseDown)
                return;

            mouseDown = false;

            const endX = event.clientX;
            const endY = event.clientY;

            const deltaX = Math.abs(endX - startX);
            const deltaY = Math.abs(endY - startY);

            //if it was a longer movement do not perform picking
            if (deltaX < 3 && deltaY < 3 && button === 'left') {

                /**
                * Occurs when user click on model.
                *
                * @event Viewer#pick
                * @type {object}
                * @param {Number} id - product ID of the element or null if there wasn't any product under mouse
                * @param {Number} model - Model ID
                * @param {MouseEvent} event - Original HTML event
                */
                viewer.fire('pick', { id: id, model: modelId, event: event, xyz: xyz });
                // Handle double-click
                let time = (new Date()).getTime();
                if (time - timer < 250) {
                    viewer.fire('dblclick', { id: id, model: modelId, event: event, xyz: xyz });
                }
                timer = time;
            }

            viewer.enableTextSelection();
        };


        var handleLookAround = (event: MouseEvent) => {
            const sensitivity = 0.5;
            if (viewer.navigationMode !== 'walk') {
                return;
            }

            viewer.navigate('look-at', event.movementX * sensitivity, event.movementY * sensitivity, origin);

        };

        var handleMouseMove = (event: MouseEvent) => {

            const isCanvasOurTarget = event.target instanceof HTMLCanvasElement;

            if (viewer.hoverPickEnabled && !mouseDown && viewer.navigationMode !== 'walk' && isCanvasOurTarget) {

                //get coordinates within canvas (with the right orientation)
                let r = viewer.canvas.getBoundingClientRect();
                let viewX = event.clientX - r.left;
                let viewY = viewer.height - (event.clientY - r.top);
                const data = viewer.getEventData(viewX, viewY);

                viewer.setHoverPick(data.id, data.model);
                viewer.fire('hoverpick', { id: data.id, model: data.model, event: event, xyz: data.xyz });
            }

            if(!isCanvasOurTarget)
            {
                viewer.setHoverPick(undefined, undefined);
            }
            
            if (!mouseDown) {
                return;
            }

            if (viewer.navigationMode === 'none') {
                return;
            }

            var newX = event.clientX;
            var newY = event.clientY;

            var deltaX = newX - lastMouseX;
            var deltaY = newY - lastMouseY;

            lastMouseX = newX;
            lastMouseY = newY;

            if (button === 'left') {
                if (event.shiftKey) {
                    viewer.navigate('pan', deltaX, deltaY, origin);
                } else {
                    switch (viewer.navigationMode) {
                        case 'free-orbit':
                            viewer.navigate('free-orbit', deltaX, deltaY, origin);
                            break;

                        case 'locked-orbit':
                            viewer.navigate('locked-orbit', deltaX, deltaY, origin);
                        case 'fixed-orbit':
                        case 'orbit':
                            viewer.navigate('orbit', deltaX, deltaY, origin);
                            break;

                        case 'pan':
                            viewer.navigate('pan', deltaX, deltaY, origin);
                            break;

                        case 'zoom':
                            viewer.navigate('zoom', deltaX, deltaY, origin);
                            break;

                        case 'look-around':
                            viewer.navigate('look-around', deltaX, deltaY, origin);
                            break;

                        default:
                            break;
                    }
                }
            }
            if (button === 'middle' || button === 'right') {
                viewer.navigate('pan', deltaX, deltaY, origin);
            }

        };

        let scrollOrigin: vec3 = null;
        let lastScrollPoint: vec2 = null;
        let scrollCounter = 0;
        var handleMouseScroll = (event: WheelEvent) => {
            try {
                if (viewer.navigationMode === 'none') {
                    return;
                }
                if (event.stopPropagation) {
                    event.stopPropagation();
                }
                if (event.preventDefault) {
                    event.preventDefault();
                }
    
                scrollCounter++;
                const scrollPoint = vec2.fromValues(event.clientX, event.clientY);
                if (lastScrollPoint == null || vec2.dist(lastScrollPoint, scrollPoint) > 5 || scrollCounter > 10) {
                    scrollOrigin = viewer.getInteractionOrigin(event);
                    
                    if (scrollOrigin != null) {
                        lastPivot = vec3.clone(scrollOrigin);
                    } else if (lastPivot != null && MouseNavigation.isInFront(viewer, lastPivot)) {
                        // nothing under the pointer: zoom towards the point on the pointer ray at the depth of the last pivot
                        scrollOrigin = MouseNavigation.getPointerRayPoint(viewer, event, lastPivot);
                    } else {
                        // remembered, so that the next recompute needs no further pick
                        scrollOrigin = lastPivot = MouseNavigation.getFallbackPivot(viewer, event);
                    }
    
                    lastScrollPoint = scrollPoint;
                    scrollCounter = 0;
                } 
                
    
                var sign = (x: any) => {
                    x = +x; // convert to a number
                    if (x === 0 || isNaN(x)) {
                        return x;
                    }
                    return x > 0 ? 1 : -1;
                };
    
                //deltaX and deltaY have very different values in different web browsers so fixed value is used for constant functionality.
                viewer.navigate('zoom', sign(event.deltaX) * -1.0, sign(event.deltaY) * -viewer.wheelZoomSpeed, scrollOrigin);
            } catch(e){
                console.error(e);
            }
        };

        // handle mouse movements when using PointerLock mode.
        var handlePointerLockChange = (event: Event) => {
            const lockElement = document.pointerLockElement as HTMLElement;
            if (lockElement === viewer.canvas) {
                if (!isPointerLocked) {
                    isPointerLocked = true;
                    viewer.canvas.addEventListener('mousemove', handleLookAround, false);
                }
            } else {
                isPointerLocked = false;
                viewer.canvas.removeEventListener("mousemove", handleLookAround, false);
            }
        };

        // handle pointer lock for walk mode to grab the mouse movement data
        let requestPointerLock = viewer.canvas.requestPointerLock as () => void;
        if (requestPointerLock != null) {
            requestPointerLock = requestPointerLock.bind(viewer.canvas) as () => void;
            viewer.canvas.onclick = () => {
                if (viewer.navigationMode === 'walk' && !isPointerLocked) {
                    requestPointerLock();
                }
            };
        }

        document.addEventListener('pointerlockchange', handlePointerLockChange, false);

        var timer = 0;
        //attach callbacks
        viewer.canvas.addEventListener('mousedown', (event) => handleMouseDown(event), true);
        viewer.canvas.addEventListener('wheel', (event) => handleMouseScroll(event), true);
        window.addEventListener('mouseup', (event) => handleMouseUp(event), true);
        window.addEventListener('mousemove', (event) => handleMouseMove(event), true);
    }
}