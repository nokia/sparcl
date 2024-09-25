import type { Geopose } from '@oarc/scd-access';
import Viewer from '../components/Viewer.svelte';
import { type Mesh, Vec3 } from 'ogl';
import { throttle } from 'lodash';
import { isUserOnRobotPath, recentLocalisation } from '../stateStore';
import { get } from 'svelte/store';
import type { GeoPose } from '@oarc/gpp-access';

// TODO: move this to some general place
let humanPathCurrentPose: GeoPose|null = null;

export function setCurrentPose(pose: GeoPose){
    humanPathCurrentPose = pose;
}

export function getCurrentPose(){
    return humanPathCurrentPose;
}

export class HumanPathVisualizer {
    constructor() {}
    public pathPolylines: Record<string, { polyLine: Mesh; polyLinePoints: Vec3[] }> = {};
    public pathClearTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

    handleHumanPathEvent({
        msg,
        rootParentInstance,
    }: {
        msg: { agent_id: string; geoposes: Geopose[] };
        rootParentInstance: Viewer;
    }) {
        console.log(msg.geoposes);
        if (this.pathPolylines[msg.agent_id]) {
            rootParentInstance.getRenderer().remove(this.pathPolylines[msg.agent_id].polyLine);
            delete this.pathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using pathPolylines reactively
        }
        if (this.pathClearTimeouts[msg.agent_id]) {
            clearTimeout(this.pathClearTimeouts[msg.agent_id]);
            delete this.pathClearTimeouts[msg.agent_id];
        }

        let totalGeoPoses = msg.geoposes;
        if(humanPathCurrentPose && rootParentInstance){
            totalGeoPoses = [humanPathCurrentPose as GeoPose].concat(totalGeoPoses);
        }

        let polyLinePoints = totalGeoPoses.map((geopose) => {
            const localTargetPose = rootParentInstance.getRenderer().convertGeoPoseToLocalPose(geopose);
            return new Vec3(localTargetPose.position.x, 0, localTargetPose.position.z);
        });

        const hexColor = "#D8F9FF"; // light blue
        if (polyLinePoints.length) {
            this.pathPolylines[msg.agent_id] = { polyLine: rootParentInstance.getRenderer().addPolyline(polyLinePoints, hexColor), polyLinePoints };
        }

        this.pathClearTimeouts[msg.agent_id] = setTimeout(() => {
            if (!rootParentInstance) {
                return;
            }
            if (!this.pathPolylines[msg.agent_id]) {
                return;
            }
            rootParentInstance.getRenderer().remove(this.pathPolylines[msg.agent_id].polyLine);
            delete this.pathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using pathPolylines reactively
        }, 10000); // TODO: lower timeout and repeat requests
    }

    private targetPointOfInterestId: string|undefined = undefined;

    requestPathTo(targetPointOfInterestId: string|undefined) { // undefined means clearing
        this.targetPointOfInterestId = targetPointOfInterestId
    }

    hasPendingRequest() {
        return this.targetPointOfInterestId != undefined;
    }

    getPendingRequest() {
        return this.targetPointOfInterestId;
    }
}
