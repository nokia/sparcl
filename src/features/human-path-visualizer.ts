import type { Geopose } from '@oarc/scd-access';
import Viewer from '../components/Viewer.svelte';
import { type Mesh, Vec3 } from 'ogl';
import { throttle } from 'lodash';
import { isUserOnRobotPath } from '../stateStore';

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
        if (this.pathPolylines[msg.agent_id]) {
            rootParentInstance.getRenderer().remove(this.pathPolylines[msg.agent_id].polyLine);
            delete this.pathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using pathPolylines reactively
        }
        if (this.pathClearTimeouts[msg.agent_id]) {
            clearTimeout(this.pathClearTimeouts[msg.agent_id]);
            delete this.pathClearTimeouts[msg.agent_id];
        }
        const polyLinePoints = msg.geoposes.map((geopose) => {
            const localTargetPose = rootParentInstance.getRenderer().convertGeoPoseToLocalPose(geopose);
            return new Vec3(localTargetPose.position.x, localTargetPose.position.y, localTargetPose.position.z);
        });
        const hexColor = "0xD8F9FF"; // light blue
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
        }, 2000);
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
