<!--
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE for details)
-->

<!--
    Initializes and runs the AR session. Configuration will be according the data provided by the parent.
-->
<script>
    import Parent from '@components/Viewer';
    import ArCloudOverlay from '@components/dom-overlays/ArCloudOverlay';
    import {recentLocalisation} from '@src/stateStore';

    import { get } from 'svelte/store';
    import { recentLocalisation } from '@src/stateStore';

    // just for drawing an agent
    import {PRIMITIVES} from "@core/engines/ogl/modelTemplates";
    let useReticle = true; // TODO: make selectable on the GUI
    let hitTestSource = null;
    let robotWaypointModel = null;
    import { checkGLError } from '@core/devTools';
    let myGl = null;

    let parentInstance;

    import {createEventDispatcher} from 'svelte';
    const dispatcher = createEventDispatcher();

    /**
     * Initial setup.
     *
     * @param thisWebxr  class instance     Handler class for WebXR
     * @param this3dEngine  class instance      Handler class for 3D processing
     */
    export function startAr(thisWebxr, this3dEngine) {
        parentInstance.startAr(thisWebxr, this3dEngine);

        startSession();
    }

    /**
     * Setup required AR features and start the XRSession.
     */
    async function startSession() {
        let requiredXrFeatures = ['dom-overlay', 'camera-access', 'anchors', 'local-floor'];
        let optionalXrFeatures = [];
        // TODO: do we need anchors at all?

        // TODO: move the whole reticle and tap handler stuff into the base Viewer
        if (useReticle) {
            requiredXrFeatures.push('hit-test')
            // our callback for hit test results (event handler for screen tap)
            parentInstance.getRenderer().setExperimentTapHandler(myTapHandler);
        }

        await parentInstance.startSession(onXrFrameUpdate, onXrSessionEnded, onXrNoPose,
            (xr, result, gl) => {
                xr.glBinding = new XRWebGLBinding(result, gl);
                xr.initCameraCapture(gl);

                myGl = gl;

                if (useReticle){
                    // request hit testing
                    result.requestReferenceSpace('viewer')
                        .then(refSpace => result.requestHitTestSource({ space: refSpace }))
                        .then(source => hitTestSource = source);
                }
            },
            requiredXrFeatures,
            optionalXrFeatures
        );
    }


    import {robotTargetWaypoint} from '@src/stateStore';
    import {getRelativeGlobalPosition} from '@core/locationTools';
    let reticle = null;
    import colorfulFragment from '@shaders/colorfulfragment.glsl';
    function myTapHandler(event) {
        if (reticle == undefined || reticle == null || reticle.visible == false) {
            console.log("UI tapped but reticle is undefined :(");
            return;
        }
        if ($recentLocalisation.geopose?.position === undefined || $recentLocalisation.floorpose?.transform?.position === undefined) {
            console.log("UI tapped but the recent localization result is empty :(");
            return;
        }

        if (event.y > event.view.outerHeight * 0.75) {
            // do not react to the lower 25% of the view (where the buttons are)
            return;
        }

        let latestGlobalPose = $recentLocalisation.geopose;
        let latestLocalPose = $recentLocalisation.floorpose.transform;

        // TODO: is this needed at all?
        // HACK: this is to initialize the internal alignment matrices.
        // Normally this is done when the first contents arrives, but we have no contents yet at this point.
        parentInstance.getRenderer().updateGeoAlignment(latestLocalPose, latestGlobalPose);

        // local target pose is from reticle
        let localTargetPose = {};
        localTargetPose["position"] = reticle.position;
        localTargetPose["quaternion"] = reticle.quaternion;

        // determine the global position of the tap and create a (global!) waypoint there
        let globalTargetPose = parentInstance.getRenderer().convertLocalPoseToGeoPose(localTargetPose.position, localTargetPose.quaternion);


        // A set waypoint directly
        //setWaypointObject(globalTargetPose, localTargetPose, true);
        //
        // B publish the waypoint instead and receive it through the messaging system
        const message_body = {
            "geopose": globalTargetPose,
            "active": true,
            "sender": "nokia83_gabor", // TODO: generate based on user uuid
            "timestamp": new Date().getTime(), // TODO: use the timestamp from the message,
            "creator_id": "nokia83_gabor", // TODO: generate based on user uuid
            "agent_id": "robot2" // TODO: generate based on agent uuid
        }
        dispatcher('broadcast', {
            event: 'waypoint_set',
            value: message_body,
            "routing_key": "/exchange/esoptron/waypoint"
        });
    }

    // TODO: if there is already one, do not recreate but just move it
    function setWaypointObject(globalTargetPose, localTargetPose, active=true) {
        // remove any previous waypoint
        if (robotWaypointModel) {
            parentInstance.getRenderer().remove(robotWaypointModel);

        }
        if (active == false) {
           return; // nothing more to do
        }

        // Create a waypoint object
        const shape = PRIMITIVES.cylinder;
        let options = {};
        options.radiusTop = 0.3;
        options.radiusBottom = 0.3;
        options.height = 2;
        const fragmentShader = colorfulFragment;
        const scale = 0.1; const offsetY = 1; const offsetZ = 0;
        robotWaypointModel = parentInstance.getRenderer().addPlaceholderWithOptions(shape, localTargetPose.position, localTargetPose.quaternion, fragmentShader, options);
        robotWaypointModel.scale.set(scale);
        robotWaypointModel.position.y += offsetY * scale;
        robotWaypointModel.position.z += offsetZ * scale;

        $robotTargetWaypoint.geopose = globalTargetPose;
        $robotTargetWaypoint.floorpose = localTargetPose;
        console.log("WAYPOINT SET!");
        console.log($robotTargetWaypoint);
        new Audio('media/audio/ding-36029.mp3').play();
    }

    /**
     * Handle events from the application or from the P2P network
     * NOTE: sometimes multiple events are bundled using different keys!
     */
    export function onNetworkEvent(events) {
        // Simply print any other events and return
        if (!('agent_geopose_updated' in events) && !('waypoint_set' in events) && !('reservation_status_changed' in events)) {
            console.log('Viewer-Oscp: Unknown event received:');
            console.log(events);
            // pass on to parent
            return parentInstance.onNetworkEvent(events);
        }

        if (get(recentLocalisation)?.geopose?.position == undefined) {
            // we need to localize at least once to be able to do anything
            console.log('Network event received but we are not localized yet!');
            console.log(events);
            return;
        }

        if ('agent_geopose_updated' in events) {
            let data = events.agent_geopose_updated;
            const agent_id = data.agent_id;
            const timestamp = data.timestamp;
            //const timestamp = new Date().getTime(); // TODO: use the timestamp from the message
            // We create a new spatial content record just for placing this object
            let object_id = agent_id + '_' +  timestamp; // just a proposal

            let object_description = {
                'version': 2,
                'color': [data.color[0], data.color[1], data.color[2], 1.0],
                'shape': PRIMITIVES.sphere,
                'scale': [0.05, 0.05, 0.05],
                'transparent': false,
                'options': {}
            };
            let content = {
                "id": agent_id, // stream ID
                "type": "geopose_stream", //high-level OSCP type
                "title": object_id, // datapoint ID = stream ID + timestamp
                "refs": [],
                "geopose": data.geopose,
                "object_description": object_description
            };
            let scr = {
                "content": content,
                "id": object_id,
                "tenant": "IROS2022demo",
                "type": "geopose_stream",
                "timestamp": timestamp
            };
            parentInstance.placeContent([[scr]]); // WARNING: wrap into an array


            // if the robot is close to the target in global coordinates, make the target disappear
            if ($robotTargetWaypoint?.geopose?.position?.lat != undefined) {
                const dLat = Math.abs(data.geopose.position.lat - $robotTargetWaypoint.geopose.position.lat); // in latitude degrees
                const dLon = Math.abs(data.geopose.position.lon - $robotTargetWaypoint.geopose.position.lon); // in longitude degrees
                const dHeight = Math.abs(data.geopose.position.h - $robotTargetWaypoint.geopose.position.h); // in meters (the reticle height is very unreliable)

                // TODO: it would be much better to compare local poses!
                let relativePositionENU = getRelativeGlobalPosition(data.geopose, $robotTargetWaypoint.geopose); // in ENU
                // consider only the East-North plane because the height is very unreliable
                const planarDistance = Math.sqrt(relativePositionENU[0]*relativePositionENU[0] + relativePositionENU[1]*relativePositionENU[1]);
                //console.log(relativePositionENU);
                //console.log(planarDistance);

                if (planarDistance < 0.25 || (dLat < 0.000002 && dLon < 0.000002 && dHeight < 2.0)) {
                    console.log("WAYPOINT HIT!");
                    new Audio('media/audio/ding-40142.mp3').play();
                    parentInstance.getRenderer().remove(robotWaypointModel);

                    // invalidate the target coordinates
                    $robotTargetWaypoint.geopose = {};
                    $robotTargetWaypoint.floorpose = {};
                }
            }
        }

        if ('waypoint_set' in events) {
            console.log("Global waypoint event received:");
            const msg = events.waypoint_set;
            console.log(msg);
            const globalTargetPose = msg.geopose;
            const localTargetPose = parentInstance.getRenderer().convertGeoPoseToLocalPose(globalTargetPose);
            const active = msg.active;
            setWaypointObject(globalTargetPose, localTargetPose, active);
        }

        if ('reservation_status_changed' in events) {
            //console.log("Reservation status event received");
            console.log(events.reservation_status_changed);
            const chair_id = events.reservation_status_changed.chair_id;
            const reserved = events.reservation_status_changed.reserved;
            if (chair_id == undefined || reserved == undefined) {
                console.log("WARNING: invalid chair reservation message");
                return;
            }

            const object_description = parentInstance.getRenderer().getDynamicObjectDescription(chair_id);
            if (object_description == null) {
                console.log("WARNING: this chair is not in this scene!");
                return;
            }
            let new_object_description = { ...object_description };
            if (reserved) {
                new_object_description.color = [1.0, 0.0, 0.0, 0.75];
                new_object_description.scale = [0.10, 0.10, 0.10];
            } else {
                new_object_description.color = [0.0, 1.0, 0.0, 0.75];
                new_object_description.scale = [0.25, 0.25, 0.25];
            }
            parentInstance.getRenderer().updateDynamicObject(chair_id, null, null, new_object_description);

            new Audio('media/audio/news-ting-6832.mp3').play();
        }
     }

    function shareCameraPose(position, quaternion) {
        const timestamp = new Date().getTime();
        const agent_id = "phone2";
        const object_id = agent_id + '_' +  timestamp; // just a proposal
        const globalObjectPose = parentInstance.getRenderer().convertLocalPoseToGeoPose(position, quaternion);
        const geoPose = {
            "position": {
                "lat": globalObjectPose.position.lat,
                "lon": globalObjectPose.position.lon,
                "h": globalObjectPose.position.h
            },
            "quaternion": {
                "x": globalObjectPose.quaternion.x,
                "y": globalObjectPose.quaternion.y,
                "z": globalObjectPose.quaternion.z,
                "w": globalObjectPose.quaternion.w
            }
        }
        const object_description = {
            'version': 2,
            'color': [1.0, 1.0, 0.0, 1.0],
            'shape': PRIMITIVES.sphere,
            'scale': [0.05, 0.05, 0.05],
            'transparent': false,
            'options': {}
        };
        const content = {
            "id": agent_id, // stream ID
            "type": "geopose_stream", //high-level OSCP type
            "title": object_id, // datapoint ID = stream ID + timestamp
            "refs": [],
            "geopose": geoPose,
            "object_description": object_description
        }
        const scr = {
            "content": content,
            "id": object_id, // datapoint ID = stream ID + timestamp
            "tenant": "IROS2022demo",
            "type": "geopose_stream",
            "timestamp": timestamp
        }
        const message_body = {
            "scr": scr,
            "sender": "nokia83_gabor", // TODO: generate based on some agent uuid
            "timestamp": timestamp,
        }
        dispatcher('broadcast', {
            event: 'agent_geopose_updated',
            value: message_body,
            "routing_key": "/exchange/esoptron/geopose_update.nokia83_gabor" // TODO: generate based on some agent uuid
        });
    }

    /**
     * Handles update loop when AR Cloud mode is used.
     *
     * @param time  DOMHighResTimeStamp     time offset at which the updated
     *      viewer state was received from the WebXR device.
     * @param frame     The XRFrame provided to the update loop
     * @param floorPose The pose of the device as reported by the XRFrame
     * @param floorSpaceReference
     */
    function onXrFrameUpdate(time, frame, floorPose, floorSpaceReference) {

        if (useReticle && !hitTestSource) {
            console.log("HitTestSource is invalid :(");
            return;
        }

        checkGLError(myGl, "before creating reticle");
        if (useReticle && !reticle) {
            //reticle = parentInstance.getRenderer().addReticle();
            //reticle = parentInstance.getRenderer().addModel({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, '/media/models/Duck.glb');
            //reticle = parentInstance.getRenderer().addPlaceholder([], {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1});
            reticle = parentInstance.getRenderer().addMarkerObject();
        }
        checkGLError(myGl, "after creating reticle");
        reticle.visible = false;

        const hitTestResults = frame.getHitTestResults(hitTestSource);
        if (hitTestResults.length > 0) {
            const reticlePose = hitTestResults[0].getPose(floorSpaceReference);
            const position = reticlePose.transform.position;
            const orientation = reticlePose.transform.orientation;
            parentInstance.getRenderer().updateReticlePose(reticle, position, orientation);
            reticle.visible = true;
        }

        // hide if there was no localization yet
        if ($recentLocalisation.geopose?.position === undefined) {
            reticle.visible = false;
        }
/*
        if ($recentLocalisation.geopose?.position != undefined || $recentLocalisation.floorpose?.transform?.position != undefined) {
            try {
                shareCameraPose(floorPose.transform.position, floorPose.transform.orientation);
            } catch (error) {
                // do nothing. we can expect some exceptions because the pose conversion is not yet possible in the first few frames.
            }
        }
*/
        parentInstance.onXrFrameUpdate(time, frame, floorPose); // this renders scene and captures the camera image for localization
    }

    /**
     * Called when no pose was reported from WebXR.
     *
     * @param time  DOMHighResTimeStamp     time offset at which the updated
     *      viewer state was received from the WebXR device.
     * @param frame  XRFrame        The XRFrame provided to the update loop
     * @param floorPose  XRPose     The pose of the device as reported by the XRFrame
     */
    function onXrNoPose(time, frame, floorPose) {
        parentInstance.onXrNoPose(time, frame, floorPose);
    }

    /**
     * Called when the XRSession was closed.
     */
    function onXrSessionEnded() {
        if (hitTestSource) {
            hitTestSource.cancel();
            hitTestSource = null;
        }
        parentInstance.onXrSessionEnded();
    }

</script>

<Parent
    bind:this={parentInstance}
    on:arSessionEnded
    on:broadcast>

    <svelte:fragment slot="overlay"
        let:isLocalizing
        let:isLocalized
        let:isLocalisationDone
        let:firstPoseReceived
        let:receivedContentTitles
        >
        <ArCloudOverlay
            hasPose="{firstPoseReceived}"
            isLocalizing="{isLocalizing}"
            isLocalized="{isLocalized}"
            receivedContentTitles="{receivedContentTitles}"
            on:startLocalisation={() => parentInstance.startLocalisation()}
            on:relocalize={() => parentInstance.relocalize()}
        />
    </svelte:fragment>
</Parent>
