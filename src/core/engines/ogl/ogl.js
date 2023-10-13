/*
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
*/

import {Camera, Euler, GLTFLoader, Mat4, Raycast, Renderer, Transform, Vec2, AxesHelper, Mesh, Plane, Geometry} from 'ogl';
import {createGltfProgram, createSimpleGltfProgram} from '@core/engines/ogl/oglGltfHelper';
import {createSimplePointCloudProgram, MyPLYLoader} from '@core/engines/ogl/oglPlyHelper';
import {loadLogoTexture, createLogoProgram} from '@core/engines/ogl/oglLogoHelper';

import {createAxesBoxPlaceholder, createModel, createProgram, createRandomObjectDescription, createWaitingProgram,
    getAxes, getDefaultMarkerObject, getDefaultPlaceholder, getExperiencePlaceholder, PRIMITIVES} from '@core/engines/ogl/modelTemplates';

import {convertAugmentedCityCam2WebQuat, convertAugmentedCityCam2WebVec3, convertGeo2WebVec3, convertWeb2GeoVec3,
    geodetic_to_enu, getEarthRadiusAt, getRelativeGlobalPosition, getRelativeOrientation, toDegrees, convertWeb2GeoQuat, convertGeo2WebQuat, convertEnuToGeodetic} from '@core/locationTools';

import {printOglTransform, checkGLError} from '@core/devTools';

import {quat, vec3} from 'gl-matrix';

let gl, renderer;
let lastRenderTime = 0;
let scene, camera, axesHelper;
let updateHandlers = {}, eventHandlers = {};
let uniforms = { time: []};
let _geo2ArTransformNode;
let _ar2GeoTransformNode;
let _globalImagePose;
let _localImagePose;
let experimentTapHandler = null;

let dynamic_objects_descriptions = {};
let dynamic_objects_meshes = {};

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
            canvas: document.querySelector('#application'),
            dpr: window.devicePixelRatio,
            webgl: 2
        });

        gl = renderer.gl;
        gl.clearColor(0, 0, 0, 0);

        scene = new Transform();

        this.setupEnvironment(gl);

        window.addEventListener('resize', () => this.resize(gl), false);
        this.resize();

        document.addEventListener('click', this._handleEvent);

        checkGLError(gl, "OGL init end");
    }

    /**
     * Set up the 3D environment as required according to the current real environment.*
     */
    setupEnvironment(gl) {
        camera = new Camera(gl);
        camera.position.set(0, 0, 0);

        // Visualize axes
        axesHelper = new AxesHelper(gl, { size: 1, symmetric: false });
        axesHelper.setParent(scene);

        // Our camera images are captured into texture 0, and therefore the first loaded textured object (that normally gets text id 0)
        // in the scene sometimes is painted not from its own texture but from the camera image texture.
        // To overcome this problem, we create an OGL texture here which we will never use but it reserves ID 0 in view of OGL.
        loadLogoTexture(gl, "/media/icons/icon_x48.png")
            .then((texture) => {
                console.log("DUmmy TEXID: " + texture.id);
                const dummyProgram = createLogoProgram(gl, texture);
                const dummyGeometry = new Plane(gl, {width:0.1, height: 0.1});
                const dummyMesh = new Mesh(gl, {
                    geometry: dummyGeometry,
                    program: dummyProgram,
                    frustumCulled: false
                })
                dummyMesh.setParent(scene);
            });

        // TODO: Add light
        // TODO: Use environmental lighting?!
    }

    /**
     * Add a general placeholder to the scene.
     *
     * @param keywords  string[]        Defines the kind of placeholder to create
     * @param position  number{x, y, z}        3D position of the placeholder
     * @param orientation  number{x, y, z, w}     Orientation of the placeholder
     * @returns {Transform}
     */
    addPlaceholder(keywords, position, orientation) {
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
    addPlaceholderWithOptions(shape, position, orientation, fragmentShader, options = {}) {
        const placeholder = createModel(gl, shape,
            [Math.random(), Math.random(), Math.random(), 1], false, options);

        placeholder.position.set(position.x, position.y, position.z);
        placeholder.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        placeholder.setParent(scene);

        placeholder.program = createProgram(gl, {
            fragment: fragmentShader,
            uniforms: {
                uTime: {value: 0.0}
            }
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
    addModel(position, orientation, url) {
        console.log("OGL addModel " + url);
        const gltfScene = new Transform();
        gltfScene.position.set(position.x, position.y, position.z);
        gltfScene.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        gltfScene.setParent(scene);

        console.log("Loading " + url);
        GLTFLoader.load(gl, url)
            .then((gltf) => {
                const s = gltf.scene || gltf.scenes[0];
                s.forEach((root) => {
                    root.setParent(gltfScene);
                    root.traverse((node) => {
                        if (node.program) {
                            //node.program = createGltfProgram(node);
                            node.program = createSimpleGltfProgram(node);
                        }
                    });
                });
                scene.updateMatrixWorld();
            }).catch(() => {
                console.log("Unable to load model from URL: " + url);
                console.log("Adding placeholder box instead");
                let gltfPlaceholder = createAxesBoxPlaceholder(gl, [1.0, 0.0, 0.0, 0.5], false) // red
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
     * @returns {Transform}
     */
    addExperiencePlaceholder(position, orientation) {
        const placeholder = getExperiencePlaceholder(gl);

        placeholder.position.set(position.x, position.y, position.z);
        placeholder.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        placeholder.setParent(scene);

        updateHandlers[placeholder.id] = () => placeholder.rotation.y += .01;

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
        return this.addModel({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, '/media/models/reticle.gltf');
    }

    isHorizontal(object) {
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
    addRandomObject(position, orientation) {
        let object_description = createRandomObjectDescription();
        return addObject(position, orientation, object_description);
    }

    /**
     * Create object with given properties at the given pose
     *
     * @param position  number{x, y, z}        3D position of the object
     * @param orientation  number{x, y, z, w}     Orientation of the object
     * @param object_description  {*}
     * @returns {Mesh}
     */
    addObject(position, orientation, object_description) {
        console.log("OGL addObject: " + object_description);
        const mesh = createModel(gl, object_description.shape,
                object_description.color, object_description.transparent,
                object_description.options, object_description.scale);
        mesh.position.set(position.x, position.y, position.z);
        mesh.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
        scene.addChild(mesh);
        return mesh;
    }

    /**
     * Create a dynamic object with given properties at the given pose
     *
     * @param object_id  string     User-specified unique ID in the scene
     * @param position  number{x, y, z}        3D position of the object
     * @param orientation  number{x, y, z, w}     Orientation of the object
     * @param object_description {*}    Key-value pairs of object properties
     * @returns {Mesh}  The newly created mesh
     */
    addDynamicObject(object_id, position, orientation, object_description=null) {
        console.log("OGL addDynamicObject: " + object_id);
        let description = object_description;
        if (description == null) {
            description = {
                'version': 2,
                'color': [1.0, 1.0, 1.0, 0.5],
                'shape': PRIMITIVES.sphere,
                'scale': [0.25, 0.25, 0.25],
                'transparent': true,
                'options': {}
            };
        }
        //console.log(description);
        //console.log(position);
        //console.log(orientation);
        //console.log(" ");
        const mesh = createModel(gl, description.shape,
            description.color, description.transparent,
            description.options, description.scale);
        mesh.position.set(position);
        mesh.quaternion.set(orientation);
        scene.addChild(mesh);
        dynamic_objects_descriptions[object_id] = description;
        dynamic_objects_meshes[object_id] = mesh;
        return mesh;
    }

    /**
     * Update a dynamic object with given properties at the given pose
     *
     * @param object_id  string     User-specified unique ID in the scene
     * @param position  number{x, y, z}        3D position of the object
     * @param orientation  number{x, y, z, w}     Orientation of the object
     * @param object_description {*}    Key-value pairs of object properties
     * @returns boolean     Whether the update succeeded
     */
     updateDynamicObject(object_id, position=null, orientation=null, object_description=null) {
        //console.log("OGL updateDynamicObject: " + object_id);
        if (!(object_id in dynamic_objects_descriptions)) {
            console.log("WARNING: object_id " + object_id + " is is not in the scene, cannot update object");
            return false;
        }
        const old_position = dynamic_objects_meshes[object_id].position;
        let new_position = [old_position[0], old_position[1], old_position[2]];
        //let new_position = new Vec3(old_position[0], old_position[1], old_position[2]);
        if (position != null) {
            new_position = [position[0], position[1], position[2]];
            //new_position = new Vec3(position[0], position[1], position[2]);
        }
        dynamic_objects_meshes[object_id].position = new_position;

        const old_orientation = dynamic_objects_meshes[object_id].quaternion;
        let new_orientation = [old_orientation[0], old_orientation[1], old_orientation[2], old_orientation[3]];
        //let new_orientation = new Quat(old_orientation[0], old_orientation[1], old_orientation[2], old_orientation[3]);
        if (orientation != null) {
            new_orientation = [orientation[0], orientation[1], orientation[2], orientation[3]];
            //new_orientation = new Quat(orientation[0], orientation[1], orientation[2], orientation[3]);
        }
        dynamic_objects_meshes[object_id].quaternion = new_orientation;

        // check whether anything changed in the description
        const old_object_description = dynamic_objects_descriptions[object_id];
        if (JSON.stringify(old_object_description) === JSON.stringify(object_description)) {
            // nothing to do
            return true;
        }
        console.log(object_id + " has changed!");
        let new_object_description = {...object_description};
        // as the Mesh properties cannot be changed, we need to delete the mesh and recreate a new one with the new description
        this.removeDynamicObject(object_id);
        this.addDynamicObject(object_id, new_position, new_orientation, new_object_description);
        return true;
    }

    /**
     * Query the description of a dynamic object
     *
     * @param object_id  string     User-specified unique ID in the scene
     * @returns {*}     Key-value pairs of object properties
     */
    getDynamicObjectDescription(object_id) {
        if (object_id in dynamic_objects_descriptions) {
            return dynamic_objects_descriptions[object_id];
        }
        return null;
    }

    /**
     * Query the mesh of a dynamic object
     *
     * @param object_id  string     User-specified unique ID in the scene
     * @returns {Mesh}
     */
    getDynamicObjectMesh(object_id) {
        if (object_id in dynamic_objects_meshes) {
            return dynamic_objects_meshes[object_id];
        }
        return null;
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
    updateMarkerObjectPosition(object, position, orientation) {
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
    updateReticlePose(reticle, position, orientation) {
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

    addPointCloud(url, position, orientation) {
        console.log("Adding point cloud " + url);

        MyPLYLoader.load(gl, url)
            .then((geometry) => {
                if (geometry == null) {
                    return; // do nothing
                }

                const pclProgram = createSimplePointCloudProgram(gl);

                let pclMesh = new Mesh(gl, {
                    mode: gl.POINTS,
                    geometry: geometry,
                    program: pclProgram,
                    //frustumCulled: false, // TODO: try to turn on, maybe it gets faster
                    //renderOrder: 0
                });

                //console.log(position);
                //console.log(orientation);
                pclMesh.position.set(position.x, position.y, position.z);
                pclMesh.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);

                pclMesh.setParent(scene);// this is very slow
            });
    }

    addLogoObject(url, position, orientation, width=1.0, height=1.0) {
        console.log("OGL addLogoObject " + url);
        loadLogoTexture(gl, url)
            .then((texture) => {
                const logoProgram = createLogoProgram(gl, texture);

                const planeGeometry = new Plane(gl, {
                    width: width,
                    height: height
                });
                const plane = new Mesh(gl, {
                    geometry: planeGeometry,
                    program: logoProgram,
                    frustumCulled: false
                });
                plane.position = position;
                plane.orientation = orientation;
                plane.setParent(scene);
            });
    }

    /**
     * Make the provided model clickable.
     *
     * @param model  Mesh       The model to make interactive
     * @param handler  function     The function to execute after interaction
     */
    addClickEvent(model, handler) {
        eventHandlers[model.id] = {
            model, handler
        };
    }

    /**
     * Calculates the camera pose to send to scenes loaded into the iframe.
     *
     * @param view  XRView      The current view
     * @param experienceMatrix  Mat4        The matrix of the experience in WebR space
     * @returns {{camerapose: Mat4, projection: Mat4}}
     */
    getExternalCameraPose(view, experienceMatrix) {
        const cameraMatrix = new Mat4();
        cameraMatrix.copy(experienceMatrix).inverse().multiply(view.transform.matrix);

        return {
            projection: view.projectionMatrix,
            camerapose: cameraMatrix
        }
    }

    /**
     * Allows to set the zero point of the scene.
     *
     * Used by WebXR when the WebXR anchor the scene is added to changes.
     *
     * @returns {function}
     */
    getRootSceneUpdater() {
        return (matrix) => scene.matrix = new Mat4().fromArray(matrix);
    }

    /**
     * Adds a visual queue to the provided model to indicate its state.
     *
     * For example to indicate it is interactive.
     *
     * @param model     The model to change
     */
    setWaiting(model) {
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
    setExperimentTapHandler(callback) {
        experimentTapHandler = callback;
    }

    /**
     * Resize the canvas to full screen.
     */
    resize() {
        renderer.setSize(window.innerWidth, window.innerHeight);
        camera.perspective({aspect: gl.canvas.width / gl.canvas.height, near: 0.01, far: 1000});
    }

    removeDynamicObject(object_id) {
        console.log("OGL removeDynamicObject: " + object_id);
        if (!(object_id in dynamic_objects_meshes)) {
            console.log("WARNING: tried to delete object " + object_id + " which is not in the scene")
            return;
        }
        let mesh = dynamic_objects_meshes[object_id];
        this.remove(mesh);
        mesh = null;
        delete dynamic_objects_meshes[object_id];
        delete dynamic_objects_descriptions[object_id];
    }

    /**
     * Removes the provided model from the scene and all the handlers it mit be registered with.
     *
     * @param model     The model to remove
     */
    remove(model) {
        console.log("OGL remove object " + model.id);
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
        // dynamic objects
        for (var object_id in dynamic_objects_descriptions){
            this.removeDynamicObject(object_id);
        }

        // normal models
        while (scene.children.length > 0) {
            let child = scene.children[0];
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
    render(time, view) {
        checkGLError(gl, "OGL render() begin");

        const position = view.transform.position;
        const orientation = view.transform.orientation;

        camera.projectionMatrix.copy(view.projectionMatrix);
        camera.position.set(position.x, position.y, position.z);
        camera.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);

        Object.values(updateHandlers).forEach(handler => handler());

        const relTime = time - lastRenderTime;
        lastRenderTime = time;
        uniforms.time.forEach(model => model.program.uniforms.uTime.value = time * 0.001);  // Time in seconds

        renderer.render({scene, camera});

        checkGLError(gl, "OGL render() end");
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
    _handleEvent(event) {
        const mouse = new Vec2();
        mouse.set(2.0 * (event.x / renderer.width) - 1.0, 2.0 * (1.0 - event.y / renderer.height) - 1.0)

        const raycast = new Raycast(gl);
        raycast.castMouse(camera, mouse);

        const eventMeshes = Object.values(eventHandlers).map(handler => handler.model);
        const hits = raycast.intersectBounds(eventMeshes);

        // if an OGL object is hit, execute its handler
        hits.forEach((hit) => {
            eventHandlers[hit.id].handler();
        })

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
    updateGeoAlignment(localImagePose, globalImagePose) {

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


        let localImageOrientation = quat.fromValues(localImagePose.orientation.x,
                                                    localImagePose.orientation.y,
                                                    localImagePose.orientation.z,
                                                    localImagePose.orientation.w);

        // We add the AR Camera for visualization
        // this represents the camera in the WebXR coordinate system
        let arCamNode = new Transform(); // This is a virtual node at the local camera pose where the photo was taken
        scene.addChild(arCamNode);
        let arCamSubNode = createAxesBoxPlaceholder(gl, [1, 1, 0, 0.5], false) // yellow
        arCamSubNode.scale.set(0.02, 0.04, 0.06);
        arCamSubNode.position.set(0.001, 0.001, 0.001); // tiny offset so that we can see both the yellow and the cyan when the alignment is correct
        arCamNode.addChild(arCamSubNode);
        arCamNode.position.set(localImagePose.position.x,
                               localImagePose.position.y,
                               localImagePose.position.z);
        arCamNode.quaternion.set(localImagePose.orientation.x,
                                 localImagePose.orientation.y,
                                 localImagePose.orientation.z,
                                 localImagePose.orientation.w);

        _geo2ArTransformNode = new Transform();
        scene.addChild(_geo2ArTransformNode);
        _geo2ArTransformNode.position.set(0,0,0);
        _geo2ArTransformNode.quaternion.set(0,0,0,1);

        // DEBUG: place GeoPose of camera as a content entry with full orientation
        // this should appear exactly where the picture was taken, with the same orientation of the camera in the world
        let geoCamNode = createAxesBoxPlaceholder(gl, [0, 1, 1, 0.5], false) // cyan
        _geo2ArTransformNode.addChild(geoCamNode);
        geoCamNode.scale.set(0.02, 0.04, 0.06);
        let geoCamRelativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose); // will be (0,0,0)
        geoCamRelativePosition = convertAugmentedCityCam2WebVec3(geoCamRelativePosition); // convert from AC to WebXR
        geoCamNode.position.set(geoCamRelativePosition[0],
                                geoCamRelativePosition[1],
                                geoCamRelativePosition[2]); // from vec3 to Vec3
        let globalImagePoseQuaternion = quat.fromValues(globalImagePose.quaternion.x,
                                                        globalImagePose.quaternion.y,
                                                        globalImagePose.quaternion.z,
                                                        globalImagePose.quaternion.w);
        let geoCamOrientation = convertAugmentedCityCam2WebQuat(globalImagePoseQuaternion); // convert from AC to WebXR
        geoCamNode.quaternion.set(geoCamOrientation[0],
                                  geoCamOrientation[1],
                                  geoCamOrientation[2],
                                  geoCamOrientation[3]);


        // DEBUG: place GeoPose of camera as a content entry with zero orientation
        // this should appear exactly where the picture was taken, but oriented according to the Geo axes.
        let geoCoordinateSystemNode = createAxesBoxPlaceholder(gl, [1, 1, 1, 0.5]); // white
        _geo2ArTransformNode.addChild(geoCoordinateSystemNode);
        geoCoordinateSystemNode.scale.set(0.02, 0.04, 0.06);
        let geoCoordinateSystemRelativePosition = getRelativeGlobalPosition(globalImagePose, globalImagePose); // will be (0,0,0)
        geoCoordinateSystemRelativePosition = convertGeo2WebVec3(geoCoordinateSystemRelativePosition); // convert from Geo to WebXR
        geoCoordinateSystemNode.position.set(geoCoordinateSystemRelativePosition[0],
                                             geoCoordinateSystemRelativePosition[1],
                                             geoCoordinateSystemRelativePosition[2]); // from vec3 to Vec3
        geoCoordinateSystemNode.quaternion.set(0,0,0,1); // neutral orientation


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
    addSpatialContentRecord(globalObjectPose, content) {

        const object = createAxesBoxPlaceholder(gl, [0.7, 0.7, 0.7, 1.0]) // gray

        // calculate relative position w.r.t the camera in ENU system
        let relativePosition = getRelativeGlobalPosition(_globalImagePose, globalObjectPose);
        relativePosition = convertGeo2WebVec3(relativePosition);
        // set _local_ transformation w.r.t parent _geo2ArTransformNode
        object.position.set(relativePosition[0], relativePosition[1], relativePosition[2]); // from vec3 to Vec3
        // set the objects' orientation as in the GeoPose response, that is already in ENU
        object.quaternion.set(globalObjectPose.quaternion.x,
                              globalObjectPose.quaternion.y,
                              globalObjectPose.quaternion.z,
                              globalObjectPose.quaternion.w);

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

    convertGeoPoseToLocalPose(geoPose) {
        if (_geo2ArTransformNode === undefined) {
            throw "No localization has happened yet!";
        }

        // First assemble an ENU pose
        let transform = new Transform();
        // position as displacement relative to the last known global camera positision
        let relativePosition = getRelativeGlobalPosition(_globalImagePose, geoPose);
        relativePosition = convertGeo2WebVec3(relativePosition);
        transform.position.set(relativePosition[0],
                               relativePosition[1],
                               relativePosition[2]);

        // geoPose orientation is given in ENU
        //transform.quaternion.set(geoPose.quaternion.x, geoPose.quaternion.y, geoPose.quaternion.z, geoPose.quaternion.w);
        // BUT we must convert the directions to WebXR first
        let enuQuaternion = [geoPose.quaternion.x, geoPose.quaternion.y, geoPose.quaternion.z, geoPose.quaternion.w]
        let webxrQuaternion = convertGeo2WebQuat(enuQuaternion);
        transform.quaternion.set(webxrQuaternion[0], webxrQuaternion[1], webxrQuaternion[2], webxrQuaternion[3]);


        // Then convert the ENU pose to local WebXR pose
        _geo2ArTransformNode.addChild(transform);
        _geo2ArTransformNode.updateMatrixWorld(true);
        let localPose = new Transform();
        localPose.matrix = transform.worldMatrix; // we need to take out the world matrix instead of the local node transform
        localPose.decompose(); // this fills all other internal entries based on the internal matrix
        _geo2ArTransformNode.removeChild(transform);

        return localPose;
    }

    convertLocalPoseToGeoPose(position, quaternion) {
        if (_ar2GeoTransformNode === undefined) {
            throw "No localization has happened yet!";
        }

        let localPose = new Transform();
        localPose.position = position;
        localPose.quaternion = quaternion;
        localPose.updateMatrix();
        _ar2GeoTransformNode.addChild(localPose);
        _ar2GeoTransformNode.updateMatrixWorld();

        let localENUPose = new Transform();
        localENUPose.matrix = localPose.worldMatrix;
        localENUPose.decompose();
        _ar2GeoTransformNode.removeChild(localPose);

    1   // TODO: rename to enuPose and enuPosition
        let localEnuPosition = vec3.fromValues(
                localENUPose.position.x,
                localENUPose.position.y,
                localENUPose.position.z);
        localEnuPosition = convertWeb2GeoVec3(localEnuPosition);

        let dE = localEnuPosition[0];
        let dN = localEnuPosition[1];
        let dU = localEnuPosition[2];


        let refGeoPose = _globalImagePose;
//        //TODO: do proper conversion here!
//        // See https://www.movable-type.co.uk/scripts/latlong.html
//        //const R = 6371009; // Earth radius (assuming a sphere)
//        const R = getEarthRadiusAt(refGeoPose.position.lat);
//        let dLon = toDegrees(Math.atan2(dE, R));
//        let dLat = toDegrees(Math.atan2(dN, R));
//        let dHeight = dU;
        // This is the proper conversion:
        const geodetic = convertEnuToGeodetic(dE, dN, dU, refGeoPose.position.lat, refGeoPose.position.lon, refGeoPose.position.h);


        //TODO: swap orientation axes
        let localENUQuaternion = quat.fromValues(localENUPose.quaternion.x, localENUPose.quaternion.y, localENUPose.quaternion.z, localENUPose.quaternion.w);
        // swap axes
        localENUQuaternion = convertWeb2GeoQuat(localENUQuaternion);
        //localENUPose.quaternion.set(localENUQuaternion[0], localENUQuaternion[1], localENUQuaternion[2], localENUQuaternion[3]);

        let geoPose = {
            "position": {
                "lat": geodetic.lat, //refGeoPose.position.lat + dLat,
                "lon": geodetic.lon, //refGeoPose.position.lon + dLon,
                "h": geodetic.h //refGeoPose.position.h + dHeight,
            },
            "quaternion": {
                "x": localENUQuaternion[0], //localENUPose.quaternion.x,
                "y": localENUQuaternion[1], //localENUPose.quaternion.y,
                "z": localENUQuaternion[2], //localENUPose.quaternion.z,
                "w": localENUQuaternion[3] //localENUPose.quaternion.w
            }
        }
        return geoPose;
    }

    /**
     * Converts a GeoPose object into East-North-Up coordinate system (local tangent plane approximation)
     * @param {*} geoPose GeoPose to convert
     * @param {*} refGeoPose reference GeoPose
     * @returns
     */
    geoPose_to_ENU(geoPose, refGeoPose) {
        let enuPosition = geodetic_to_enu(geoPose.position.lat, geoPose.position.lon, geoPose.position.h,
                        refGeoPose.position.lat, refGeoPose.position.lon, refGeoPose.position.h);

        let enuPose = new Transform();
        enuPose.position.set(enuPosition.x, enuPosition.y, enuPosition.z);
        enuPose.quaternion.set(geoPose.quaternion.x, geoPose.quaternion.y, geoPose.quaternion.z, geoPose.quaternion.w);
        enuPose.updateMatrix();
        return enuPose;
    }
}
