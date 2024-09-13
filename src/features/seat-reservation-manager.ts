/*
  (c) 2024 Nokia
  Licensed under the BSD License
  SPDX-License-Identifier: BSD
*/

import type { SCR } from '@oarc/scd-access';
import type ogl from '@src/core/engines/ogl/ogl';
import { Quat, Vec3, Mesh, Transform } from 'ogl';
import { type EventDispatcher } from 'svelte';


// TODO: keep referecne to RabbitMQ Client
//...
let seat_labels: Record<string, Mesh> = {};

const chairs: Record<string,{
    id: string,
    reserved: boolean,
    userid: string|null,
}> = {};

const users: Record<string, string> = {
    "1": 'Gabor Soros',
    "2": 'Krisztian Varga',
    "3": 'Tamas Rigo',
};
const kDefaultUserId = 1;

/*
export function getCurrentUserId(urlParams = null) {
    if (urlParams == null) {
        return kDefaultUserId;
    }
    let userId = urlParams.get('userid');
    if (userId == null) {
        return kDefaultUserId;
    } else {
        return userId;
    }
}
*/

export function getUserName(userId: string) {
    if (userId === undefined || userId === null || userId == "") {
        return '';
    }
    if (!(userId in users)) {
        return '';
    }
    return users[userId];
}

function onClickInAr(tdEngine:ogl, chair_id:string, dispatch: EventDispatcher<{
    broadcast: {
        event: string;
        value?: any;
        routing_key?: string;
    };
}>) {
    console.log("RESERVATION CLICK: " + chair_id);
    tdEngine.getDynamicObjectMesh(chair_id)!.scale = new Vec3(1.1, 1.1, 1.1);
    // send request
    let msg = {
        chair_id: chair_id,
        reserved: !(chairs[chair_id].reserved),
        userid: 3,
    }
    dispatch('broadcast', {
        event: 'reservation_status_changed',
        value: msg,
        routing_key: '/exchange/esoptron/chair_reservation',
    });
}



export function createSeatFromRecord(record: SCR, tdEngine: ogl, localObjectPose: Transform, dispatch: EventDispatcher<{
    broadcast: {
        event: string;
        value?: any;
        routing_key?: string;
    };
}>) {
    let chair_id_index = record.content.definitions?.findIndex(function (key_value_pair) {
        return key_value_pair.type === 'chair_id'; // WARNING: a 'key' is called 'type' in the SCR definitions
    }); // -1 if not found

    if (chair_id_index == undefined || chair_id_index < 0) {
        console.log("WARNING: chair_id not found in the message");
        return;
    }

    let chair_id = record.content.definitions?.[chair_id_index].value;
    if (chair_id === undefined) {
        console.log("WARNING: chair_id is undefined in the message");
        return;
    }

    if (tdEngine.getDynamicObjectMesh(chair_id) != null) {
        // chair already exists, update it
        tdEngine.updateDynamicObject(chair_id, localObjectPose.position, localObjectPose.quaternion, null);
        return;
    }

    // does not exist yet, create it
    chairs[chair_id] = {
        id: chair_id!,
        reserved: false,
        userid: null,
    };

    tdEngine.addDynamicObject(chair_id!, localObjectPose.position, localObjectPose.quaternion, null);
    tdEngine.addClickEvent(tdEngine.getDynamicObjectMesh(chair_id)!, () => onClickInAr(tdEngine, chair_id!, dispatch));

    // create label
    let textLabelMesh = tdEngine.addTextObject(localObjectPose.position, localObjectPose.quaternion, "-");
    textLabelMesh.then((mesh) => {
        tdEngine.setTowardsCameraRotating(mesh);
        mesh.scale.set(new Vec3(0.3, 0.3, 0.3));
        seat_labels[chair_id!] = mesh;
    });
}

export function updateSeatReservation(msg: any, tdEngine: ogl) {
    console.log("Reservation status event received");
    console.log(msg);
    const chair_id = msg.chair_id;
    const reserved = msg.reserved;
    const user_id = msg.userid.toString(); // TODO: dtvis sends integer but it should also use strings instead.
    const user_name = getUserName(user_id);
    if (chair_id == undefined || reserved == undefined) {
        console.log('WARNING: invalid chair reservation message');
        return;
    }

    // update appearance
    const object_description = tdEngine.getDynamicObjectDescription(chair_id);
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
    tdEngine.updateDynamicObject(chair_id, null, null, new_object_description);

    chairs[chair_id] = {
        id: chair_id,
        reserved: reserved,
        userid: user_id,
    };

    // update label
    if (reserved) {
        let textLabelMesh = tdEngine.addTextObject(seat_labels[chair_id].position, seat_labels[chair_id].quaternion, user_name);
        tdEngine.remove(seat_labels[chair_id]);
        textLabelMesh.then((mesh) => {
            tdEngine.setTowardsCameraRotating(mesh);
            mesh.scale.set(new Vec3(0.1, 0.1, 0.1));
            seat_labels[chair_id] = mesh;
        });
    } else {
        let textLabelMesh = tdEngine.addTextObject(seat_labels[chair_id].position, seat_labels[chair_id].quaternion, "-");
        tdEngine.remove(seat_labels[chair_id]);
        textLabelMesh.then((mesh) => {
            tdEngine.setTowardsCameraRotating(mesh);
            mesh.scale.set(new Vec3(0.3, 0.3, 0.3));
            seat_labels[chair_id] = mesh
        }
        );
    }

    new Audio('media/audio/news-ting-6832.mp3').play();
}
