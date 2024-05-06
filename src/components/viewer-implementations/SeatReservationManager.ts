/*
  (c) 2024 Nokia
  Licensed under the BSD License
  SPDX-License-Identifier: BSD
*/

import type { SCR } from '@oarc/scd-access';
import type ogl from '@src/core/engines/ogl/ogl';
import { Quat, Vec3, Transform, Mesh, type OGLRenderingContext } from 'ogl';


export function createSeatFromRecord(record: SCR, tdEngine: ogl, localObjectPose: {position:Vec3, quaternion:Quat}) {
    let chair_id_index = record.content.definitions?.findIndex(function (key_value_pair) {
        return key_value_pair.type === 'chair_id'; // WARNING: a 'key' is called 'type' in the SCR definitions
    }); // -1 if not found
    if (chair_id_index != undefined && chair_id_index >= 0) {
        let chair_id = record.content.definitions?.[chair_id_index].value;

        if (chair_id) {
            if (tdEngine.getDynamicObjectMesh(chair_id) != null) {
                tdEngine.updateDynamicObject(chair_id, localObjectPose.position, localObjectPose.quaternion, null);
            } else {
                tdEngine.addDynamicObject(chair_id, localObjectPose.position, localObjectPose.quaternion, null);
                tdEngine.addClickEvent(tdEngine.getDynamicObjectMesh(chair_id)!, () => {
                    tdEngine.getDynamicObjectMesh(chair_id)!.scale = new Vec3(1.1, 1.1, 1.1);
                    // TODO
                    //dispatch('reservation_request', {
                    //    reservation_status_changed: {
                    //        chair_id: msg.chair_id,
                    //        reserved: true,
                    //    },
                    //});
                })
            }
        }
    }
}

