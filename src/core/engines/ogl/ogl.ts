/*
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE.md for details)

  (c) 2024 Nokia
  Licensed under the MIT License
  SPDX-License-Identifier: MIT
*/

import { Camera, Euler, GLTFLoader, Mat4, Raycast, Renderer, Transform, Vec2, AxesHelper, Mesh, Plane, Geometry, Polyline, Color, type OGLRenderingContext, Program, Quat, Vec3 } from 'ogl';
import { createGltfProgram } from '@core/engines/ogl/oglGltfHelper';
import { loadLogoTexture, createLogoProgram } from '@core/engines/ogl/oglLogoHelper';

import {
    createAxesBoxPlaceholder,
    createModel,
    createProgram,
    createRandomObjectDescription,
    createWaitingProgram,
    getAxes,
    getDefaultMarkerObject,
    getDefaultPlaceholder,
    getExperiencePlaceholder,
    PRIMITIVES,
} from '@core/engines/ogl/modelTemplates';

import {
    convertAugmentedCityCam2WebQuat,
    convertAugmentedCityCam2WebVec3,
    convertGeo2WebVec3,
    convertWeb2GeoVec3,
    convertGeodeticToEnu,
    getRelativeGlobalPosition,
    getRelativeOrientation,
    toDegrees,
    convertWeb2GeoQuat,
    convertGeo2WebQuat,
    convertEnuToGeodetic,
} from '@core/locationTools';

import { printOglTransform, checkGLError } from '@core/devTools';

import { quat, vec3 } from 'gl-matrix';
import type { ObjectDescription, Orientation, Position, ValueOf } from '../../../types/xr';
import type { Geopose } from '@oarc/scd-access';

let gl: OGLRenderingContext;
let renderer: Renderer;
let lastRenderTime = 0;
let scene: Transform;
let camera: Camera;
let axesHelper;
let updateHandlers: Record<string, () => number> = {};
let eventHandlers: Record<string, { model: Mesh; handler: () => void }> = {};
let uniforms = { time: [] as Mesh<Geometry, Program>[] };
let _geo2ArTransformNode: Transform;
let _ar2GeoTransformNode: Transform;
let _globalImagePose: Geopose;
let _localImagePose: { position: Position; orientation: Orientation };
let experimentTapHandler: null | ((e: { x: number; y: number }) => void) = null;

/**
 * Implementation of the 3D features required by sparcl using ogl.
 * https://github.com/oframe/ogl
 */
export default class ogl {
    /**
     * Initialize ogl for use with WebXR.
     */
    init() {
        renderer = new Renderer({
            alpha: true,
            canvas: document.querySelector('#application') as HTMLCanvasElement,
            dpr: window.devicePixelRatio,
            webgl: 2,
        });

        gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);

        scene = new Transform();

        this.setupEnvironment(gl);

        window.addEventListener('resize', () => this.resize(), false);
        this.resize();

        document.addEventListener('click', this._handleEvent);

        checkGLError(gl, 'OGL init end');
    }

    /**
     * Set up the 3D environment as required according to the current real environment.*
     */
    setupEnvironment(gl: OGLRenderingContext) {
        camera = new Camera(gl);
        camera.position.set(0, 0, 0);

        // TODO: Add light
        // TODO: Use environmental lighting?!
    }

    /**
     * Add a general placeholder to the scene.
     *
     * @param keywords  string        Defines the kind of placeholder to create
     * @param position  number{x, y, z}        3D position of the placeholder
     * @param orientation  number{x, y, z, w}     Orientation of the placeholder
     * @returns {Transform}
     */
    addPlaceholder(keywords: string | string[] | undefined, position: Position, orientation: Orientation) {
        const placeholder = getDefaultPlaceholder(gl);

        placeholder.position.set(position.x, position.y, position.z);
        placeholder.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        placeholder.setParent(scene);

        return placeholder;
    }

    /**
     * Create random object for experiments.
     *
     * @param shape  String      Defines the shape to create
     * @param position  number{x, y, z}        3D position of the placeholder
     * @param orientation  number{x, y, z, w}     Orientation of the placeholder
     * @param fragmentShader  String        Fragment-Shader to add to program
     * @param options  Object       Defines additional options for the shape to add
     */
    addPlaceholderWithOptions(shape: ValueOf<typeof PRIMITIVES>, position: Position, orientation: Orientation, fragmentShader: string, options: any = {}) {
        const placeholder = createModel(gl, shape, [Math.random(), Math.random(), Math.random(), 1], false, options);

        placeholder.position.set(position.x, position.y, position.z);
        placeholder.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        placeholder.setParent(scene);

        placeholder.program = createProgram(gl, {
            fragment: fragmentShader,
            uniforms: {
                uTime: { value: 0.0 },
            },
        });

        uniforms.time[placeholder.id] = placeholder;

        return placeholder;
    }

    /**
     * Add 3D model of format gltf to the scene.
     *
     * @param position  number{x, y, z}        3D position of the placeholder
     * @param orientation  number{x, y, z, w}     Orientation of the placeholder
     * @param url  String       URL to load the model from
     * @returns {Transform}
     */
    addModel(position: Position, orientation: Orientation, url: string) {
        const gltfScene = new Transform();
        gltfScene.position.set(position.x, position.y, position.z);
        gltfScene.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        gltfScene.setParent(scene);

        console.log('Loading ' + url);
        GLTFLoader.load(gl, url)
            .then((gltf) => {
                const s = gltf.scene || gltf.scenes[0];
                s.forEach((root) => {
                    root.setParent(gltfScene);
                    root.traverse((node) => {
                        if ((node as any).program) {
                            // HACK: the types suggest that program cannot exist on node. If this is true this if block should be removed altogether. If it's not true, PR needs to be created to update the ogl types.
                            (node as any).program = createGltfProgram(node);
                        }
                    });
                });
                scene.updateMatrixWorld();
            })
            .catch(() => {
                console.log('Unable to load model from URL: ' + url);
                console.log('Adding placeholder box instead');
                let gltfPlaceholder = createAxesBoxPlaceholder(gl, [1.0, 0.0, 0.0, 0.5], false); // red
                gltfScene.addChild(gltfPlaceholder);
                scene.updateMatrixWorld();
            });

        scene.updateMatrixWorld();
        return gltfScene;
    }

    /**
     * Add placeholder for loadable scene.
     *
     * Indicates visually that the placeholder can load a scene.
     *
     * @param position  number{x, y, z}        3D position of the placeholder
     * @param orientation  number{x, y, z, w}     Orientation of the placeholder
     */
    addExperiencePlaceholder(position: Position, orientation: Orientation): Mesh {
        const placeholder = getExperiencePlaceholder(gl);

        placeholder.position.set(position.x, position.y, position.z);
        placeholder.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        placeholder.setParent(scene);

        updateHandlers[placeholder.id] = () => (placeholder.rotation.y += 0.01);

        return placeholder;
    }

    /**
     * Add object to be placed on top of marker image.
     *
     * Used for some experiments before, not currently used.
     * How to properly handle markers is undecided.
     *
     * @returns {Transform}
     */
    addMarkerObject() {
        const object = getDefaultMarkerObject(gl);
        object.setParent(scene);
        return object;
    }

    /**
     * Add reticle to display successful hit test location.
     *
     * @returns {Transform}
     */
    addReticle() {
        return this.addModel({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, '/media/models/reticle.gltf');
    }

    isHorizontal(object: { quaternion: Quat }) {
        const euler = new Euler().fromQuaternion(object.quaternion);
        return Math.abs(euler.x) < Number.EPSILON;
    }

    /**
     * Create object with random shape, color, size and add it to the scene at the given pose
     *
     * @param position  number{x, y, z}        3D position of the object
     * @param orientation  number{x, y, z, w}     Orientation of the object
     * @returns {Mesh}
     */
    addRandomObject(position: Position, orientation: Orientation) {
        let object_description = createRandomObjectDescription();
        return this.addObject(position, orientation, object_description);
    }

    /**
     * Create object with given properties at the given pose
     *
     * @param position  number{x, y, z}        3D position of the object
     * @param orientation  number{x, y, z, w}     Orientation of the object
     * @param object_description  {*}
     * @returns {Mesh}
     */
    addObject(position: Position, orientation: Orientation, object_description: ObjectDescription) {
        console.log('OGL addObject: ' + object_description);
        const mesh = createModel(gl, object_description.shape, object_description.color, object_description.transparent, object_description.options, object_description.scale);
        mesh.position.set(position.x, position.y, position.z);
        mesh.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        scene.addChild(mesh);
        return mesh;
    }

    /**
     * Updates the marker object according the provided position and orientation.
     *
     * Called when marker movement was detected, for example.
     *
     * @param object  Mesh      The marker object
     * @param position  number{x, y, z}        3D position of the placeholder
     * @param orientation  number{x, y, z, w}     Orientation of the placeholder
     */
    updateMarkerObjectPosition(object: Mesh, position: Position, orientation: Orientation) {
        object.position.set(position.x, position.y, position.z);
        object.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    }

    /**
     * Update the position of the reticle to the provided position and orientation.
     *
     * @param reticle  Transform        The reticle to display
     * @param position  Ved3       The position to move the reticle to
     * @param orientation  Quaternion       The rotation to apply to the reticle
     */
    updateReticlePose(reticle: Transform, position: Position, orientation: Orientation) {
        reticle.position.set(position.x, position.y, position.z);
        reticle.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    }

    /**
     * Add x, y, z axes to visualize them during development.
     */
    addAxes() {
        const axes = getAxes(gl);
        axes.position.set(0, 0, 0);
        axes.setParent(scene);
    }

    /**
     * Make the provided model clickable.
     *
     * @param model  Mesh       The model to make interactive
     * @param handler  function     The function to execute after interaction
     */
    addClickEvent(model: Mesh, handler: () => void) {
        eventHandlers[model.id] = {
            model,
            handler,
        };
    }

    /**
     * Calculates the camera pose to send to scenes loaded into the iframe.
     *
     * @param view  XRView      The current view
     * @param experienceMatrix  Mat4        The matrix of the experience in WebR space
     * @returns {{camerapose: Mat4, projection: Mat4}}
     */
    getExternalCameraPose(view: XRView, experienceMatrix: Mat4) {
        const cameraMatrix = new Mat4();
        // TODO: make sure that fromArray understands matrix in correct order
        cameraMatrix.copy(experienceMatrix).inverse().multiply(new Mat4().fromArray(view.transform.matrix));

        return {
            projection: view.projectionMatrix,
            camerapose: cameraMatrix,
        };
    }

    /**
     * Allows to set the zero point of the scene.
     *
     * Used by WebXR when the WebXR anchor the scene is added to changes.
     *
     * @returns {function}
     */
    getRootSceneUpdater() {
        return (matrix: number[]) => (scene.matrix = new Mat4().fromArray(matrix));
    }

    /**
     * Adds a visual queue to the provided model to indicate its state.
     *
     * For example to indicate it is interactive.
     *
     * @param model     The model to change
     */
    setWaiting(model: Mesh) {
        model.program = createWaitingProgram(gl, [1, 1, 0], [0, 1, 0]);
        uniforms.time[model.id] = model;
    }

    /**
     * Registers a general tap handler. Gets called when no hits where found for a tap.
     *
     * Currently exclusively for experiments. Don't use otherwise.
     *
     * @param callback  Function        The function to call
     */
    setExperimentTapHandler(callback: (e: { x: number; y: number }) => void) {
        experimentTapHandler = callback;
    }

    /**
     * Resize the canvas to full screen.
     */
    resize() {
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.perspective({ aspect: gl.canvas.width / gl.canvas.height, near: 0.01, far: 1000 });
    }

    /**
     * Removes the provided model from the scene and all the handlers it mit be registered with.
     *
     * @param model     The model to remove
     */
    remove(model: Mesh) {
        // TODO: this assumes that all objects are children of the root node!
        // We should call something like model.parent.removeChild(model);
        scene.removeChild(model);

        delete updateHandlers[model.id];
        delete eventHandlers[model.id];
    }

    /**
     *  Removes all objects from the scene
     */
    clearScene() {
        while (scene.children.length > 0) {
            let child: Transform | null = scene.children[0];
            scene.removeChild(child);
            child = null;
        }
    }

    /**
     * 3D engine isn't needed anymore.
     */
    stop() {
        window.removeEventListener('resize', this.resize, false);
        experimentTapHandler = null;
    }

    /**
     * This recursively updates the whole scene graph after all SCRs are placed
     */
    updateMatrixWorld() {
        scene.updateMatrixWorld(true);
    }

    /**
     * Render loop.
     *
     * @param time  Number      Provided by WebXR
     * @param view  XRView      Provided by WebXR
     */
    render(time: number, view: XRView) {
        checkGLError(gl, 'OGL render() begin');

        const position = view.transform.position;
        const orientation = view.transform.orientation;

        // TODO: make sure that fromArray understands matrix in correct order
        camera.projectionMatrix.copy(new Mat4().fromArray(view.projectionMatrix));
        camera.position.set(position.x, position.y, position.z);
        camera.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);

        Object.values(updateHandlers).forEach((handler) => handler());

        const relTime = time - lastRenderTime;
        lastRenderTime = time;
        uniforms.time.forEach((model) => (model.program.uniforms.uTime.value = time * 0.001)); // Time in seconds

        renderer.render({ scene, camera });

        checkGLError(gl, 'OGL render() end');
    }

    /**
     * @private
     * Event handler for interactive objects.
     *
     * Handles currently taps on 3D objects.
     * Handles temporarily also taps on floor.
     *
     * @param event  Event      Javascript event object
     */
    _handleEvent(event: { x: number; y: number }) {
        const mouse = new Vec2();
        mouse.set(2.0 * (event.x / renderer.width) - 1.0, 2.0 * (1.0 - event.y / renderer.height) - 1.0);

        const raycast = new Raycast();
        raycast.castMouse(camera, mouse);

        const eventMeshes = Object.values(eventHandlers).map((handler) => handler.model);
        const hits = raycast.intersectBounds(eventMeshes);

        // if an OGL object is hit, execute its handler
        hits.forEach((hit) => {
            eventHandlers[hit.id].handler();
        });

        // if no OGL object is hit, forward the event to the base tap handler
        if (hits.length === 0 && experimentTapHandler) {
            experimentTapHandler(event);
        }
    }

    /**
     * This method calculates the transformations between the Geo coordinate system and the current WebXR session
     * based on a pair of (localImagePose, globalImagePose) that belong to the same photo.
     * @param {*} localImagePose The local pose of the photo
     * @param {*} globalImagePose The global pose of the photo
     */
    updateGeoAlignment(localImagePose: { orientation: Orientation; position: Position }, globalImagePose: Geopose) {
        // NOTE:
        // The GeoPose location coordinates are in local tangent plane (LTP) approximation, in
        // East-North-Up (ENU) right-handed coordinate system
        // https://en.wikipedia.org/wiki/Local_tangent_plane_coordinates
        // The GeoPose orientation is ENU (but it used to be WebXR (Y up) in the previous version)

        // The WebXR (and OGL Renderer's scene) coordinate system has its origin where the AR session started,
        // and uses a Y up right-handed coordinate system.

        // We receive the GeoPose of the camera and the GeoPoses of objects, plus the local pose of the camera in the WebXR coordinate system.
        // We want to place the objects in the WebXR coordinate system, and we know the position of the objects relative to the camera.
        // The basic idea is the following:
        // 1. calculate the relative displacement between camera and object in Geo coordinate system (LTP approximation East-North-Up)
        // 2. convert relative displacement from Geo (right handed, Z up) to WebXR/GLEngine (right handed, Y up).
        // 3. OLD AC API:
        //      calculate the _relative_ rotation between the camera in local and the camera in global coordinate system (both orientations were given in WebXR coordinates).
        //    NEW AC API:
        //      stay in the ENU system, just take the ENU quaternion but rotate it by additional -90 around UP so that the camera orientation is measured w.r.t North instead of East.
        //      Next, swap the axes from ENU to match the WebXR axes. No relative calculations needed.
        // 4. We create a new scene node, which will represent the camera in the Geo system.
        // 5. For all objects, we create a scene node and append the relative transformation (calculated in the Geo system) between camera and object as child of the camera node.
        // 6. We rotate the camera node to match the WebXR coordinate system
        // 7. We translate the camera node to the local camera pose.
        // (It is unsure whether and how we need to take into account the photo's portrait/landscape orientation, and similary the UI orientation, and the camera sensor orientation)

        let localImageOrientation = quat.fromValues(localImagePose.orientation.x, localImagePose.orientation.y, localImagePose.orientation.z, localImagePose.orientation.w);

        // We add the AR Camera for visualization
        // this represents the camera in the WebXR coordinate system
        let arCamNode = new Transform(); // This is a virtual node at the local camera pose where the photo was taken
        scene.addChild(arCamNode);
        let arCamSubNode = createAxesBoxPlaceholder(gl, [1, 1, 0, 0.5], false); // yellow
        arCamSubNode.scale.set(0.02, 0.04, 0.06);
        arCamSubNode.position.set(0.001, 0.001, 0.001); // tiny offset so that we can see both the yellow and the cyan when the alignment is correct
        arCamNode.addChild(arCamSubNode);
        arCamNode.position.set(localImagePose.position.x, localImagePose.position.y, localImagePose.position.z);
        arCamNode.quaternion.set(localImagePose.orientation.x, localImagePose.orientation.y, localImagePose.orientation.z, localImagePose.orientation.w);

        _geo2ArTransformNode = new Transform();
        scene.addChild(_geo2ArTransformNode);
        _geo2ArTransformNode.position.set(0, 0, 0);
        _geo2ArTransformNode.quaternion.set(0, 0, 0, 1);

        // DEBUG: place GeoPose of camera as a content entry with full orientation
        // this should appear exactly where the picture was taken, with the same orientation of the camera in the world
        let geoCamNode = createAxesBoxPlaceholder(gl, [0, 1, 1, 0.5], false); // cyan
        _geo2ArTransformNode.addChild(geoCamNode);
        geoCamNode.scale.set(0.02, 0.04, 0.06);
        let geoCamRelativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose); // will be (0,0,0)
        geoCamRelativePosition = convertAugmentedCityCam2WebVec3(geoCamRelativePosition); // convert from AC to WebXR
        geoCamNode.position.set(geoCamRelativePosition[0], geoCamRelativePosition[1], geoCamRelativePosition[2]); // from vec3 to Vec3
        let globalImagePoseQuaternion = quat.fromValues(globalImagePose.quaternion.x, globalImagePose.quaternion.y, globalImagePose.quaternion.z, globalImagePose.quaternion.w);
        let geoCamOrientation = convertAugmentedCityCam2WebQuat(globalImagePoseQuaternion); // convert from AC to WebXR
        geoCamNode.quaternion.set(geoCamOrientation[0], geoCamOrientation[1], geoCamOrientation[2], geoCamOrientation[3]);

        // DEBUG: place GeoPose of camera as a content entry with zero orientation
        // this should appear exactly where the picture was taken, but oriented according to the Geo axes.
        let geoCoordinateSystemNode = createAxesBoxPlaceholder(gl, [1, 1, 1, 0.5]); // white
        _geo2ArTransformNode.addChild(geoCoordinateSystemNode);
        geoCoordinateSystemNode.scale.set(0.02, 0.04, 0.06);
        let geoCoordinateSystemRelativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose); // will be (0,0,0)
        geoCoordinateSystemRelativePosition = convertGeo2WebVec3(geoCoordinateSystemRelativePosition); // convert from Geo to WebXR
        geoCoordinateSystemNode.position.set(geoCoordinateSystemRelativePosition[0], geoCoordinateSystemRelativePosition[1], geoCoordinateSystemRelativePosition[2]); // from vec3 to Vec3
        geoCoordinateSystemNode.quaternion.set(0, 0, 0, 1); // neutral orientation

        let deltaRotAr2Geo = getRelativeOrientation(localImageOrientation, geoCamOrientation); // WebXR to Geo
        let deltaRotGeo2Ar = quat.create(); // Geo to WebXR
        quat.invert(deltaRotGeo2Ar, deltaRotAr2Geo);

        _globalImagePose = globalImagePose;
        _localImagePose = localImagePose;

        // rotate around the origin by the rotation that brings the Geo system to the WebXR system
        _geo2ArTransformNode.quaternion.set(deltaRotGeo2Ar[0], deltaRotGeo2Ar[1], deltaRotGeo2Ar[2], deltaRotGeo2Ar[3]); // from quat to Quat
        // translate to the camera position
        _geo2ArTransformNode.position.x = _geo2ArTransformNode.position.x + localImagePose.position.x;
        _geo2ArTransformNode.position.y = _geo2ArTransformNode.position.y + localImagePose.position.y;
        _geo2ArTransformNode.position.z = _geo2ArTransformNode.position.z + localImagePose.position.z;
        _geo2ArTransformNode.updateMatrix();
        _geo2ArTransformNode.updateMatrixWorld(true);

        _ar2GeoTransformNode = new Transform();
        scene.addChild(_ar2GeoTransformNode);
        // [R|t]^{-1} = [R^{T} | -R^{T} * t]
        // there is no matrix-vector multiplication in OGL :( Therefore we do the pose inversion directly with matrices
        _ar2GeoTransformNode.matrix.inverse(_geo2ArTransformNode.matrix);
        _ar2GeoTransformNode.decompose();
        _ar2GeoTransformNode.updateMatrixWorld(true);

        //printOglTransform("_geo2ArTransformNode", _geo2ArTransformNode);
        //printOglTransform("_ar2GeoTransformNode", _ar2GeoTransformNode);
    }

    /**
     * This adds a spatial content record (SCR) to the scene at a given GeoPose
     * @param {*} globalObjectPose GeoPose of the content
     * @param {*} content The content entry
     */
    addSpatialContentRecord(globalObjectPose: Geopose) {
        const object = createAxesBoxPlaceholder(gl, [0.7, 0.7, 0.7, 1.0]); // gray

        // calculate relative position w.r.t the camera in ENU system
        let relativePosition = getRelativeGlobalPosition(_globalImagePose, globalObjectPose);
        relativePosition = convertGeo2WebVec3(relativePosition);
        // set _local_ transformation w.r.t parent _geo2ArTransformNode
        object.position.set(relativePosition[0], relativePosition[1], relativePosition[2]); // from vec3 to Vec3
        // set the objects' orientation as in the GeoPose response, that is already in ENU
        object.quaternion.set(globalObjectPose.quaternion.x, globalObjectPose.quaternion.y, globalObjectPose.quaternion.z, globalObjectPose.quaternion.w);

        // now rotate and translate it into the local WebXR coordinate system by appending it to the transformation node
        _geo2ArTransformNode.addChild(object);
        object.updateMatrixWorld(true);
    }

    /**
     * This recursively updates the world matrices in the whole scene graph
     */
    updateSceneGraphTransforms() {
        scene.updateMatrixWorld(true);
    }

    convertGeoPoseToLocalPose(geoPose: Geopose) {
        if (_geo2ArTransformNode === undefined) {
            throw 'No localization has happened yet!';
        }

        // First, assemble an ENU pose
        let transform = new Transform();
        // position as displacement relative to the last known global camera positision
        const enuPosition = getRelativeGlobalPosition(_globalImagePose, geoPose);
        const webxrEnuPosition = convertGeo2WebVec3(enuPosition);
        transform.position.set(webxrEnuPosition[0], webxrEnuPosition[1], webxrEnuPosition[2]);

        // The geoPose orientation is given in ENU, but we must convert the directions to WebXR first
        const enuQuaternion = [geoPose.quaternion.x, geoPose.quaternion.y, geoPose.quaternion.z, geoPose.quaternion.w] as const;
        const webxrEnuQuaternion = convertGeo2WebQuat(enuQuaternion); // conversion from ENU axes to WebXR axes, but keep the orientation
        transform.quaternion.set(webxrEnuQuaternion[0], webxrEnuQuaternion[1], webxrEnuQuaternion[2], webxrEnuQuaternion[3]);

        // Then convert the ENU pose to local pose
        _geo2ArTransformNode.addChild(transform);
        _geo2ArTransformNode.updateMatrixWorld(true);
        let localPose = new Transform();
        localPose.matrix = transform.worldMatrix; // we need to take out the world matrix instead of the local node transform
        localPose.decompose(); // this fills all other internal entries based on the internal matrix
        _geo2ArTransformNode.removeChild(transform);

        return localPose;
    }

    convertLocalPoseToGeoPose(position: Vec3, quaternion: Quat) {
        if (_ar2GeoTransformNode === undefined) {
            throw 'No localization has happened yet!';
        }

        let localPose = new Transform();
        localPose.position = position;
        localPose.quaternion = quaternion;
        localPose.updateMatrix();
        _ar2GeoTransformNode.addChild(localPose);
        _ar2GeoTransformNode.updateMatrixWorld();

        let webxrEnuPose = new Transform(); // this will be still with WebXR axes but already aligned with ENU
        webxrEnuPose.matrix = localPose.worldMatrix;
        webxrEnuPose.decompose();
        _ar2GeoTransformNode.removeChild(localPose);

        const webxrEnuPosition = vec3.fromValues(webxrEnuPose.position.x, webxrEnuPose.position.y, webxrEnuPose.position.z);
        const enuPosition = convertWeb2GeoVec3(webxrEnuPosition); // conversion from WebXR axes to ENU axes
        const dE = enuPosition[0];
        const dN = enuPosition[1];
        const dU = enuPosition[2];

        const refGeoPose = _globalImagePose;
        const geodetic = convertEnuToGeodetic(dE, dN, dU, refGeoPose.position.lat, refGeoPose.position.lon, refGeoPose.position.h);

        // TODO: double-check how to swap orientation axes
        const webxrEnuQuaternion = quat.fromValues(webxrEnuPose.quaternion.x, webxrEnuPose.quaternion.y, webxrEnuPose.quaternion.z, webxrEnuPose.quaternion.w);
        const enuQuaternion = convertWeb2GeoQuat(webxrEnuQuaternion);

        const geoPose = {
            position: {
                lat: geodetic.lat,
                lon: geodetic.lon,
                h: geodetic.h,
            },
            quaternion: {
                x: enuQuaternion[0],
                y: enuQuaternion[1],
                z: enuQuaternion[2],
                w: enuQuaternion[3],
            },
        };
        return geoPose;
    }

    /**
     * Converts a GeoPose object into East-North-Up coordinate system (local tangent plane approximation)
     * @param {*} geoPose GeoPose to convert
     * @param {*} refGeoPose reference GeoPose
     * @returns
     */
    geoPose_to_ENU(geoPose: Geopose, refGeoPose: Geopose) {
        let enuPosition = convertGeodeticToEnu(geoPose.position.lat, geoPose.position.lon, geoPose.position.h, refGeoPose.position.lat, refGeoPose.position.lon, refGeoPose.position.h);

        let enuPose = new Transform();
        enuPose.position.set(enuPosition.x, enuPosition.y, enuPosition.z);
        enuPose.quaternion.set(geoPose.quaternion.x, geoPose.quaternion.y, geoPose.quaternion.z, geoPose.quaternion.w);
        enuPose.updateMatrix();
        return enuPose;
    }
}
