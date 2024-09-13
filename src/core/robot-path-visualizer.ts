import type { Geopose } from '@oarc/scd-access';
import Viewer from '../components/Viewer.svelte';
import { type Mesh, Vec3 } from 'ogl';
import { distanceToLineSegment } from './common';
import { throttle } from 'lodash';
import { isUserOnRobotPath } from '../stateStore';

export class RobotPathVisualizer {
    constructor() {}
    public robotPathPolylines: Record<string, { robotPolyLine: Mesh; robotPolyLinePoints: Vec3[] }> = {};
    public robotPathClearTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

    isIntersectingWithRobotPath(floorPose: XRViewerPose) {
        const threshold = 0.3;
        for (const view of floorPose.views) {
            for (const { robotPolyLinePoints } of Object.values(this.robotPathPolylines)) {
                for (let i = 0; i < robotPolyLinePoints.length - 1; i++) {
                    const distance = distanceToLineSegment({ point: view.transform.position, lineStart: robotPolyLinePoints[i], lineEnd: robotPolyLinePoints[i + 1], projectionAxis: 'y' });
                    if (distance <= threshold) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    handleRobotPathEvent({
        msg,
        agentInfo,
        rootParentInstance,
    }: {
        msg: { agent_id: string; geoposes: Geopose[] };
        agentInfo: Record<string, { hexColor: string; agentName: string; agentId: string }>;
        rootParentInstance: Viewer;
    }) {
        if (this.robotPathPolylines[msg.agent_id]) {
            rootParentInstance.getRenderer().remove(this.robotPathPolylines[msg.agent_id].robotPolyLine);
            delete this.robotPathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using robotPathPolylines reactively
        }
        if (this.robotPathClearTimeouts[msg.agent_id]) {
            clearTimeout(this.robotPathClearTimeouts[msg.agent_id]);
            delete this.robotPathClearTimeouts[msg.agent_id];
        }
        const robotPolyLinePoints = msg.geoposes.map((geopose) => {
            const localTargetPose = rootParentInstance.getRenderer().convertGeoPoseToLocalPose(geopose);
            return new Vec3(localTargetPose.position.x, localTargetPose.position.y, localTargetPose.position.z);
        });
        const hexColor = agentInfo[msg.agent_id].hexColor;
        if (robotPolyLinePoints.length) {
            this.robotPathPolylines[msg.agent_id] = { robotPolyLine: rootParentInstance.getRenderer().addPolyline(robotPolyLinePoints, hexColor), robotPolyLinePoints };
        }
        this.robotPathClearTimeouts[msg.agent_id] = setTimeout(() => {
            if (!rootParentInstance) {
                return;
            }
            if (!this.robotPathPolylines[msg.agent_id]) {
                return;
            }
            rootParentInstance.getRenderer().remove(this.robotPathPolylines[msg.agent_id].robotPolyLine);
            delete this.robotPathPolylines[msg.agent_id]; // delete is not reactive in svelte, but we don't care because we are not using robotPathPolylines reactively
        }, 2000);
    }

    public throttledShowRobotPathIntersectionAlert = throttle((floorPose: XRViewerPose) => {
        if (this.isIntersectingWithRobotPath(floorPose)) {
            isUserOnRobotPath.set(true);
        } else {
            isUserOnRobotPath.set(false);
        }
    }, 300);
}
