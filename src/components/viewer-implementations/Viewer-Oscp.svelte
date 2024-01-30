<!--
  (c) 2021 Open AR Cloud
  This code is licensed under MIT license (see LICENSE.md for details)

  (c) 2024 Nokia
  Licensed under the MIT License
  SPDX-License-Identifier: MIT
-->

<!--
    Initializes and runs the AR session. Configuration will be according the data provided by the parent.
-->

<script lang="ts">
    import { get } from 'svelte/store';
    import throttle from 'lodash/throttle';
    import type { Quat, Vec3, Transform, Mesh, OGLRenderingContext } from 'ogl';
    import Parent from '@components/Viewer.svelte';
    import ArCloudOverlay from '@components/dom-overlays/ArCloudOverlay.svelte';
    import { checkGLError } from '../../core/devTools';
    import { PRIMITIVES } from '../../core/engines/ogl/modelTemplates'; // just for drawing an agent
    import type webxr from '../../core/engines/webxr';
    import type ogl from '../../core/engines/ogl/ogl';
    import type { XrFeatures } from '../../types/xr';

    import { distToLineSegment, rgbToHex, normalizeColor } from '../../core/common';
    import { isUserOnRobotPath, myAgentName, myAgentId, myAgentColor, recentLocalisation } from '../../stateStore';

    let parentInstance: Parent;

    let myGl: OGLRenderingContext | null = null;

    let useReticle = true; // TODO: make selectable on the GUI
    let hitTestSource: XRHitTestSource | undefined;
    let reticle: Transform | null = null; // TODO: should be Mesh

    let agentInfo: Record<string, { hexColor: string; agentName: string; agentId: string }> = {};
    let robotPathPolylines: Record<string, { robotPolyLine: Mesh; robotPolyLinePoints: Vec3[] }> = {};
    let robotPathClearTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};
    let targetWaypoints: Record<string, { geopose: Geopose; model: Mesh; floorpose: Transform }> = {};
    let selectedAgentIdToSend = 'TEST_ROBOT_ID'; // this is just for testing, should be null
    import colorfulFragment from '@shaders/colorfulfragment.glsl';

    import { createEventDispatcher } from 'svelte';
    import type { Geopose } from '@oarc/scd-access';
    const dispatcher = createEventDispatcher();

    /**
     * Initial setup.
     *
     * @param thisWebxr  class instance     Handler class for WebXR
     * @param this3dEngine  class instance      Handler class for 3D processing
     */
    export function startAr(thisWebxr: webxr, this3dEngine: ogl) {
        parentInstance.startAr(thisWebxr, this3dEngine);

        startSession();
    }

    function removeWaypoint({ agent_id, agent_geopose }: { agent_id: string; agent_geopose: Geopose }) {
        // there is a waypoint known for this agent
        const waypointLocalPose = parentInstance.getRenderer().convertGeoPoseToLocalPose(targetWaypoints[agent_id].geopose);
        let waypointPosition = waypointLocalPose.position;
        waypointPosition[1] = 0.0; // Y UP set to zero
        const agentLocalPose = parentInstance.getRenderer().convertGeoPoseToLocalPose(agent_geopose);
        let agentPosition = agentLocalPose.position;
        agentPosition[1] = 0.0; // Y UP set to zero
        // TODO: use 3D coordinate comparison for drones
        const planarDistance = waypointPosition.distance(agentPosition);
        if (planarDistance < 0.25) {
            console.log('Waypoint hit by agent ' + agent_id);
            new Audio('media/audio/ding-40142.mp3').play();
            parentInstance.getRenderer().remove(targetWaypoints[agent_id].model);
            delete targetWaypoints[agent_id];
        }
    }

    /**
     * Setup required AR features and start the XRSession.
     */
    async function startSession() {
        let requiredXrFeatures: XrFeatures[] = ['dom-overlay', 'camera-access', 'anchors', 'local-floor'];
        let optionalXrFeatures: XrFeatures[] = [];

        // TODO: do we need anchors at all?

        // TODO: move the whole reticle and tap handler stuff into the base Viewer
        if (useReticle) {
            requiredXrFeatures.push('hit-test');
            // our callback for hit test results (event handler for screen tap)
        }

        await parentInstance.startSession(
            onXrFrameUpdate,
            onXrSessionEnded,
            onXrNoPose,
            (xr: webxr, result: XRSession, gl: OGLRenderingContext | null) => {
                if (!gl) {
                    throw new Error('gl is undefined');
                }
                xr.glBinding = new XRWebGLBinding(result, gl);
                xr.initCameraCapture(gl);

                myGl = gl;

                if (useReticle) {
                    // request hit testing
                    result
                        .requestReferenceSpace('viewer')
                        .then((refSpace) => result.requestHitTestSource?.({ space: refSpace }))
                        .then((source) => (hitTestSource = source));
                }
            },
            requiredXrFeatures,
            optionalXrFeatures,
        );
    }

    function isIntersectingWithRobotPath(floorPose: XRViewerPose) {
        const threshold = 0.3;
        for (const view of floorPose.views) {
            for (const { robotPolyLinePoints } of Object.values(robotPathPolylines)) {
                for (let i = 0; i < robotPolyLinePoints.length - 1; i++) {
                    const distance = distToLineSegment({ point: view.transform.position, lineStart: robotPolyLinePoints[i], lineEnd: robotPolyLinePoints[i + 1], projectionAxis: 'y' });
                    if (distance <= threshold) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function handleSendWaypoint() {
        if (!selectedAgentIdToSend) {
            return;
        }
        if (reticle === null || reticle.visible == false) {
            console.log('UI tapped but reticle is undefined :(');
            return;
        }
        if ($recentLocalisation.geopose?.position === undefined || $recentLocalisation.floorpose?.transform?.position === undefined) {
            console.log('UI tapped but the recent localization result is empty :(');
            return;
        }

        let latestGlobalPose = $recentLocalisation.geopose;
        let latestLocalPose = $recentLocalisation.floorpose.transform;

        // TODO: is this needed at all?
        // HACK: this is to initialize the internal alignment matrices.
        // Normally this is done when the first contents arrives, but we have no contents yet at this point.
        if (!latestGlobalPose.position || !latestGlobalPose.quaternion) {
            console.log(`latestGlobalPose is not defined properly: ${latestGlobalPose}`);
            throw new Error(`latestGlobalPose is not defined properly: ${latestGlobalPose}`);
        }
        parentInstance.getRenderer().updateGeoAlignment(latestLocalPose, { position: latestGlobalPose.position, quaternion: latestGlobalPose.quaternion });

        // local target pose is from reticle
        const localTargetPose = { position: reticle.position, quaternion: reticle.quaternion };

        // determine the global position of the tap and create a (global!) waypoint there
        const globalTargetPose = parentInstance.getRenderer().convertLocalPoseToGeoPose(localTargetPose.position, localTargetPose.quaternion);

        // publish the waypoint and receive it through the messaging system
        const message_body = {
            geopose: globalTargetPose,
            active: true,
            sender: $myAgentId, // can the sender be different from the creator of the command? in some cases maybe yes.
            timestamp: Date.now(), //new Date().getTime(), // TODO: use the timestamp from the message,
            creator_id: $myAgentId,
            agent_id: selectedAgentIdToSend, // we send the command to this robot
        };
        dispatcher('broadcast', {
            event: 'waypoint_set',
            value: message_body,
            routing_key: '/exchange/esoptron/waypoint',
        });
    }

    // TODO: if there is already one, do not recreate but just move it
    // TODO: globalTargetPose can be factored out from this method
    function setWaypointObject({
        globalTargetPose,
        localTargetPose,
        targetAgentId,
        active = true,
        playAudio = true,
    }: {
        globalTargetPose: Geopose;
        localTargetPose: Transform;
        targetAgentId: string;
        active?: boolean;
        playAudio?: boolean;
    }) {
        // remove any previous waypoint
        if (targetWaypoints[targetAgentId]) {
            parentInstance.getRenderer().remove(targetWaypoints[targetAgentId].model);
            delete targetWaypoints[targetAgentId];
        }

        if (active == false) {
            return; // nothing more to do
        }

        // Create a waypoint object
        const shape = PRIMITIVES.cylinder;
        const options = { radiusTop: 0.3, radiusBottom: 0.3, height: 2 };
        const fragmentShader = colorfulFragment;
        const scale = 0.1;
        const model = parentInstance.getRenderer().addPlaceholderWithOptions(shape, localTargetPose.position, localTargetPose.quaternion, fragmentShader, options);
        model.scale.set(scale);
        targetWaypoints = { ...targetWaypoints, [targetAgentId]: { model: model, geopose: globalTargetPose, floorpose: localTargetPose } };

        if (playAudio) {
            new Audio('media/audio/ding-36029.mp3').play();
        }
    }

    /**
     * Handle events from the application or from the P2P network
     * NOTE: sometimes multiple events are bundled using different keys!
     */
    export function onNetworkEvent(events: any) {
        // Simply print any other events and return
        if (!('agent_geopose_updated' in events) && !('waypoint_set' in events) && !('reservation_status_changed' in events) && !('robot_path' in events)) {
            console.log('Viewer-Oscp: Unknown event received:');
            console.log(events);
            // pass on to parent
            return parentInstance.onNetworkEvent(events);
        }

        if (get(recentLocalisation)?.geopose?.position == undefined) {
            // we need to localize at least once to be able to do anything
            //console.log('Network event received but we are not localized yet!');
            //console.log(events);
            return;
        }

        if ('agent_geopose_updated' in events) {
            let data = events.agent_geopose_updated;
            const agent_id = data.agent_id;
            const agent_name = data.agent_name;
            const agent_color = rgbToHex(data.color);
            agentInfo = { ...agentInfo, [agent_id]: { hexColor: agent_color, agentName: agent_name || agent_id, agentId: agent_id } };
            const timestamp = data.timestamp;
            const agent_geopose = data.geopose;
            // We create a new spatial content record just for placing this object
            let object_id = agent_id + '_' + timestamp; // just a proposal
            let object_description = {
                version: 2,
                color: [normalizeColor(data.color.r), normalizeColor(data.color.g), normalizeColor(data.color.b), normalizeColor(data.color.a)],
                shape: PRIMITIVES.sphere,
                scale: [0.05, 0.05, 0.05],
                transparent: false,
                options: {},
            };
            let content = {
                id: agent_id, // stream ID
                type: 'geopose_stream', //high-level OSCP type
                title: object_id, // datapoint ID = stream ID + timestamp
                refs: [],
                geopose: agent_geopose,
                object_description: object_description,
            };
            let scr = {
                content: content,
                id: object_id,
                tenant: 'IROS2022demo',
                type: 'geopose_stream',
                timestamp: timestamp,
            };
            parentInstance.placeContent([[scr]]); // WARNING: wrap into an array

            // if the robot is close to the target in global coordinates, make the target disappear
            if (targetWaypoints[agent_id]?.geopose?.position?.lat != undefined) {
                removeWaypoint({ agent_id, agent_geopose });
            }
        }

        if ('waypoint_set' in events) {
            console.log('Global waypoint event received:');
            const msg: { agent_id: string; geopose: Geopose; active: boolean } = events.waypoint_set;
            console.log(msg);

            const active = msg.active;
            const targetAgentId = msg.agent_id;
            const globalTargetPose = msg.geopose;
            const localTargetPose = parentInstance.getRenderer().convertGeoPoseToLocalPose(globalTargetPose);

            // TODO: always draw and play sound, right?
            // if (targetAgentId === $myAgentId || targetAgentId === selectedAgentIdToSend) {
            //const playAudio = targetAgentId === $myAgentId;
            const playAudio = true;
            setWaypointObject({ globalTargetPose, localTargetPose, targetAgentId, active, playAudio });
            //}
        }

        if ('robot_path' in events) {
            const msg: { agent_id: string; geoposes: Geopose[] } = events.robot_path;
            if (robotPathPolylines[msg.agent_id]) {
                parentInstance.getRenderer().remove(robotPathPolylines[msg.agent_id].robotPolyLine);
                delete robotPathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using robotPathPolylines reactively
            }
            if (robotPathClearTimeouts[msg.agent_id]) {
                clearTimeout(robotPathClearTimeouts[msg.agent_id]);
                delete robotPathClearTimeouts[msg.agent_id];
            }
            const robotPolyLinePoints = msg.geoposes.map((geopose) => {
                const localTargetPose = parentInstance.getRenderer().convertGeoPoseToLocalPose(geopose);
                return new Vec3(localTargetPose.position.x, localTargetPose.position.y, localTargetPose.position.z);
            });
            const hexColor = agentInfo[msg.agent_id].hexColor;
            if (robotPolyLinePoints.length) {
                robotPathPolylines[msg.agent_id] = { robotPolyLine: parentInstance.getRenderer().addPolyline(robotPolyLinePoints, hexColor), robotPolyLinePoints };
            }
            robotPathClearTimeouts[msg.agent_id] = setTimeout(() => {
                if (!parentInstance) {
                    return;
                }
                if (!robotPathPolylines[msg.agent_id]) {
                    return;
                }
                parentInstance.getRenderer().remove(robotPathPolylines[msg.agent_id].robotPolyLine);
                delete robotPathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using robotPathPolylines reactively
            }, 2000);
        }

        if ('reservation_status_changed' in events) {
            //console.log("Reservation status event received");
            console.log(events.reservation_status_changed);
            const chair_id = events.reservation_status_changed.chair_id;
            const reserved = events.reservation_status_changed.reserved;
            if (chair_id == undefined || reserved == undefined) {
                console.log('WARNING: invalid chair reservation message');
                return;
            }

            const object_description = parentInstance.getRenderer().getDynamicObjectDescription(chair_id);
            if (object_description == null) {
                console.log('WARNING: this chair is not in this scene!');
                return;
            }
            let new_object_description = { ...object_description };
            if (reserved) {
                new_object_description.color = [1.0, 0.0, 0.0, 0.75];
                new_object_description.scale = [0.1, 0.1, 0.1];
            } else {
                new_object_description.color = [0.0, 1.0, 0.0, 0.75];
                new_object_description.scale = [0.25, 0.25, 0.25];
            }
            parentInstance.getRenderer().updateDynamicObject(chair_id, null, null, new_object_description);

            new Audio('media/audio/news-ting-6832.mp3').play();
        }
    }

    function getGeoposeFromXRViewerPose(localPose: XRViewerPose): Geopose {
        const position = new Vec3(localPose.transform.position.x, localPose.transform.position.y, localPose.transform.position.z);
        const quaternion = new Quat(localPose.transform.orientation.x, localPose.transform.orientation.y, localPose.transform.orientation.z, localPose.transform.orientation.w);
        const globalObjectPose = parentInstance.getRenderer().convertLocalPoseToGeoPose(position, quaternion);
        return {
            position: {
                lat: globalObjectPose.position.lat,
                lon: globalObjectPose.position.lon,
                h: globalObjectPose.position.h,
            },
            quaternion: {
                x: globalObjectPose.quaternion.x,
                y: globalObjectPose.quaternion.y,
                z: globalObjectPose.quaternion.z,
                w: globalObjectPose.quaternion.w,
            },
        };
    }

    function shareCameraPose(localPose: XRViewerPose) {
        // Warning: conversion from the webxr transform representation to OGL representation

        const timestamp = Date.now();
        const agent_id = $myAgentId;
        const object_id = agent_id + '_' + timestamp; // just a proposal
        const geoPose = getGeoposeFromXRViewerPose(localPose);

        // // BEGIN Sparcl multiplayer demo
        // const object_description = {
        //     'version': 2,
        //     'color': [$myAgentColor.r, $myAgentColor.g, $myAgentColor.b, $myAgentColor.a],
        //     'shape': PRIMITIVES.sphere,
        //     'scale': [0.05, 0.05, 0.05],
        //     'transparent': false,
        //     'options': {}
        // };
        // const content = {
        //     "id": agent_id, // stream ID
        //     "type": "geopose_stream", //high-level OSCP type
        //     "title": object_id, // datapoint ID = stream ID + timestamp
        //     "refs": [],
        //     "geopose": geoPose,
        //     "object_description": object_description
        // }
        // const scr = {
        //     "content": content,
        //     "id": object_id, // datapoint ID = stream ID + timestamp
        //     "tenant": "IROS2022demo",
        //     "type": "geopose_stream",
        //     "timestamp": timestamp
        // }
        // let message_body = {
        //     "scr": scr,
        //     "sender": $myAgentName, // HACK: use agent id instead
        //     "timestamp": timestamp,
        // }

        // // TODO: this is for general SCR with streaming geopose
        // dispatcher('broadcast', {
        //     event: 'publish_camera_pose',
        //     value: message_body,
        //     "routing_key": "/exchange/esoptron/geopose_update." + String($myAgentId)
        // });
        // // END Sparcl multiplayer demo

        // BEGIN dtvis demo
        const message_body = {
            agent_id: $myAgentId,
            avatar: {
                name: $myAgentName,
                color: { r: $myAgentColor?.r, g: $myAgentColor?.g, b: $myAgentColor?.b, a: $myAgentColor?.a },
            },
            geopose: geoPose,
            timestamp: timestamp,
        };

        dispatcher('broadcast', {
            event: 'publish_camera_pose',
            value: message_body,
            routing_key: '/exchange/esoptron/geopose_update.' + String($myAgentId),
        });
        // END dtvis demo
    }

    const throttledShowAlert = throttle((floorPose: XRViewerPose) => {
        if (isIntersectingWithRobotPath(floorPose)) {
            $isUserOnRobotPath = true;
        } else {
            $isUserOnRobotPath = false;
        }
    }, 300);

    /**
     * Handles update loop when AR Cloud mode is used.
     *
     * @param time  DOMHighResTimeStamp     time offset at which the updated
     *      viewer state was received from the WebXR device.
     * @param frame     The XRFrame provided to the update loop
     * @param floorPose The pose of the device as reported by the XRFrame
     * @param floorSpaceReference
     */
    function onXrFrameUpdate(time: DOMHighResTimeStamp, frame: XRFrame, floorPose: XRViewerPose, floorSpaceReference: XRReferenceSpace | XRBoundedReferenceSpace) {
        if (useReticle && myGl) {
            checkGLError(myGl, 'before creating reticle');
            if (reticle == undefined || reticle == null) {
                //reticle = parentInstance.getRenderer().addReticle();
                //reticle = parentInstance.getRenderer().addModel({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1}, '/media/models/Duck.glb');
                //reticle = parentInstance.getRenderer().addPlaceholder([], {x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0, w: 1});
                reticle = parentInstance.getRenderer().addMarkerObject();
            }
            checkGLError(myGl, 'after creating reticle');

            if (hitTestSource === undefined) {
                console.log('HitTestSource is invalid! Cannot use reticle');
                reticle.visible = false;
            } else {
                const hitTestResults = frame.getHitTestResults(hitTestSource);
                if (hitTestResults.length > 0) {
                    const reticlePose = hitTestResults[0].getPose(floorSpaceReference);
                    const position = reticlePose?.transform.position;
                    const orientation = reticlePose?.transform.orientation;
                    if (position && orientation) {
                        parentInstance.getRenderer().updateReticlePose(reticle, position, orientation);
                        reticle.visible = true;
                    }
                } else {
                    reticle.visible = false;
                }
            }

            // hide if there was no localization yet
            if ($recentLocalisation.geopose?.position === undefined) {
                reticle.visible = false;
            }
        } // useReticle

        if ($recentLocalisation.geopose?.position != undefined || $recentLocalisation.floorpose?.transform?.position != undefined) {
            try {
                shareCameraPose(floorPose);
            } catch (error) {
                // do nothing. we can expect some exceptions because the pose conversion is not yet possible in the first few frames.
            }
        }

        // Check whether the user is too close to a robot path
        throttledShowAlert(floorPose);
        //
        if ($myAgentId && targetWaypoints[$myAgentId]?.geopose?.position?.lat != undefined) {
            const geoPose = getGeoposeFromXRViewerPose(floorPose);
            removeWaypoint({ agent_id: $myAgentId, agent_geopose: geoPose });
        }

        // Call parent Viewer's onXrFrameUpdate which updates performs localization and rendering
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
    function onXrNoPose(time: DOMHighResTimeStamp, frame: XRFrame, floorPose: XRViewerPose) {
        parentInstance.onXrNoPose(time, frame, floorPose);
    }

    /**
     * Called when the XRSession was closed.
     */
    function onXrSessionEnded() {
        if (hitTestSource != undefined) {
            hitTestSource.cancel();
            hitTestSource = undefined;
        }
        parentInstance.onXrSessionEnded();
    }
</script>

<Parent bind:this={parentInstance} on:arSessionEnded on:broadcast>
    <svelte:fragment slot="overlay" let:isLocalizing let:isLocalized let:isLocalisationDone let:firstPoseReceived let:receivedContentTitles>
        <ArCloudOverlay
            {agentInfo}
            hasPose={firstPoseReceived}
            {isLocalizing}
            {isLocalized}
            {receivedContentTitles}
            on:startLocalisation={() => parentInstance.startLocalisation()}
            on:agentSelected={(event) => {
                selectedAgentIdToSend = event.detail.agentId;
            }}
            on:sendWaypoint={() => {
                handleSendWaypoint();
            }}
            on:relocalize={() => {
                robotPathPolylines = {};
                targetWaypoints = {};
                reticle = null;
                parentInstance.relocalize();
            }}
        />
    </svelte:fragment>
</Parent>
